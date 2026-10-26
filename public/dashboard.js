const state = { snapshot: null, platform: '', job: '', search: '' };

const el = (id) => document.getElementById(id);

/* Se algum elemento faltar no HTML, o painel segue funcionando
   em vez de derrubar o script inteiro na primeira linha quebrada. */
const on = (id, event, handler, options) => {
  const node = el(id);
  if (node) node.addEventListener(event, handler, options);
  else console.warn(`[livewatch] elemento #${id} não encontrado no HTML`);
};

const setText = (id, value) => {
  const node = el(id);
  if (node) node.textContent = value;
};

const setHtml = (id, value) => {
  const node = el(id);
  if (node) node.innerHTML = value;
};

const setHidden = (id, value) => {
  const node = el(id);
  if (node) node.hidden = value;
};

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const formatViewers = (n) =>
  n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n);

function uptime(startedAt) {
  if (!startedAt) return null;
  const minutes = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
  if (Number.isNaN(minutes) || minutes < 0) return null;
  const h = Math.floor(minutes / 60);
  return h ? `${h}h${String(minutes % 60).padStart(2, '0')}` : `${minutes}min`;
}

async function loadStatus() {
  state.snapshot = await LIVEWATCH.status();
  render();
}

function matches(s) {
  if (state.platform && s.platform !== state.platform) return false;
  if (state.job && s.job !== state.job) return false;
  if (state.search) {
    const haystack = `${s.personagem} ${s.channel} ${s.job}`.toLowerCase();
    if (!haystack.includes(state.search)) return false;
  }
  return true;
}

function liveCard(s) {
  const thumb = s.thumbnail ? `background-image:url('${encodeURI(s.thumbnail)}')` : '';
  const time = uptime(s.startedAt);
  const added = multiHas(s.platform, s.channel);
  const url = escapeHtml(s.liveUrl);
  const name = escapeHtml(s.personagem);

  return `
    <article class="card" data-id="${s.id}" data-platform="${s.platform}"
             data-channel="${escapeHtml(s.channel)}" data-personagem="${name}">
      <div class="card-thumb" style="${thumb}">
        <a class="thumb-link" href="${url}" target="_blank" rel="noopener"
           aria-label="Abrir ${name} na ${s.platform}"></a>
        <span class="tally">Ao vivo${time ? ` · ${time}` : ''}</span>
        <span class="viewers">${formatViewers(s.viewers)} espectadores</span>
        <button class="add-multi${added ? ' added' : ''}" type="button"
                title="${added ? 'Tirar do Multi' : 'Assistir no Multi'}"
                aria-label="${added ? 'Tirar do Multi' : 'Assistir no Multi'}"
                aria-pressed="${added}">${added ? '✓' : '+'}</button>
      </div>
      <a class="card-body" href="${url}" target="_blank" rel="noopener">
        <h3 class="card-name">${name}</h3>
        ${s.title ? `<p class="card-title">${escapeHtml(s.title)}</p>` : ''}
        <div class="meta">
          <span class="tag ${s.platform}">${s.platform === 'twitch' ? 'Twitch' : 'Kick'} · ${escapeHtml(s.channel)}</span>
          ${s.job ? `<span class="tag job">${escapeHtml(s.job)}</span>` : ''}
        </div>
      </a>
    </article>`;
}

/** Contador ao lado do link Multi no cabeçalho. */
function renderMultiCount() {
  const link = el('multi-link');
  if (!link) return;
  const total = readMulti().length;
  link.textContent = total ? `Multi (${total})` : 'Multi';
}

on('live-grid', 'click', (e) => {
  const button = e.target.closest('.add-multi');
  if (!button) return;
  e.preventDefault();

  const card = button.closest('.card');
  const { platform, channel, personagem } = card.dataset;
  const added = multiHas(platform, channel);

  if (added) multiRemove(platform, channel);
  else multiAdd({ platform, channel, personagem });

  button.classList.toggle('added', !added);
  button.textContent = added ? '+' : '✓';
  const label = added ? 'Assistir no Multi' : 'Tirar do Multi';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(!added));
  renderMultiCount();
});

