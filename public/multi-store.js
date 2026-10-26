/* Lista de canais da aba Multi, compartilhada com o painel.
   Fica no localStorage: é preferência de quem está olhando, não dado do
   servidor — cada pessoa monta a própria grade sem atrapalhar as outras. */

const MULTI_KEY = 'livewatch-multi';

function readMulti() {
  try {
    const list = JSON.parse(localStorage.getItem(MULTI_KEY) || '[]');
    return Array.isArray(list) ? list.filter((s) => s && s.platform && s.channel) : [];
  } catch {
    return [];
  }
}

function writeMulti(list) {
  try {
    localStorage.setItem(MULTI_KEY, JSON.stringify(list));
  } catch {
    /* navegação privada ou storage cheio: a lista vale só nesta página */
  }
  return list;
}

function multiHas(platform, channel) {
  return readMulti().some((s) => s.platform === platform && s.channel === channel);
}

function multiAdd(entry) {
  const list = readMulti();
  if (list.some((s) => s.platform === entry.platform && s.channel === entry.channel)) return list;
  list.push({
    platform: entry.platform,
    channel: entry.channel,
    personagem: entry.personagem || entry.channel,
  });
  return writeMulti(list);
}

function multiRemove(platform, channel) {
  return writeMulti(readMulti().filter((s) => !(s.platform === platform && s.channel === channel)));
}

/** Mesma leitura de link do servidor, do lado do navegador. */
function parseChannelUrl(input) {
  if (!input) return null;
  let url = String(input).trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const channel = (parsed.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
    if (!channel) return null;
    if (host.endsWith('twitch.tv')) return { platform: 'twitch', channel };
    if (host.endsWith('kick.com')) return { platform: 'kick', channel };
  } catch {
    return null;
  }
  return null;
}

/* SDK oficial do player da Twitch, usado pelo preview do painel e pela grade
   do Multi. O iframe cru ignora o autoplay em vários casos; com o SDK dá pra
   esperar o READY e comandar play/mudo na mão. */
let twitchSdk = null;

function loadTwitchSdk() {
  if (twitchSdk) return twitchSdk;
  twitchSdk = new Promise((resolve, reject) => {
    if (window.Twitch?.Player) return resolve(window.Twitch);
    const script = document.createElement('script');
    script.src = 'https://player.twitch.tv/js/embed/v1.js';
    script.onload = () => resolve(window.Twitch);
    script.onerror = () => reject(new Error('não consegui carregar o player da Twitch'));
    document.head.appendChild(script);
  });
  return twitchSdk;
}
