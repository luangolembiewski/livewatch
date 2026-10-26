import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/*
 * Configs por pessoa: cada elenco é um JSON em configs/<nome>.json (vai pro repo).
 * A config ativa fica lembrada em data/ativo.json (local, fora do git).
 * Caminhos relativos são resolvidos a partir da pasta do Livewatch, não do terminal.
 */
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromApp = (p) => path.resolve(APP_DIR, p);

const CONFIG_DIR = fromApp(process.env.CONFIG_DIR || './configs');
const ACTIVE_FILE = fromApp(process.env.ACTIVE_FILE || './data/ativo.json');
/** Arquivo antigo (antes dos perfis). Só é lido para migrar para configs/padrao.json. */
const LEGACY_FILE = fromApp(process.env.DATA_FILE || './data/streamers.json');
const DEFAULT_NAME = 'padrao';

export const NAME_RE = /^[a-z0-9_-]{1,40}$/;

let active = null;
let cache = null;

export function validName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

const configPath = (name) => path.join(CONFIG_DIR, `${name}.json`);

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file); // troca atômica: nunca deixa o arquivo pela metade
}

/** Aceita lista pura ou { streamers: [...] }. */
function readRoster(raw) {
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.streamers)) return data.streamers;
  throw new Error('formato inválido (esperado uma lista de cadastros)');
}

async function readConfig(name) {
  return readRoster(await fs.readFile(configPath(name), 'utf8'));
}

export async function listConfigs() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const files = (await fs.readdir(CONFIG_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const file of files) {
    const name = file.slice(0, -5);
    if (!validName(name)) continue;
    let count = null;
    try { count = (await readConfig(name)).length; } catch { /* arquivo quebrado: aparece sem contagem */ }
    out.push({ name, count });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * Descobre a config ativa:
 *  1. data/ativo.json, se apontar para uma config que existe;
 *  2. migração: se existir o data/streamers.json antigo e ainda não houver configs/padrao.json,
 *     copia ele para configs/padrao.json e ativa;
 *  3. "padrao" se existir, senão a primeira config da pasta, senão cria "padrao" vazia.
 */
let resolving = null;
function resolveActive() {
  if (active) return Promise.resolve(active);
  // Várias chamadas ao mesmo tempo na partida esperam a mesma resolução (migração roda uma vez só).
  resolving ||= doResolveActive().finally(() => { resolving = null; });
  return resolving;
}

async function doResolveActive() {
  try {
    const saved = JSON.parse(await fs.readFile(ACTIVE_FILE, 'utf8'))?.config;
    if (validName(saved) && (await exists(configPath(saved)))) return (active = saved);
  } catch { /* sem arquivo de ativo ainda */ }

  if (!(await exists(configPath(DEFAULT_NAME))) && (await exists(LEGACY_FILE))) {
    try {
      const legacy = readRoster(await fs.readFile(LEGACY_FILE, 'utf8'));
      await writeJsonAtomic(configPath(DEFAULT_NAME), legacy);
      console.log(`  [configs] migrado ${path.relative(APP_DIR, LEGACY_FILE)} -> configs/${DEFAULT_NAME}.json (${legacy.length} cadastros)`);
    } catch (err) {
      console.warn(`  [configs] não consegui migrar o arquivo antigo: ${err.message}`);
    }
  }

  const all = await listConfigs();
  let name = all.find((c) => c.name === DEFAULT_NAME)?.name || all[0]?.name;
  if (!name) {
    name = DEFAULT_NAME;
    await writeJsonAtomic(configPath(name), []);
  }
  active = name;
  await writeJsonAtomic(ACTIVE_FILE, { config: name });
  return active;
}

export async function getActive() {
  return resolveActive();
}

async function load() {
  if (cache) return cache;
  const name = await resolveActive();
  try {
    cache = await readConfig(name);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    cache = [];
    await persist();
  }
  return cache;
}

async function persist() {
  await writeJsonAtomic(configPath(await resolveActive()), cache);
}

export async function getConfig(name) {
  if (!validName(name)) return { errors: ['Nome inválido. Use só letras minúsculas, números, _ e -.'] };
  try {
    return { streamers: await readConfig(name) };
  } catch (err) {
    if (err.code === 'ENOENT') return { errors: [`A config "${name}" não existe.`], notFound: true };
    return { errors: [`Não consegui ler a config "${name}": ${err.message}`] };
  }
}

/** Troca o elenco ativo e lembra a escolha em data/ativo.json. */
export async function setActive(name) {
  const { streamers, errors } = await getConfig(name);
  if (errors) return { errors };
  active = name;
  cache = streamers;
  await writeJsonAtomic(ACTIVE_FILE, { config: name });
  return { name, count: streamers.length };
}

/**
 * Cria configs/<nome>.json.
 *  from: 'empty' (vazia) ou 'current' (cópia do elenco ativo — é o "Salvar como…").
 *  overwrite: substitui se já existir.  activate: passa a usar a nova (padrão true).
 */
export async function createConfig(name, { from = 'empty', overwrite = false, activate = true } = {}) {
  if (!validName(name)) return { errors: ['Nome inválido. Use só letras minúsculas, números, _ e - (até 40).'] };
  if (from !== 'empty' && from !== 'current') return { errors: ['Origem inválida (use "empty" ou "current").'] };
  if (!overwrite && (await exists(configPath(name)))) {
    return { errors: [`Já existe uma config chamada "${name}".`], conflict: true };
  }
  const data = from === 'current' ? [...(await load())] : [];
  await writeJsonAtomic(configPath(name), data);
  if (activate) return setActive(name);
  return { name, count: data.length };
}

/**
 * Descobre plataforma e canal a partir do link da live.
 * Aceita: twitch.tv/canal, kick.com/canal, com ou sem https://, com query string.
 */
export function parseLiveUrl(input) {
  if (!input) return { platform: null, channel: null };
  let url = String(input).trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  let host, firstSegment;
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./i, '').toLowerCase();
    firstSegment = u.pathname.split('/').filter(Boolean)[0] || null;
  } catch {
    return { platform: null, channel: null };
  }

  const channel = firstSegment ? firstSegment.toLowerCase() : null;
  if (host.endsWith('twitch.tv')) return { platform: 'twitch', channel };
  if (host.endsWith('kick.com')) return { platform: 'kick', channel };
  return { platform: null, channel };
}

