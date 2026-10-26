/**
 * Gera a versão estática (só visualização) do Livewatch para o GitHub Pages.
 * Roda na GitHub Action: lê as chaves dos Secrets (process.env), consulta Twitch/Kick
 * e escreve em _site/ só o necessário para o painel e o multi:
 *   configs.json, status/<config>.json e os arquivos de public/ (sem o cadastro).
 * Nenhuma chave ou token é escrito em _site/ — o build confere isso antes de terminar.
 *
 * Local: node scripts/build-pages.mjs  (usa o .env, se existir)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(APP_DIR, '_site');
const PUBLIC = path.join(APP_DIR, 'public');
const CONFIG_DIR = path.join(APP_DIR, 'configs');
const NAME_RE = /^[a-z0-9_-]{1,40}$/;


// Fora da Action, aproveita o .env local (na Action as chaves vêm dos Secrets).
try { await import('../src/env.js'); } catch { /* sem dotenv instalado: tudo bem */ }
const { buildSnapshot } = await import('../src/monitor.js');

function readRoster(raw) {
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.streamers)) return data.streamers;
  throw new Error('formato inválido');
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, 'status'), { recursive: true });
await fs.mkdir(path.join(OUT, 'configs'), { recursive: true });

// 1. Arquivos do site (menos o cadastro), com o modo estático ligado.
for (const file of await fs.readdir(PUBLIC)) {
  let content = await fs.readFile(path.join(PUBLIC, file));
  if (file === 'mode.js') {
    const text = content.toString('utf8');
    const flipped = text
      .replace('const STATIC = false;', 'const STATIC = true;')
      .replace("const REPO = '';", `const REPO = ${JSON.stringify(process.env.GITHUB_REPOSITORY || '')};`);
    if (!flipped.includes('const STATIC = true;')) throw new Error('mode.js: não achei "const STATIC = false;"');
    content = flipped;
  }
  await fs.writeFile(path.join(OUT, file), content);
}
await fs.writeFile(path.join(OUT, '.nojekyll'), '');

// 2. Um status por elenco.
const configs = [];
for (const file of (await fs.readdir(CONFIG_DIR)).sort()) {
  if (!file.endsWith('.json')) continue;
  const name = file.slice(0, -5);
  if (!NAME_RE.test(name)) continue;
  let roster;
  try {
    roster = readRoster(await fs.readFile(path.join(CONFIG_DIR, file), 'utf8'));
  } catch (err) {
    console.warn(`  [pages] pulei configs/${file}: ${err.message}`);
    continue;
  }
  // Elenco bruto para a aba Cadastro (o mesmo que já está público no repositório).
  await fs.writeFile(path.join(OUT, 'configs', file), JSON.stringify(roster));
  const snap = await buildSnapshot(name, roster);
  await fs.writeFile(path.join(OUT, 'status', `${name}.json`), JSON.stringify(snap));
  const live = snap.streamers.filter((s) => s.live).length;
  const errs = Object.entries(snap.providers).filter(([, p]) => p.error).map(([k, p]) => `${k}: ${p.error}`);
  console.log(`  [pages] ${name}: ${live}/${snap.streamers.length} ao vivo${errs.length ? ` (${errs.join('; ')})` : ''}`);
  configs.push({ name, count: roster.length });
}
if (!configs.length) throw new Error('nenhuma config válida em configs/');

const wanted = process.env.DEFAULT_CONFIG;
const active = configs.find((c) => c.name === wanted)?.name
  || configs.find((c) => c.name === 'padrao')?.name
  || configs[0].name;
await fs.writeFile(path.join(OUT, 'configs.json'), JSON.stringify({ active, configs }));

// 3. Trava de segurança: nenhum segredo pode ter ido parar no site.
const secrets = ['TWITCH_CLIENT_SECRET', 'KICK_CLIENT_SECRET', 'ADMIN_PASSWORD', 'LIVEWATCH_PRIVATE_KEY']
  .map((k) => process.env[k])
  .filter((v) => v && v.length >= 6);
for (const file of await fs.readdir(OUT, { recursive: true })) {
  const full = path.join(OUT, file);
  if (!(await fs.stat(full)).isFile()) continue;
  const text = await fs.readFile(full, 'utf8');
  if (secrets.some((s) => text.includes(s))) {
    await fs.rm(OUT, { recursive: true, force: true });
    throw new Error(`segredo encontrado em _site/${file} — build cancelado`);
  }
}

console.log(`  [pages] pronto em _site/ (padrão: ${active})`);
