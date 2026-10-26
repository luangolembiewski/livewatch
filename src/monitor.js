import * as store from './store.js';
import * as twitch from './twitch.js';
import * as kick from './kick.js';

const INTERVAL = Math.max(15, Number(process.env.POLL_INTERVAL_SECONDS || 60)) * 1000;

let snapshot = {
  checkedAt: null,
  intervalSeconds: INTERVAL / 1000,
  providers: {},
  streamers: [],
};

let running = null;
let queued = null;
let timer = null;

export function getSnapshot() {
  return snapshot;
}

/**
 * Faz uma leitura nova. Se já tem uma em andamento (ex.: trocou a config no meio dela),
 * agenda mais uma logo em seguida e devolve essa — assim quem espera recebe o elenco novo.
 */
export function refresh() {
  if (!running) {
    running = doRefresh().finally(() => { running = null; });
    return running;
  }
  if (!queued) {
    queued = running.catch(() => {}).then(() => {
      queued = null;
      return refresh();
    });
  }
  return queued;
}

async function doRefresh() {
  const config = await store.getActive();
  snapshot = await buildSnapshot(config, await store.list());
  return snapshot;
}

/**
 * Consulta Twitch e Kick para um elenco e monta o snapshot que o painel lê.
 * Usado pelo servidor local e pelo build do GitHub Pages (scripts/build-pages.mjs).
 */
export async function buildSnapshot(config, roster) {
  const entries = roster.filter((s) => s.channel);
  const twitchChannels = [...new Set(entries.filter((s) => s.platform === 'twitch').map((s) => s.channel))];
  const kickChannels = [...new Set(entries.filter((s) => s.platform === 'kick').map((s) => s.channel))];

  const providers = {
    twitch: { configured: twitch.isConfigured(), channels: twitchChannels.length, error: null },
    kick: { configured: kick.isConfigured(), channels: kickChannels.length, error: null },
  };

  const [twitchResult, kickResult] = await Promise.all([
    twitch.fetchStatuses(twitchChannels).catch((err) => {
      providers.twitch.error = err.message;
      return new Map();
    }),
    kick.fetchStatuses(kickChannels).catch((err) => {
      providers.kick.error = err.message;
      return new Map();
    }),
  ]);

  const streamers = entries.map((entry) => {
    const source = entry.platform === 'twitch' ? twitchResult : kickResult;
    const status = source.get(entry.channel) || { live: false, error: 'sem resposta da plataforma' };
    return {
      id: entry.id,
      personagem: entry.personagem,
      job: entry.job,
      platform: entry.platform,
      channel: entry.channel,
      liveUrl: entry.liveUrl,
      ...status,
    };
  });

  streamers.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.live) return (b.viewers || 0) - (a.viewers || 0);
    return a.personagem.localeCompare(b.personagem, 'pt-BR');
  });

  return {
    config,
    checkedAt: new Date().toISOString(),
    intervalSeconds: INTERVAL / 1000,
    providers,
    streamers,
  };
}

export function start() {
  if (timer) return;
  refresh().catch((err) => console.error('[monitor]', err.message));
  timer = setInterval(() => {
    refresh().catch((err) => console.error('[monitor]', err.message));
  }, INTERVAL);
  timer.unref?.();
}
