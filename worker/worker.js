/**
 * Livewatch API — Cloudflare Worker.
 * Guarda as chaves da Twitch/Kick (wrangler secret) e devolve o status das lives
 * em tempo quase real para o site no GitHub Pages, que continua só visualização.
 *
 *   GET /status/<config>   → mesmo JSON de status/<config>.json do Pages
 *
 * O elenco é lido do próprio repositório (configs/<config>.json, que já é público).
 * Cada resposta fica em cache por CACHE_SECONDS no data center da Cloudflare, então
 * 100 abas abertas continuam fazendo ~1 consulta por minuto às plataformas.
 */
import process from 'node:process';
import { buildSnapshot } from '../src/snapshot.js';

const NAME_RE = /^[a-z0-9_-]{1,40}$/;
const SECRET_KEYS = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'KICK_CLIENT_ID', 'KICK_CLIENT_SECRET'];

function cors(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : allowed[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function readRoster(env, name) {
  const url = `https://raw.githubusercontent.com/${env.REPO}/${env.BRANCH || 'main'}/configs/${name}.json`;
  // raw.githubusercontent tem cache próprio de ~5 min; o cf.cacheTtl segura do nosso lado também.
  const res = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`elenco respondeu ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.streamers || [];
}

export default {
  async fetch(request, env, ctx) {
    const headers = cors(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return json({ error: 'método não permitido' }, 405, headers);

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/status\/([^/]+?)(?:\.json)?$/);
    if (!match || !NAME_RE.test(match[1])) return json({ error: 'use /status/<config>' }, 404, headers);
    const name = match[1];

    // As chaves chegam como bindings; os clientes da Twitch/Kick leem de process.env.
    for (const key of SECRET_KEYS) if (env[key]) process.env[key] = env[key];

    const ttl = Math.max(15, Number(env.CACHE_SECONDS || 45));
    const cache = caches.default;
    const cacheKey = new Request(`https://livewatch-cache/${name}`);
    const hit = await cache.match(cacheKey);
    if (hit) {
      return new Response(hit.body, { headers: { ...Object.fromEntries(hit.headers), ...headers, 'X-Cache': 'HIT' } });
    }

    try {
      const roster = await readRoster(env, name);
      if (!roster) return json({ error: `config ${name} não existe` }, 404, headers);
      const snap = await buildSnapshot(name, roster);
      snap.intervalSeconds = ttl;
      const body = JSON.stringify(snap);
      const cacheHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttl}` };
      ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: cacheHeaders })));
      return new Response(body, { headers: { ...cacheHeaders, ...headers, 'X-Cache': 'MISS' } });
    } catch (err) {
      return json({ error: err.message }, 502, headers);
    }
  },
};
