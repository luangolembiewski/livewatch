/*
 * Ponte entre as páginas e a fonte dos dados.
 *  - Local (npm start): fala com o servidor Express em /api/*.
 *  - GitHub Pages: o build troca STATIC para true e as páginas passam a ler
 *    configs.json e status/<config>.json gerados pela Action. Só visualização:
 *    sem cadastro, sem senha, sem nenhuma chave no navegador.
 */
(function () {
  const STATIC = false; // o scripts/build-pages.mjs troca para true no build do Pages
  const REPO = ''; // dono/repo, preenchido no build (GITHUB_REPOSITORY)
  const KEY = 'livewatch-config';

  const readSaved = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };

  async function getJson(url, options) {
    const res = await fetch(url, { cache: 'no-store', ...options });
    if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
    return res.json();
  }

  let index = null;

  /** { active, configs: [{ name, count }] } */
  async function configs() {
    if (!STATIC) return getJson('api/configs');
    index ||= await getJson('configs.json');
    const saved = readSaved();
    const active = index.configs.some((c) => c.name === saved) ? saved : index.active;
    return { active, configs: index.configs };
  }

  async function status() {
    if (!STATIC) return getJson('api/status');
    const { active } = await configs();
    return getJson(`status/${encodeURIComponent(active)}.json`);
  }

  async function refresh() {
    if (!STATIC) return getJson('api/status/refresh', { method: 'POST' });
    index = null;
    return status();
  }

  /** No Pages cada visitante escolhe o elenco só para si (fica no navegador dele). */
  function choose(name) {
    try { localStorage.setItem(KEY, name); } catch { /* sem storage */ }
  }

  /** Elenco bruto (configs/<nome>.json publicado junto com o site). */
  async function roster() {
    const { active } = await configs();
    const data = await getJson(`configs/${encodeURIComponent(active)}.json`);
    return { active, items: Array.isArray(data) ? data : data.streamers || [] };
  }

  function repo() {
    if (REPO) return REPO;
    // usuario.github.io/repo/ → usuario/repo
    const user = location.hostname.split('.')[0];
    const name = location.pathname.split('/').filter(Boolean)[0];
    return user && name ? `${user}/${name}` : '';
  }

  window.LIVEWATCH = { static: STATIC, configs, status, refresh, choose, roster, repo };
  if (STATIC) document.documentElement.classList.add('lw-static');
})();
