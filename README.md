# Metropole Livewatch

Monitor de transmissões na **Twitch** e na **Kick** com cadastro de
`Personagem · Link da live · Job`.

- `/` — painel público: quem está no ar agora, com viewers, título e tempo de live.
- `/multi` — grade multi-live: vários canais da Twitch e da Kick tocando juntos.
- `/config` — cadastro do elenco (protegido por senha do `.env`).

O servidor consulta as plataformas a cada 60 s (configurável) e guarda o
resultado em memória, então o painel pode ter 100 abas abertas sem gastar
rate limit a mais.

Fica em `Ferramentas/Livewatch/` (dá para abrir também pelo `Painel.html` das Ferramentas).
Todos os caminhos abaixo são relativos a essa pasta.

---

## Instalação

```bash
npm install
cp .env.example .env    # preencha as chaves
npm start
```

Painel em `http://localhost:3000`, cadastro em `http://localhost:3000/config`.

Requer Node 18+ (usa `fetch` nativo). Testado no Node 22.

As chaves (Twitch, Kick, senha) ficam **só** no `.env`, que está no `.gitignore` —
nunca no código nem no repositório. O `.env` é lido da pasta do Livewatch, mesmo que
o servidor seja iniciado de outro lugar.

### Atalhos no Windows

Três arquivos na raiz do projeto, é só dar dois cliques:

| Arquivo | O que faz |
|---|---|
| `Iniciar Livewatch.bat` | Instala as dependências na primeira vez, cria o `.env`, sobe o servidor e abre o navegador. Deixa o terminal aberto com os logs. |
| `Iniciar Livewatch (segundo plano).vbs` | Mesma coisa, sem janela de terminal. Rode o `.bat` uma vez antes. |
| `Parar Livewatch.bat` | Mata o processo que estiver ocupando a porta 3000. |

Para ter na área de trabalho: clique com o botão direito no `Iniciar Livewatch.bat`
→ **Mostrar mais opções** → **Enviar para** → **Área de trabalho (criar atalho)**.
No atalho criado, em **Propriedades** → **Alterar ícone**, dá para escolher um
ícone melhor que o da engrenagem padrão.

Os atalhos usam a própria pasta onde estão (`%~dp0`), então funcionam em qualquer
lugar onde a pasta `Ferramentas` for copiada.

Para subir junto com o Windows, aperte `Win + R`, digite `shell:startup` e jogue
um atalho do `.vbs` dentro da pasta que abrir.

---

## Multi

O botão **+** no canto das miniaturas do painel joga o canal na grade do `/multi`.
Clicando de novo ele sai. O contador ao lado do link *Multi* mostra quantos estão lá.

A lista fica no `localStorage` do navegador, não no servidor: cada pessoa monta a
própria grade, e com as duas abas abertas o `+` do painel aparece na grade na hora.

Dentro do `/multi`:

- **Adicionar do cadastro** — quem está ao vivo aparece primeiro, com `●`.
- **Colar link** — aceita `twitch.tv/canal` e `kick.com/canal`.
- **Colunas** — automático pelo número de lives, ou fixo em 1 a 4.
- **Tela cheia** — a grade inteira; o `⛶` de cada card joga só aquele stream em tela cheia.

Os players entram tocando, com os controles nativos ligados. Sobre o áudio: navegador
nenhum deixa um vídeo começar com som sem um clique na página. A Twitch, se tentar,
começa e **se pausa sozinha** — por isso ela sobe muda pelo SDK oficial e o código
tenta tirar o mudo em seguida; se o navegador recusar, ele devolve o mudo e manda
tocar, de modo que a live nunca fica parada. O botão **Ativar som** desmuta tudo de
uma vez, aí sim dentro de um clique de verdade (na Twitch sem recarregar nada).

Sobre anúncio: o embed é um iframe de outro domínio, então o projeto não interfere
neles; quem bloqueia (ou não) é a extensão do seu navegador.

---

## Onde pegar as chaves

### Twitch (obrigatório para monitorar canais da Twitch)

1. Acesse <https://dev.twitch.tv/console/apps> e clique em **Register Your Application**.
2. Preencha:
   - **Name**: qualquer coisa (ex.: `Metropole Livewatch`)
   - **OAuth Redirect URLs**: `http://localhost:3000` — obrigatória no formulário, mas não é usada aqui
   - **Category**: `Application Integration`
   - **Client Type**: `Confidential`
3. Copie o **Client ID** e clique em **New Secret** para gerar o **Client Secret**.
4. Cole em `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET` no `.env`.

