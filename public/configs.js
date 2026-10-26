/*
 * Seletor de config (perfil de elenco) no cabeçalho.
 * Cada config é um arquivo configs/<nome>.json no servidor; a escolhida fica lembrada
 * no servidor (data/ativo.json), então vale para todas as abas e para quem abrir depois.
 * Trocar, criar e "Salvar como…" pedem a mesma senha do cadastro (ADMIN_PASSWORD).
 */
(function () {
  const host = document.getElementById('cfgbar');
  if (!host) return;

  /* GitHub Pages: só visualização. Trocar o elenco vale só para quem está vendo. */
  if (window.LIVEWATCH?.static) {
    const escS = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    host.innerHTML = `
      <label class="cfgbar-label" for="cfg-select">Config:</label>
      <select id="cfg-select" title="Escolha qual elenco ver"><option>carregando…</option></select>`;
    const sel = document.getElementById('cfg-select');
    LIVEWATCH.configs().then(({ active, configs }) => {
      sel.innerHTML = configs
        .map((c) => `<option value="${escS(c.name)}"${c.name === active ? ' selected' : ''}>${escS(c.name)} (${c.count})</option>`)
        .join('');
      sel.addEventListener('change', () => { LIVEWATCH.choose(sel.value); location.reload(); });
    }).catch(() => { sel.innerHTML = '<option>indisponível</option>'; sel.disabled = true; });
    return;
  }

  const PW_KEY = 'livewatch-pw';
  const NAME_RE = /^[a-z0-9_-]{1,40}$/;
  const getPw = () => { try { return sessionStorage.getItem(PW_KEY) || ''; } catch { return ''; } };
  const setPw = (v) => { try { sessionStorage.setItem(PW_KEY, v); } catch { /* sem storage */ } };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let passwordRequired = false;
  let active = '';

  host.innerHTML = `
    <label class="cfgbar-label" for="cfg-select">Config:</label>
    <select id="cfg-select" title="Escolha qual elenco o painel monitora"><option>carregando…</option></select>
    <button type="button" class="btn ghost small" id="cfg-new" title="Criar uma config nova">Nova</button>
    <button type="button" class="btn ghost small" id="cfg-saveas" title="Gravar o elenco atual com outro nome">Salvar como…</button>
    <span class="cfgbar-msg" id="cfg-msg" role="status"></span>
    <dialog class="cfg-dialog" id="cfg-dialog">
      <form method="dialog" id="cfg-form">
        <h3 id="cfg-dlg-title">Nova config</h3>
        <div class="field">
          <label for="cfg-name">Nome do arquivo</label>
          <input id="cfg-name" autocomplete="off" placeholder="ex.: equipe-policia" maxlength="40" />
          <span class="hint">Só letras minúsculas, números, _ e -. Vira <b>configs/<span id="cfg-preview">nome</span>.json</b>.</span>
        </div>
        <div class="field" id="cfg-from-wrap">
          <label>Começar com</label>
          <label class="cfg-radio"><input type="radio" name="cfg-from" value="empty" checked /> lista vazia</label>
          <label class="cfg-radio"><input type="radio" name="cfg-from" value="current" /> cópia da config atual</label>
        </div>
        <div class="field" id="cfg-pw-wrap" hidden>
          <label for="cfg-pw">Senha do cadastro</label>
          <input type="password" id="cfg-pw" autocomplete="current-password" />
        </div>
        <p class="notice bad" id="cfg-err" hidden></p>
        <div class="actions">
          <button class="btn" id="cfg-ok" value="ok">Criar</button>
          <button class="btn ghost" id="cfg-cancel" value="cancel" formnovalidate>Cancelar</button>
        </div>
      </form>
    </dialog>`;

  const $ = (id) => document.getElementById(id);
  const select = $('cfg-select');

  function msg(text, bad = false) {
    const m = $('cfg-msg');
    m.textContent = text || '';
    m.classList.toggle('bad', bad);
    if (text && !bad) setTimeout(() => { if (m.textContent === text) m.textContent = ''; }, 3500);
  }

  async function api(url, options = {}) {
    const pw = getPw();
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(pw ? { 'x-admin-password': pw } : {}) },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.errors?.join(' ') || `Erro ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function checkPassword(pw) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    return res.ok;
  }

  async function refreshList() {
    const data = await api('/api/configs');
    active = data.active;
    select.innerHTML = data.configs
      .map((c) => `<option value="${esc(c.name)}"${c.name === active ? ' selected' : ''}>${esc(c.name)}${c.count == null ? ' (arquivo com erro)' : ` (${c.count})`}</option>`)
      .join('');
  }

  /** Pede a senha num prompt simples quando precisa e ainda não temos. */
  async function ensurePassword() {
    if (!passwordRequired || getPw()) return true;
    const pw = window.prompt('Senha do cadastro (ADMIN_PASSWORD do .env):');
    if (pw == null) return false;
    if (!(await checkPassword(pw))) { msg('Senha incorreta.', true); return false; }
    setPw(pw);
    return true;
  }

  function afterChange(text) {
    msg(text);
    // Recarrega a página para o painel/cadastro mostrarem o novo elenco.
    setTimeout(() => location.reload(), 400);
  }

  select.addEventListener('change', async () => {
    const name = select.value;
    if (name === active) return;
    if (!(await ensurePassword())) { select.value = active; return; }
    select.disabled = true;
    msg('Trocando…');
    try {
      await api('/api/configs/active', { method: 'POST', body: JSON.stringify({ name }) });
      afterChange(`Usando "${name}".`);
    } catch (err) {
      if (err.status === 401) setPw('');
      select.value = active;
      msg(err.message, true);
    } finally {
      select.disabled = false;
    }
  });

  /* ── diálogo Nova / Salvar como ─────────────────────────────── */
  let mode = 'new';

  function openDialog(which) {
    mode = which;
    const saveAs = which === 'saveas';
    $('cfg-dlg-title').textContent = saveAs ? `Salvar "${active}" como…` : 'Nova config';
    $('cfg-ok').textContent = saveAs ? 'Salvar' : 'Criar';
    $('cfg-from-wrap').hidden = saveAs;
    $('cfg-pw-wrap').hidden = !(passwordRequired && !getPw());
    $('cfg-name').value = '';
    $('cfg-preview').textContent = 'nome';
    $('cfg-err').hidden = true;
    $('cfg-dialog').showModal();
    $('cfg-name').focus();
  }

  $('cfg-new').addEventListener('click', () => openDialog('new'));
  $('cfg-saveas').addEventListener('click', () => openDialog('saveas'));
  $('cfg-cancel').addEventListener('click', (e) => { e.preventDefault(); $('cfg-dialog').close(); });

  $('cfg-name').addEventListener('input', (e) => {
    // Ajuda a pessoa: troca espaço por - e põe em minúsculas enquanto digita.
    const clean = e.target.value.toLowerCase().replace(/\s+/g, '-');
    if (clean !== e.target.value) e.target.value = clean;
    $('cfg-preview').textContent = clean || 'nome';
  });

  function dialogError(text) {
    $('cfg-err').textContent = text;
    $('cfg-err').hidden = false;
  }

  $('cfg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('cfg-name').value.trim();
    if (!NAME_RE.test(name)) return dialogError('Nome inválido: use só a-z, 0-9, _ e - (até 40).');

    if (!$('cfg-pw-wrap').hidden) {
      const pw = $('cfg-pw').value;
      if (!(await checkPassword(pw))) return dialogError('Senha incorreta.');
      setPw(pw);
    }

    const from = mode === 'saveas'
      ? 'current'
      : (document.querySelector('input[name="cfg-from"]:checked')?.value || 'empty');
    const body = { name, from };
    const exists = [...select.options].some((o) => o.value === name);
    if (exists) {
      if (!window.confirm(`Já existe "configs/${name}.json". Substituir pelo ${from === 'current' ? 'elenco atual' : 'conteúdo novo'}?`)) return;
      body.overwrite = true;
    }
    try {
      await api('/api/configs', { method: 'POST', body: JSON.stringify(body) });
    } catch (err) {
      if (err.status === 409) {
        if (!window.confirm(`Já existe "configs/${name}.json". Substituir pelo ${from === 'current' ? 'elenco atual' : 'conteúdo novo'}?`)) return;
        try {
          await api('/api/configs', { method: 'POST', body: JSON.stringify({ ...body, overwrite: true }) });
        } catch (err2) { return dialogError(err2.message); }
      } else {
        if (err.status === 401) { setPw(''); $('cfg-pw-wrap').hidden = !passwordRequired; }
        return dialogError(err.message);
      }
    }
    $('cfg-dialog').close();
    afterChange(mode === 'saveas' ? `Salvo como "${name}".` : `Config "${name}" criada.`);
  });

  (async function boot() {
    try {
      const health = await fetch('/api/health').then((r) => r.json());
      passwordRequired = Boolean(health.passwordRequired);
      await refreshList();
    } catch (err) {
      select.innerHTML = '<option>indisponível</option>';
      select.disabled = true;
      msg('Não consegui carregar as configs.', true);
    }
  })();
})();
