import './src/env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from './src/store.js';
import * as monitor from './src/monitor.js';
import * as twitch from './src/twitch.js';
import * as kick from './src/kick.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** Exige a senha do .env nas rotas que alteram o cadastro. */
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  const sent = req.get('x-admin-password');
  if (sent === ADMIN_PASSWORD) return next();
  return res.status(401).json({ errors: ['Senha incorreta.'] });
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    passwordRequired: Boolean(ADMIN_PASSWORD),
    providers: {
      twitch: { configured: twitch.isConfigured() },
      kick: { configured: kick.isConfigured() },
    },
  });
});

app.post('/api/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.json({ ok: true });
  if (req.body?.password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ errors: ['Senha incorreta.'] });
});

/** Atualiza o status logo após trocar de elenco, sem segurar a resposta mais que alguns segundos. */
function refreshSoon(maxMs = 8000) {
  return Promise.race([
    monitor.refresh().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, maxMs)),
  ]);
}

// ── Configs (perfis de elenco: configs/<nome>.json) ─────────────────────────
app.get('/api/configs', async (req, res) => {
  res.json({ active: await store.getActive(), configs: await store.listConfigs() });
});

app.get('/api/configs/:name', async (req, res) => {
  const { streamers, errors, notFound } = await store.getConfig(req.params.name);
  if (errors) return res.status(notFound ? 404 : 400).json({ errors });
  res.json({ name: req.params.name, streamers });
});

/** Troca o elenco ativo. Corpo: { name } */
app.post('/api/configs/active', requireAdmin, async (req, res) => {
  const result = await store.setActive(String(req.body?.name ?? ''));
  if (result.errors) return res.status(400).json({ errors: result.errors });
  await refreshSoon();
  res.json(result);
});

/**
 * Cria configs/<nome>.json. Corpo: { name, from: 'empty' | 'current', overwrite?, activate? }
 * "Nova" = from 'empty' (ou 'current'); "Salvar como…" = from 'current'.
 */
app.post('/api/configs', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const result = await store.createConfig(String(body.name ?? ''), {
    from: body.from || 'empty',
    overwrite: body.overwrite === true,
    activate: body.activate !== false,
  });
  if (result.errors) return res.status(result.conflict ? 409 : 400).json({ errors: result.errors });
  await refreshSoon();
  res.status(201).json(result);
});

app.get('/api/streamers', async (req, res) => {
  res.json(await store.list());
});

app.post('/api/streamers', requireAdmin, async (req, res) => {
  const { entry, errors } = await store.create(req.body);
  if (errors) return res.status(400).json({ errors });
  monitor.refresh().catch(() => {});
  res.status(201).json(entry);
});

app.put('/api/streamers/:id', requireAdmin, async (req, res) => {
  const { entry, errors } = await store.update(req.params.id, req.body);
  if (errors) return res.status(400).json({ errors });
  monitor.refresh().catch(() => {});
  res.json(entry);
});

app.delete('/api/streamers/:id', requireAdmin, async (req, res) => {
  const { entry, errors } = await store.remove(req.params.id);
  if (errors) return res.status(404).json({ errors });
  monitor.refresh().catch(() => {});
  res.json(entry);
});

app.post('/api/streamers/import', requireAdmin, async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
  if (!Array.isArray(rows)) return res.status(400).json({ errors: ['Envie uma lista de cadastros.'] });
  const result = await store.bulkImport(rows);
  monitor.refresh().catch(() => {});
  res.json(result);
});

app.get('/api/status', (req, res) => {
  res.json(monitor.getSnapshot());
});

app.post('/api/status/refresh', async (req, res) => {
  res.json(await monitor.refresh());
});

app.get('/multi', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'multi.html'));
});

app.get('/config', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Metropole Livewatch`);
  console.log(`  painel    http://localhost:${PORT}`);
  console.log(`  cadastro  http://localhost:${PORT}/config`);
  store.getActive().then((name) => console.log(`  config    ${name} (configs/${name}.json)`)).catch(() => {});
  console.log(`  twitch    ${twitch.isConfigured() ? 'credenciais ok' : 'SEM credenciais no .env'}`);
  console.log(`  kick      ${kick.isConfigured() ? 'credenciais ok' : 'usando endpoint público (sem credenciais)'}\n`);
  monitor.start();
});
