/**
 * Aplica um pedido de cadastro vindo de uma issue (workflow cadastro.yml).
 * Abre o pedido com LIVEWATCH_PRIVATE_KEY, confere a senha com ADMIN_PASSWORD
 * e grava em configs/<config>.json. Nunca escreve a senha em log ou resposta.
 * Saída para o workflow: ok, message, summary (GITHUB_OUTPUT).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as store from '../src/store.js';

const MAX_AGE_MS = 30 * 60 * 1000; // pedido vale 30 min depois de montado

function output(values) {
  const clean = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, 300);
  const lines = Object.entries(values).map(([k, v]) => `${k}=${clean(v)}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines);
  else process.stdout.write(lines);
}

function fail(message) {
  output({ ok: 'false', message: `❌ ${message}` });
  process.exit(0);
}

function open(body) {
  const match = /```livewatch\s+([A-Za-z0-9+/=\s]+?)\s*```/.exec(body || '');
  if (!match) throw new Error('bloco do pedido não encontrado');
  const box = JSON.parse(Buffer.from(match[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
  const key = crypto.privateDecrypt(
    { key: process.env.LIVEWATCH_PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(box.k, 'base64')
  );
  const data = Buffer.from(box.d, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

const sameSecret = (a, b) =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(a)).digest(),
    crypto.createHash('sha256').update(String(b)).digest()
  );

if (!process.env.ADMIN_PASSWORD || !process.env.LIVEWATCH_PRIVATE_KEY) {
  fail('Cadastro pelo site não está configurado (faltam os secrets ADMIN_PASSWORD / LIVEWATCH_PRIVATE_KEY).');
}

let req;
try {
  req = open(process.env.ISSUE_BODY);
} catch {
  fail('Pedido inválido ou corrompido.');
}

if (!req.password || !sameSecret(req.password, process.env.ADMIN_PASSWORD)) fail('Senha incorreta.');
const age = Date.now() - Number(req.ts);
if (!Number.isFinite(age) || age > MAX_AGE_MS || age < -5 * 60 * 1000) fail('Pedido expirado. Envie de novo pelo site.');

const switched = await store.setActive(String(req.config || ''));
if (switched.errors) fail(switched.errors.join(' '));

const fields = ({ personagem, liveUrl, job } = {}) => ({ personagem, liveUrl, job });
let result;
if (req.op === 'create') result = await store.create(fields(req.entry));
else if (req.op === 'update') result = await store.update(String(req.id || ''), fields(req.entry));
else if (req.op === 'delete') result = await store.remove(String(req.id || ''));
else fail('Operação desconhecida.');

if (result.errors) fail(result.errors.join(' '));

const verbs = { create: 'adicionado', update: 'atualizado', delete: 'removido' };
const name = result.entry.personagem;
output({
  ok: 'true',
  message: `✅ ${name} ${verbs[req.op]} em ${req.config}. O painel atualiza em 1 a 2 minutos.`,
  summary: `${name} ${verbs[req.op]} (${req.config})`,
});
