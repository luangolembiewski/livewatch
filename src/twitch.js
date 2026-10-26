/**
 * Twitch Helix — app access token (client_credentials).
 * Docs: https://dev.twitch.tv/docs/api/reference/#get-streams
 */

let token = null;
let tokenExpiresAt = 0;

export function isConfigured() {
  return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;

  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    throw new Error(`Twitch: falha ao autenticar (${res.status}). Confira TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET.`);
  }

  const data = await res.json();
  token = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return token;
}

async function helix(pathname, searchParams) {
  const accessToken = await getToken();
  const url = new URL(`https://api.twitch.tv/helix/${pathname}`);
  for (const [key, values] of Object.entries(searchParams)) {
    for (const value of values) url.searchParams.append(key, value);
  }

  const res = await fetch(url, {
    headers: {
      'Client-Id': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    token = null; // token invalidado: força renovação na próxima chamada
    throw new Error('Twitch: token rejeitado, será renovado no próximo ciclo.');
  }
  if (!res.ok) throw new Error(`Twitch: ${pathname} respondeu ${res.status}.`);

  return res.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * @param {string[]} channels logins da Twitch
 * @returns {Promise<Map<string, object>>} canal (lowercase) -> status
 */
export async function fetchStatuses(channels) {
  const result = new Map();
  if (!channels.length) return result;

  if (!isConfigured()) {
    for (const channel of channels) {
      result.set(channel, { live: false, error: 'Twitch sem credenciais no .env' });
    }
    return result;
  }

  // Base offline para todo mundo; quem aparecer em /streams vira online.
  for (const channel of channels) result.set(channel, { live: false });

  const profiles = new Map();

  for (const batch of chunk(channels, 100)) {
    const users = await helix('users', { login: batch });
    for (const user of users.data || []) {
      profiles.set(user.login.toLowerCase(), {
        avatar: user.profile_image_url,
        displayName: user.display_name,
      });
    }

    const streams = await helix('streams', { user_login: batch });
    for (const stream of streams.data || []) {
      const key = stream.user_login.toLowerCase();
      result.set(key, {
        live: true,
        title: stream.title,
        game: stream.game_name,
        viewers: stream.viewer_count,
        startedAt: stream.started_at,
        thumbnail: (stream.thumbnail_url || '').replace('{width}', '440').replace('{height}', '248'),
      });
    }
  }

  for (const [channel, profile] of profiles) {
    const current = result.get(channel);
    if (current) Object.assign(current, profile);
    else result.set(channel, { live: false, ...profile });
  }

  // Canal que não voltou em /users provavelmente não existe.
  for (const channel of channels) {
    if (!profiles.has(channel)) {
      Object.assign(result.get(channel), { error: 'canal não encontrado na Twitch' });
    }
  }

  return result;
}