function normalize(body, existing = {}) {
  const { platform, channel } = parseLiveUrl(body.liveUrl);
  return {
    id: existing.id || crypto.randomUUID(),
    personagem: String(body.personagem || '').trim(),
    liveUrl: String(body.liveUrl || '').trim(),
    job: String(body.job || '').trim(),
    platform,
    channel,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function validate(entry) {
  const errors = [];
  if (!entry.personagem) errors.push('Informe o nome do personagem.');
  if (!entry.liveUrl) errors.push('Informe o link da live.');
  else if (!entry.platform) errors.push('O link precisa ser de twitch.tv ou kick.com.');
  else if (!entry.channel) errors.push('Não consegui identificar o canal nesse link.');
  return errors;
}

export async function list() {
  return [...(await load())];
}

export async function get(id) {
  return (await load()).find((s) => s.id === id) || null;
}

export async function create(body) {
  const items = await load();
  const entry = normalize(body);
  const errors = validate(entry);
  if (errors.length) return { errors };

  const dup = items.find(
    (s) => s.platform === entry.platform && s.channel === entry.channel
  );
  if (dup) return { errors: [`O canal ${entry.channel} já está cadastrado para ${dup.personagem}.`] };

  items.push(entry);
  await persist();
  return { entry };
}

export async function update(id, body) {
  const items = await load();
  const index = items.findIndex((s) => s.id === id);
  if (index === -1) return { errors: ['Cadastro não encontrado.'] };

  const entry = normalize({ ...items[index], ...body }, items[index]);
  const errors = validate(entry);
  if (errors.length) return { errors };

  const dup = items.find(
    (s) => s.id !== id && s.platform === entry.platform && s.channel === entry.channel
  );
  if (dup) return { errors: [`O canal ${entry.channel} já está cadastrado para ${dup.personagem}.`] };

  items[index] = entry;
  await persist();
  return { entry };
}

export async function remove(id) {
  const items = await load();
  const index = items.findIndex((s) => s.id === id);
  if (index === -1) return { errors: ['Cadastro não encontrado.'] };
  const [removed] = items.splice(index, 1);
  await persist();
  return { entry: removed };
}

/** Importa uma lista de uma vez (JSON ou CSV já convertido). Ignora duplicados. */
export async function bulkImport(rows) {
  const items = await load();
  const added = [];
  const skipped = [];

  for (const row of rows) {
    const entry = normalize(row);
    const errors = validate(entry);
    if (errors.length) {
      skipped.push({ row, reason: errors[0] });
      continue;
    }
    const dup = items.find(
      (s) => s.platform === entry.platform && s.channel === entry.channel
    );
    if (dup) {
      skipped.push({ row, reason: 'canal já cadastrado' });
      continue;
    }
    items.push(entry);
    added.push(entry);
  }

  if (added.length) await persist();
  return { added: added.length, skipped };
}
