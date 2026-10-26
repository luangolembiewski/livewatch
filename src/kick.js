/**
 * Kick — usa a API oficial quando há KICK_CLIENT_ID/SECRET no .env.
 * Sem credenciais, cai no endpoint público kick.com/api/v2 (pode ser
 * barrado pelo Cloudflare dependendo de onde o servidor estiver hospedado).
 */

let token = null;
let tokenExpiresAt = 0;

export function isConfigured() {
  return Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET);
}

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.KICK_CLIENT_ID,
    client_secret: process.env.KICK_CLIENT_SECRET,
  });

  const res = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    throw new Error(`Kick: falha ao autenticar (${res.status}). Confira KICK_CLIENT_ID / KICK_CLIENT_SECRET.`);
  }

  const data = await res.json();
  token = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return token;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchOfficial(channels) {
  const result = new Map();
  const accessToken = await getToken();

  for (const batch of chunk(channels, 50)) {
    const url = new URL('https://api.kick.com/public/v1/channels');
    for (const slug of batch) url.searchParams.append('slug', slug);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });

    if (res.status === 401) {
      token = null;
      throw new Error('Kick: token rejeitado, será renovado no próximo ciclo.');
    }
    if (!res.ok) throw new Error(`Kick: API oficial respondeu ${res.status}.`);

    const body = await res.json();
    for (const channel of body.data || []) {
      const slug = String(channel.slug || '').toLowerCase();
      const stream = channel.stream || {};
      result.set(slug, {
        live: Boolean(stream.is_live),
        title: channel.stream_title || null,
        game: channel.category?.name || null,
        viewers: stream.viewer_count ?? null,
        startedAt: stream.start_time || null,
        thumbnail: stream.thumbnail || channel.banner_picture || null,
        avatar: channel.banner_picture || null,
        displayName: channel.slug,
      });
    }
  }

  return result;
}

async function fetchPublicOne(slug) {
  const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });

  if (res.status === 404) return { live: false, error: 'canal não encontrado na Kick' };
  if (res.status === 403 || res.status === 429) {
    return { live: false, error: 'Kick bloqueou a consulta pública — configure KICK_CLIENT_ID/SECRET' };
  }
  if (!res.ok) return { live: false, error: `Kick respondeu ${res.status}` };

  const data = await res.json();
  const live = data.livestream;
  return {
    live: Boolean(live?.is_live),
    title: live?.session_title || null,
    game: live?.categories?.[0]?.name || null,
    viewers: live?.viewer_count ?? null,
    startedAt: live?.start_time ? live.start_time.replace(' ', 'T') + 'Z' : null,
    thumbnail: live?.thumbnail?.url || null,
    avatar: data.user?.profile_pic || null,
    displayName: data.user?.username || data.slug,
  };
}

async function fetchPublic(channels) {
  const result = new Map();
  // Em série, com respiro entre as chamadas, pra não parecer scraping agressivo.
  for (const slug of channels) {
    try {
      result.set(slug, await fetchPublicOne(slug));
    } catch (err) {
      result.set(slug, { live: false, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return result;
}

/**
 * @param {string[]} channels slugs da Kick
 * @returns {Promise<Map<string, object>>} canal (lowercase) -> status
 */
export async function fetchStatuses(channels) {
  if (!channels.length) return new Map();

  if (isConfigured()) {
    const result = await fetchOfficial(channels);
    for (const slug of channels) {
      if (!result.has(slug)) result.set(slug, { live: false, error: 'canal não encontrado na Kick' });
    }
    return result;
  }

  return fetchPublic(channels);
}
