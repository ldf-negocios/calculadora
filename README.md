# LDF-calculadora-marketplaces

Calculadora de marketplaces da LDF (Shopee, Mercado Livre, Amazon).
Abra no celular e adicione à tela de início.

`taxas.json` é atualizado toda segunda-feira por uma verificação automática das páginas oficiais dos canais.

## Testes e publicação
- `v2/motor.js`: motor de cálculo (funções puras, sem tela).
- `testes/motor.test.js`: casos conferidos nas tabelas oficiais. Rodar: `node --test testes/motor.test.js`.
- `.github/workflows/publicar.yml`: a cada push na main, roda os testes e só publica no GitHub Pages se todos passarem.
