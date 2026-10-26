/*
 * Cadastro pelo GitHub Pages (sem servidor).
 * O pedido (com a senha) é criptografado aqui no navegador com a chave PÚBLICA
 * (cadastro-key.js) e vai numa issue do repositório. Só a Action, que tem a chave
 * privada e o ADMIN_PASSWORD nos Secrets, consegue abrir, conferir e gravar.
 * Ninguém que ler a issue vê a senha nem o conteúdo.
 */
(function () {
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function encrypt(obj) {
    const pub = await crypto.subtle.importKey(
      'spki', fromB64(window.LIVEWATCH_PUBLIC_KEY),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
    );
    const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, data);
    const raw = await crypto.subtle.exportKey('raw', aes);
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw);
    return btoa(JSON.stringify({ v: 1, k: b64(wrapped), iv: b64(iv), d: b64(ct) }));
  }

  async function send(request) {
    const repo = LIVEWATCH.repo();
    if (!repo) throw new Error('Não consegui descobrir o repositório do GitHub.');
    if (!window.LIVEWATCH_PUBLIC_KEY) throw new Error('Chave do cadastro não carregou.');

    // Abre a aba antes do await, senão o navegador bloqueia como pop-up.
    const tab = window.open('about:blank', '_blank');
    try {
      const sealed = await encrypt({ ...request, ts: Date.now() });
      const labels = { create: 'adicionar', update: 'editar', delete: 'remover' };
      const who = request.entry?.personagem ? ` ${request.entry.personagem}` : '';
      const title = `[livewatch] ${labels[request.op] || request.op}${who}`.slice(0, 120);
      const body = [
        'Pedido de cadastro do Livewatch. Só clique em **Create**, não edite o bloco abaixo.',
        '',
        '```livewatch',
        sealed,
        '```',
      ].join('\n');
      const url = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      if (tab) tab.location.href = url;
      else location.href = url;
    } catch (err) {
      tab?.close();
      throw err;
    }
  }

  window.LivewatchCadastro = { send };
})();
