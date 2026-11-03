# Servidor da LDF Calc (Mercado Livre)

Arquivo `worker.js`, publicado como Cloudflare Worker **ldf-calc-ml**
(https://ldf-calc-ml.ldfnegociosempresariais.workers.dev).

Configuração no painel do Cloudflare (nunca no código):
- Segredos `ML_CLIENT_ID` e `ML_CLIENT_SECRET` (Settings › Variables and Secrets).
- Vinculação KV com o nome `KV` (Settings › Bindings › KV Namespace) — guarda a autorização da conta LDF.

Rotas:
- `/login` → manda para o login do Mercado Livre; o ML devolve ao app com `?code=`.
- `/callback?code=` → troca o code por token e guarda no KV (login único da conta LDF).
- `/status` → diz se a conta está conectada.
- `/buscar?q=termo` → até 50 anúncios, devolve os 20 mais vendidos com preço, Full, vendidos, data de criação e vendas/mês estimadas (vendidos ÷ meses no ar).
- `/tarifa?cat=MLBxxx&preco=50` → comissão Clássico/Premium da categoria (token do aplicativo).

Para atualizar: Worker › Editar código › colar `worker.js` › Deploy.