/* ── Preview ao passar o mouse ────────────────────────────────
   O player entra só depois de meio segundo parado sobre o card,
   sempre mudo (navegador bloqueia autoplay com som) e com
   pointer-events desligado, pra que o clique continue abrindo
   o canal em vez de ser engolido pelo iframe.                  */

const preview = { cardId: null, timer: null, renderPending: false, player: null };

function kickPlayerUrl(channel) {
  return `https://player.kick.com/${encodeURIComponent(channel)}?muted=true&autoplay=true`;
}

function stopPreview() {
  clearTimeout(preview.timer);
  preview.timer = null;

  try {
    preview.player?.destroy?.();
  } catch {
    /* player já tinha ido embora junto com o nó */
  }
  preview.player = null;

  document.querySelectorAll('.card-preview').forEach((node) => node.remove());
  document.querySelectorAll('.card.previewing, .card.gated').forEach((card) => {
    card.classList.remove('previewing', 'gated');
  });
  preview.cardId = null;

  if (preview.renderPending) {
    preview.renderPending = false;
    render();
  }
}

async function mountTwitchPreview(card, thumb, channel, id) {
  const box = document.createElement('div');
  box.className = 'card-preview';
  box.setAttribute('title', `Prévia da live de ${channel}`);
  thumb.appendChild(box);
  card.classList.add('previewing');

  const Twitch = await loadTwitchSdk();
  // O mouse pode ter saído do card enquanto o SDK carregava.
  if (preview.cardId !== id || !box.isConnected) {
    box.remove();
    return;
  }

  const player = new Twitch.Player(box, {
    channel,
    parent: [location.hostname || 'localhost'],
    width: '100%',
    height: '100%',
    muted: true,
    autoplay: true,
    controls: false,
  });
  preview.player = player;

  let retries = 0;
  const forcePlay = () => {
    if (preview.player !== player) return;
    player.setMuted(true);
    player.play();
  };

  player.addEventListener(Twitch.Player.READY, forcePlay);
  player.addEventListener(Twitch.Player.PAUSE, () => {
    // Sem controles visíveis ninguém pausou de propósito: foi o navegador.
    if (retries++ < 3) setTimeout(forcePlay, 300);
  });

  /* Canal com aviso de conteúdo (+18) ignora play() e fica na tela de bloqueio:
     a Twitch exige um clique dentro do próprio player. Nesse caso devolvo o
     clique ao iframe e troco a etiqueta do card pra explicar. */
  setTimeout(() => {
    if (preview.player !== player) return;
    if (typeof player.isPaused === 'function' && !player.isPaused()) return;
    card.classList.add('gated');
  }, 2200);
}

function mountKickPreview(card, thumb, channel) {
  const frame = document.createElement('iframe');
  frame.className = 'card-preview';
  frame.src = kickPlayerUrl(channel);
  frame.allow = 'autoplay; encrypted-media';
  frame.setAttribute('scrolling', 'no');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('title', `Prévia da live de ${channel}`);
  thumb.appendChild(frame);
  card.classList.add('previewing');
}

function startPreview(card) {
  const { platform, channel, id } = card.dataset;
  if (!platform || !channel || preview.cardId === id) return;

  stopPreview();
  preview.cardId = id;

  preview.timer = setTimeout(() => {
    if (preview.cardId !== id || !card.isConnected) return;
    const thumb = card.querySelector('.card-thumb');
    if (!thumb || thumb.querySelector('.card-preview')) return;

    if (platform === 'twitch') {
      mountTwitchPreview(card, thumb, channel, id).catch(() => stopPreview());
    } else {
      mountKickPreview(card, thumb, channel);
    }
  }, 500);
}

on('live-grid', 'mouseover', (e) => {
  const card = e.target.closest('.card');
  if (card && preview.cardId !== card.dataset.id) startPreview(card);
});

on('live-grid', 'mouseout', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  // Ao entrar no iframe do player o relatedTarget vem nulo — não é saída de verdade.
  if (e.relatedTarget === null && card.querySelector('.card-preview')) return;
  if (!card.contains(e.relatedTarget)) stopPreview();
});

