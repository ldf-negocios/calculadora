# Servidor da LDF Calc (Mercado Livre)

Arquivo `worker.js`, publicado como Cloudflare Worker.
Segredos cadastrados no painel do Cloudflare (Settings › Variables and Secrets), nunca no código:
- `ML_CLIENT_ID`
- `ML_CLIENT_SECRET`

Rotas: `/buscar?q=termo` (anúncios do ML com preço, Full, vendidos, data de criação e vendas/mês estimadas) e `/tarifa?cat=MLBxxx&preco=50`.
