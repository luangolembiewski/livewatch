import * as store from './store.js';
import { buildSnapshot } from './snapshot.js';

export { buildSnapshot };

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

export function start() {
  if (timer) return;
  refresh().catch((err) => console.error('[monitor]', err.message));
  timer = setInterval(() => {
    refresh().catch((err) => console.error('[monitor]', err.message));
  }, INTERVAL);
  timer.unref?.();
}