function offlineRow(s) {
  return `
    <a class="row" href="${escapeHtml(s.liveUrl)}" target="_blank" rel="noopener">
      <div class="row-main">
        <span class="row-name">${escapeHtml(s.personagem)}</span>
        <span class="row-sub">${s.platform}/${escapeHtml(s.channel)}</span>
        ${s.job ? `<span class="tag job">${escapeHtml(s.job)}</span>` : ''}
      </div>
      <span class="row-sub ${s.error ? 'row-err' : ''}">${s.error ? escapeHtml(s.error) : 'offline'}</span>
    </a>`;
}

function renderJobOptions(streamers) {
  const jobs = [...new Set(streamers.map((s) => s.job).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR')
  );
  const select = el('job-filter');
  if (!select || select.dataset.jobs === jobs.join('|')) return;
  select.dataset.jobs = jobs.join('|');
  select.innerHTML =
    '<option value="">Todos os jobs</option>' +
    jobs.map((j) => `<option value="${escapeHtml(j)}">${escapeHtml(j)}</option>`).join('');
  select.value = state.job;
}

function renderNotice(providers) {
  const problems = [];
  for (const [name, info] of Object.entries(providers || {})) {
    if (info.error) problems.push(`${name}: ${info.error}`);
    else if (name === 'twitch' && !info.configured && info.channels)
      problems.push(LIVEWATCH.static
        ? 'Twitch sem credenciais configuradas — os canais dela ficam sempre offline.'
        : 'Twitch sem TWITCH_CLIENT_ID/SECRET no .env — os canais dela ficam sempre offline.');
  }
  const notice = el('notice');
  if (!notice) return;
  notice.hidden = problems.length === 0;
  notice.textContent = problems.join('  ·  ');
}

/** No Pages o status chega a cada poucos minutos: mostra de quando é a leitura. */
function checkedLabel(checkedAt) {
  if (!LIVEWATCH.static || !checkedAt) return '';
  const d = new Date(checkedAt);
  if (Number.isNaN(d.getTime())) return '';
  return ` · atualizado às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function render() {
  const snap = state.snapshot;
  if (!snap) return;

  const all = snap.streamers || [];
  renderJobOptions(all);
  renderMultiCount();
  renderNotice(snap.providers);

  const visible = all.filter(matches);
  const live = visible.filter((s) => s.live);
  const offline = visible.filter((s) => !s.live);

  setText('count-live', all.filter((s) => s.live).length);
  setText('count-total', all.length);

  // Redesenhar a grade removeria o iframe que o usuário está assistindo.
  // Adia essa parte até o mouse sair do card.
  if (preview.cardId) {
    preview.renderPending = true;
  } else {
    setHtml('live-grid', live.map(liveCard).join(''));
  }
  setHidden('live-empty', live.length > 0);
  setText('live-count', `${live.length} de ${visible.length} exibidos${checkedLabel(snap.checkedAt)}`);

  setHtml('offline-rows', offline.map(offlineRow).join(''));
  setHidden('offline-empty', all.length > 0);
  setText('offline-count', offline.length ? `${offline.length}` : '');
}

on('search', 'input', (e) => {
  state.search = e.target.value.trim().toLowerCase();
  render();
});

on('job-filter', 'change', (e) => {
  state.job = e.target.value;
  render();
});

on('platform-chips', 'click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.platform = chip.dataset.platform;
  for (const c of el('platform-chips').children) {
    c.setAttribute('aria-pressed', String(c === chip));
  }
  render();
});

on('refresh', 'click', async () => {
  const button = el('refresh');
  button.disabled = true;
  button.classList.add('spinning');
  try {
    state.snapshot = await LIVEWATCH.refresh();
    render();
  } finally {
    button.disabled = false;
    button.classList.remove('spinning');
  }
});

loadStatus().catch(() => {
  setHidden('notice', false);
  setText('notice', LIVEWATCH.static
    ? 'Não consegui carregar o status agora. Tente de novo em instantes.'
    : 'Não consegui falar com o servidor. Ele está rodando?');
});

setInterval(() => loadStatus().catch(() => {}), 30000);

// A aba Multi escreve na mesma lista: mantém o + e o contador em dia.
window.addEventListener('storage', (e) => {
  if (e.key === MULTI_KEY) {
    renderMultiCount();
    render();
  }
});

renderMultiCount();
