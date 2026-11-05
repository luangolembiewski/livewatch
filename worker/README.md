# Livewatch API (Cloudflare Worker)

O GitHub Pages só atualiza quando a Action roda, e o agendamento do GitHub atrasa
(às vezes 30–60 min). Este Worker consulta Twitch/Kick na hora em que o painel pede,
com cache de 45 s, e o site no Pages lê dele. As chaves ficam como *secrets* no
Cloudflare — nunca no navegador nem no repositório.

## Subir (uma vez)

Precisa de uma conta grátis em https://dash.cloudflare.com (plano free: 100 mil
requisições/dia, sobra muito).

```bash
cd worker
npx wrangler login
npx wrangler secret put TWITCH_CLIENT_ID
npx wrangler secret put TWITCH_CLIENT_SECRET
npx wrangler secret put KICK_CLIENT_ID
npx wrangler secret put KICK_CLIENT_SECRET
npx wrangler deploy
```

O deploy mostra a URL, tipo `https://livewatch-api.<seu-usuario>.workers.dev`.
Teste abrindo `<url>/status/padrao` no navegador.

## Ligar no site

No GitHub: **Settings → Secrets and variables → Actions → aba Variables → New repository variable**

- Nome: `LIVEWATCH_API`
- Valor: a URL do Worker (sem `/` no final)

Depois rode a Action **Painel no GitHub Pages** (aba Actions → Run workflow).
Pronto: o painel passa a ler do Worker a cada 30 s. Se o Worker cair, ele volta
sozinho para o `status/<config>.json` gerado pela Action.

Cadastro novo (configs/*.json) aparece no Worker em até ~5 min (cache do GitHub raw),
sem precisar de deploy.
