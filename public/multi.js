const el = (id) => document.getElementById(id);

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const keyOf = (s) => `${s.platform}:${s.channel}`;

function notify(message) {
  const notice = el('notice');
  notice.hidden = !message;
  notice.textContent = message || '';
  if (message) setTimeout(() => { notice.hidden = true; }, 4000);
}

/* Players da Twitch vivem aqui, pra dar pra comandar som e play depois. */
const players = new Map();

function kickSrc(channel) {
  return `https://player.kick.com/${encodeURIComponent(channel)}?muted=false&autoplay=true`;
}

/* A Twitch entra MUDA de propósito: com áudio ela começa, o navegador barra o
   som e ela se pausa sozinha — que é exatamente o "volta a pausar". Muda ela
   nunca para. Logo depois eu tento tirar o mudo; se o navegador recusar, o
   player pausa, e aí devolvo o mudo e mando tocar de novo. Assim a live nunca
   fica parada, e o botão "Ativar som" resolve o áudio num clique de verdade. */
async function mountTwitchTile(tile, entry) {
  const box = tile.querySelector('.tile-player');
  const key = keyOf(entry);

  const Twitch = await loadTwitchSdk();
  if (!box.isConnected) return;

  const player = new Twitch.Player(box, {
    channel: entry.channel,
    parent: [location.hostname || 'localhost'],
    width: '100%',
    height: '100%',
    muted: true,
    autoplay: true,
    controls: true,
  });
  players.set(key, player);

  // Só forço play nos primeiros segundos: depois disso, pausa é coisa sua.
  const guardUntil = Date.now() + 10000;

  player.addEventListener(Twitch.Player.READY, () => {
    player.play();
    player.setMuted(false);
  });

  player.addEventListener(Twitch.Player.PAUSE, () => {
    if (Date.now() > guardUntil) return;
    player.setMuted(true);
    player.play();
  });
}

function tileHtml(entry) {
  const label = entry.platform === 'twitch' ? 'Twitch' : 'Kick';
  return `
    <div class="tile" data-key="${escapeHtml(keyOf(entry))}"
         data-platform="${escapeHtml(entry.platform)}" data-channel="${escapeHtml(entry.channel)}">
      <div class="tile-head">
        <span class="tile-name">${escapeHtml(entry.personagem)}</span>
        <span class="tag ${entry.platform}">${label} · ${escapeHtml(entry.channel)}</span>
        <div class="tile-actions">
          <button data-action="fullscreen" title="Tela cheia só deste" aria-label="Tela cheia só deste">⛶</button>
          <button data-action="remove" title="Tirar da grade" aria-label="Tirar da grade">×</button>
        </div>
      </div>
      <div class="tile-player">
        ${entry.platform === 'kick'
          ? `<iframe class="kick-player" src="${escapeHtml(kickSrc(entry.channel))}" allowfullscreen
                     allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                     title="Live de ${escapeHtml(entry.channel)}"></iframe>`
          : ''}
      </div>
    </div>`;
}

function applyLayout(count) {
  const choice = el('layout').value;
  const auto = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  el('grid').style.setProperty('--cols', choice === 'auto' ? auto : choice);
}

/* Redesenhar a grade inteira recarregaria todo mundo (e daria pré-roll de
   novo em quem já estava assistindo). Então só mexo em quem entrou ou saiu. */
function syncGrid() {
  const list = readMulti();
  const grid = el('grid');
  const wanted = new Set(list.map(keyOf));

  for (const tile of [...grid.children]) {
    if (wanted.has(tile.dataset.key)) continue;
    try {
      players.get(tile.dataset.key)?.destroy?.();
    } catch {
      /* já foi embora junto com o nó */
    }
    players.delete(tile.dataset.key);
    tile.remove();
  }

  const existing = new Set([...grid.children].map((tile) => tile.dataset.key));
  for (const entry of list) {
    if (existing.has(keyOf(entry))) continue;
    grid.insertAdjacentHTML('beforeend', tileHtml(entry));
    if (entry.platform === 'twitch') {
      const tile = grid.lastElementChild;
      mountTwitchTile(tile, entry).catch(() => notify('Não consegui carregar o player da Twitch.'));
    }
  }

  // Reordena sem recriar: mover o nó preserva o player que já está tocando.
  list.forEach((entry, index) => {
    const tile = grid.querySelector(`.tile[data-key="${CSS.escape(keyOf(entry))}"]`);
    if (tile && grid.children[index] !== tile) grid.insertBefore(tile, grid.children[index] || null);
  });

  el('empty').hidden = list.length > 0;
  el('count-tiles').textContent = list.length;
  applyLayout(list.length);
}

function add(entry) {
  if (multiHas(entry.platform, entry.channel)) {
    notify(`${entry.channel} já está na grade.`);
    return;
  }
  multiAdd(entry);
  syncGrid();
}

async function loadPicker() {
  try {
    const snap = await LIVEWATCH.status();
    const streamers = [...(snap.streamers || [])].sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      return a.personagem.localeCompare(b.personagem, 'pt-BR');
    });
    el('pick').innerHTML =
      '<option value="">Adicionar do cadastro…</option>' +
      streamers
        .map((s) => {
          const mark = s.live ? '● ' : '○ ';
          const label = `${mark}${s.personagem} — ${s.platform}/${s.channel}`;
          return `<option value="${escapeHtml(keyOf(s))}" data-personagem="${escapeHtml(s.personagem)}">
                    ${escapeHtml(label)}
                  </option>`;
        })
        .join('');
  } catch {
    notify('Não consegui carregar o cadastro. O servidor está rodando?');
  }
}

el('pick').addEventListener('change', (e) => {
  const option = e.target.selectedOptions[0];
  if (!e.target.value) return;
  const [platform, channel] = e.target.value.split(':');
  add({ platform, channel, personagem: option.dataset.personagem || channel });
  e.target.value = '';
});

el('add').addEventListener('click', () => {
  const parsed = parseChannelUrl(el('manual').value);
  if (!parsed) {
    notify('Use um link da twitch.tv ou da kick.com.');
    return;
  }
  add({ ...parsed, personagem: parsed.channel });
  el('manual').value = '';
});

el('manual').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('add').click();
});

el('grid').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  const tile = button.closest('.tile');

  if (button.dataset.action === 'remove') {
    multiRemove(tile.dataset.platform, tile.dataset.channel);
    syncGrid();
    return;
  }

  if (document.fullscreenElement) document.exitFullscreen();
  else tile.requestFullscreen?.();
});

/* Dentro do clique o navegador libera o áudio: na Twitch basta comandar o
   SDK (sem recarregar nada), na Kick o jeito é remontar o iframe. */
el('sound').addEventListener('click', () => {
  for (const player of players.values()) {
    try {
      player.setMuted(false);
      player.play();
    } catch {
      /* player em transição, o próximo clique pega */
    }
  }
  for (const frame of el('grid').querySelectorAll('iframe.kick-player')) {
    frame.src = frame.src;
  }
});

el('fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else el('grid').requestFullscreen?.();
});

el('layout').addEventListener('change', () => applyLayout(readMulti().length));

el('clear').addEventListener('click', () => {
  if (!readMulti().length || !confirm('Tirar todas as lives da grade?')) return;
  writeMulti([]);
  syncGrid();
});

// O + do painel escreve no mesmo localStorage: com as duas abas abertas,
// a grade aqui recebe o canal novo na hora.
window.addEventListener('storage', (e) => {
  if (e.key === MULTI_KEY) syncGrid();
});

document.addEventListener('fullscreenchange', () => {
  el('fullscreen').textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
});

syncGrid();
loadPicker();
