const state = { items: [], editingId: null, password: sessionStorage.getItem('livewatch-pw') || '', search: '' };

const el = (id) => document.getElementById(id);

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

function notify(message, bad = false) {
  const notice = el('notice');
  notice.hidden = !message;
  notice.textContent = message || '';
  notice.classList.toggle('bad', bad);
  if (message && !bad) setTimeout(() => { notice.hidden = true; }, 4000);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.password ? { 'x-admin-password': state.password } : {}),
      ...options.headers,
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errors?.join(' ') || `Erro ${res.status}`);
  return data;
}

function detectPlatform(url) {
  const value = (url || '').toLowerCase();
  if (value.includes('twitch.tv')) return 'Twitch detectada.';
  if (value.includes('kick.com')) return 'Kick detectada.';
  if (value.trim()) return 'Link não reconhecido — use twitch.tv ou kick.com.';
  return 'A plataforma é detectada pelo link.';
}

function renderJobList() {
  const jobs = [...new Set(state.items.map((s) => s.job).filter(Boolean))].sort();
  el('job-list').innerHTML = jobs.map((j) => `<option value="${escapeHtml(j)}"></option>`).join('');
}

function render() {
  renderJobList();

  const term = state.search;
  const rows = state.items.filter((s) =>
    !term || `${s.personagem} ${s.channel} ${s.job}`.toLowerCase().includes(term)
  );

  el('empty').hidden = state.items.length > 0;
  el('tbody').innerHTML = rows
    .map(
      (s) => `
      <tr data-id="${s.id}">
        <td><span class="cell-name">${escapeHtml(s.personagem)}</span></td>
        <td>
          <a class="cell-link" href="${escapeHtml(s.liveUrl)}" target="_blank" rel="noopener">
            ${escapeHtml(s.platform || '?')}/${escapeHtml(s.channel || '?')}
          </a>
        </td>
        <td>${s.job ? `<span class="tag job">${escapeHtml(s.job)}</span>` : '<span class="row-sub">—</span>'}</td>
        <td>
          <div class="cell-actions">
            <button class="btn ghost small" data-action="edit">Editar</button>
            <button class="btn danger small" data-action="delete">Remover</button>
          </div>
        </td>
      </tr>`
    )
    .join('');
}

function fillForm(item) {
  el('personagem').value = item?.personagem || '';
  el('liveUrl').value = item?.liveUrl || '';
  el('job').value = item?.job || '';
  el('platform-hint').textContent = detectPlatform(item?.liveUrl);
  el('form-title').textContent = item ? `Editando ${item.personagem}` : 'Novo personagem';
  el('cancel').hidden = !item;
  state.editingId = item?.id || null;
}

async function load() {
  state.items = await api('/api/streamers');
  render();
}

el('liveUrl').addEventListener('input', (e) => {
  el('platform-hint').textContent = detectPlatform(e.target.value);
});

el('search').addEventListener('input', (e) => {
  state.search = e.target.value.trim().toLowerCase();
  render();
});

el('save').addEventListener('click', async () => {
  const payload = {
    personagem: el('personagem').value,
    liveUrl: el('liveUrl').value,
    job: el('job').value,
  };

  try {
    if (state.editingId) {
      await api(`/api/streamers/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      notify('Cadastro atualizado.');
    } else {
      await api('/api/streamers', { method: 'POST', body: JSON.stringify(payload) });
      notify('Personagem cadastrado.');
    }
    fillForm(null);
    await load();
  } catch (err) {
    notify(err.message, true);
  }
});

el('cancel').addEventListener('click', () => fillForm(null));

el('tbody').addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('tr').dataset.id;
  const item = state.items.find((s) => s.id === id);

  if (button.dataset.action === 'edit') {
    fillForm(item);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (!confirm(`Remover ${item.personagem} do monitoramento?`)) return;
  try {
    await api(`/api/streamers/${id}`, { method: 'DELETE' });
    notify('Cadastro removido.');
    await load();
  } catch (err) {
    notify(err.message, true);
  }
});

el('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.items, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'elenco-livewatch.json';
  link.click();
  URL.revokeObjectURL(link.href);
});

el('gate-submit').addEventListener('click', async () => {
  const password = el('gate-password').value;
  try {
    await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then((res) => {
      if (!res.ok) throw new Error('Senha incorreta.');
    });
    state.password = password;
    sessionStorage.setItem('livewatch-pw', password);
    el('gate').hidden = true;
    load();
  } catch (err) {
    el('gate-error').hidden = false;
    el('gate-error').textContent = err.message;
  }
});

el('gate-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('gate-submit').click();
});

(async function boot() {
  const health = await fetch('/api/health').then((r) => r.json());
  if (health.passwordRequired && !state.password) {
    el('gate').hidden = false;
    el('gate-password').focus();
    return;
  }
  load().catch((err) => notify(err.message, true));
})();