O app usa o fluxo *client credentials* (app access token) — não precisa de
login de usuário nem de autorização dos streamers, já que status de live é
informação pública.

### Kick (opcional, mas recomendado)

1. Acesse <https://kick.com/settings/developer> e crie uma aplicação.
2. Copie **Client ID** e **Client Secret** para `KICK_CLIENT_ID` e `KICK_CLIENT_SECRET`.

Sem essas chaves, o app cai no endpoint público `kick.com/api/v2/channels/{slug}`.
Funciona na sua máquina, mas em VPS o Cloudflare costuma bloquear — quando
isso acontece o painel mostra o aviso em vez de fingir que o canal está offline.

---

## Cadastro

No formulário de `/config` você informa **Personagem**, **Link da live** e **Job**. A plataforma e o nome do canal saem automaticamente do link:

| Link digitado | Plataforma | Canal |
|---|---|---|
| `twitch.tv/gaules` | twitch | `gaules` |
| `https://www.twitch.tv/Canal?x=1` | twitch | `canal` |
| `kick.com/coringa` | kick | `coringa` |

Cada canal só pode estar cadastrado uma vez.

Os dados ficam na config ativa, `configs/<nome>.json` (escrita atômica, sem risco de
arquivo pela metade). O botão **Exportar JSON** baixa o elenco inteiro.

---

## Configs (um elenco por pessoa ou equipe)

No topo de todas as páginas tem **Config: [lista]**:

- **Lista** — troca o elenco que o painel monitora. A escolha fica lembrada no servidor
  (`data/ativo.json`), então vale para todas as abas e continua depois de reiniciar.
- **Nova** — cria `configs/<nome>.json` vazia ou como cópia da atual, e passa a usar ela.
- **Salvar como…** — grava o elenco atual com outro nome e passa a usar a cópia.

Nomes: só letras minúsculas, números, `_` e `-` (ex.: `equipe-policia`).
Trocar, criar e salvar pedem a mesma senha do cadastro (`ADMIN_PASSWORD`).

A pasta `configs/` vai pro git (é só lista de canais públicos) — `configs/exemplo.json`
serve de modelo. A pasta `data/` e o `.env` ficam só na sua máquina.

**Vindo de uma versão antiga?** Se existir `data/streamers.json` e ainda não houver
`configs/padrao.json`, o servidor copia o elenco antigo para `configs/padrao.json` na
primeira vez que sobe e começa usando ele. O arquivo antigo não é apagado.

---

## API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/status` | Snapshot em cache com todos os status |
| `POST` | `/api/status/refresh` | Força uma nova leitura agora |
| `GET` | `/api/streamers` | Lista o cadastro |
| `POST` | `/api/streamers` | Cria 🔒 |
| `PUT` | `/api/streamers/:id` | Atualiza 🔒 |
| `DELETE` | `/api/streamers/:id` | Remove 🔒 |
| `POST` | `/api/streamers/import` | Importa uma lista de uma vez 🔒 |
| `GET` | `/api/health` | Diz se as credenciais estão configuradas |
| `GET` | `/api/configs` | Lista as configs e diz qual está ativa |
| `GET` | `/api/configs/:nome` | Lê o elenco de uma config |
| `POST` | `/api/configs/active` | Troca a config ativa — `{ "name": "exemplo" }` 🔒 |
| `POST` | `/api/configs` | Cria — `{ "name", "from": "empty" \| "current", "overwrite"? }` 🔒 |

🔒 = exige o header `x-admin-password` com o valor de `ADMIN_PASSWORD`.

### Importar o elenco de uma vez

```bash
curl -X POST http://localhost:3000/api/streamers/import \
  -H 'Content-Type: application/json' \
  -H 'x-admin-password: SUA_SENHA' \
  -d '[
    {"personagem":"Vito Moretti","liveUrl":"twitch.tv/canal1","job":"corridas"},
    {"personagem":"Ana Ferraz","liveUrl":"kick.com/canal2","job":"mecanico"}
  ]'
```

Retorna quantos entraram e quais foram ignorados, com o motivo. Entra na config ativa.

---

## Colocar no ar

Atrás de um Nginx com proxy reverso e `pm2 start server.js --name livewatch`.
Um detalhe que vale lembrar: `ADMIN_PASSWORD` vazio libera a edição sem senha,
então em servidor exposto sempre preencha.

Se quiser embutir o painel num site ou no Discord, `/api/status` já devolve
tudo em JSON e aceita requisição de qualquer origem interna do seu proxy.
