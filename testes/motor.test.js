// Testes do motor da LDF Calc. Rodar: node --test testes/
// Cada caso vem das tabelas oficiais (Shopee artigo 26839, ML ajuda 40538 e 49972, Amazon precos)
// ou de contas conferidas à mão. Se um teste falhar, a versão não deve ser publicada.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../v2/motor.js");
const TX = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "taxas.json"), "utf8"));

const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: esperado ${b}, veio ${a}`);
const cfgBase = { mlcom: 0.14, pesoKg: 0.3, mlfrete100: 20, fsSel: false, fsin: 0, amzcom: 0.12, amzfrete79: 12, outroPct: 0.16, outroFixo: 0 };
const custos = { imp: 0.04, ads: 0, op: 0, afil: 0, dev: 0, emb: 1, parte: 1 };
const ent = (o) => ({ preco: 22.9, unidades: 3, lote: 0, loteQtd: 1, custos, ...o });

test("tabela de taxas publicada é válida", () => {
  assert.deepEqual(M.validarTabela(TX), []);
});

test("Shopee: faixas de comissão e taxa fixa", () => {
  const casos = [[22.9, 4.58, 4.5], [79.99, 15.998, 4.5], [80, 11.2, 16], [99.99, 13.9986, 16], [100, 14, 20], [199.99, 27.9986, 20], [200, 28, 26]];
  for (const [P, com, fixo] of casos) {
    const t = M.taxas("shopee", P, cfgBase, TX);
    perto(t.com, com, "comissão Shopee em " + P);
    perto(t.fixo, fixo, "fixo Shopee em " + P);
  }
  const barato = M.taxas("shopee", 5, cfgBase, TX);
  perto(barato.fixo, 2.5, "Shopee abaixo de R$ 9 cobra metade do preço");
});

test("Mercado Envios: tabela por peso e preço", () => {
  perto(M.taxas("ml", 24.9, { ...cfgBase, pesoKg: 1.03 }, TX).fixo, 7.35, "percarbonato 1 kg a 24,90");
  perto(M.taxas("ml", 22.9, { ...cfgBase, pesoKg: 0.2 }, TX).fixo, 6.85, "item leve a 22,90");
  perto(M.taxas("ml", 18.9, { ...cfgBase, pesoKg: 0.2 }, TX).fixo, 5.65, "item leve abaixo de 19");
  perto(M.taxas("ml", 79, { ...cfgBase, pesoKg: 0.2 }, TX).fixo, 12.95, "a partir de 79 muda a faixa");
  const acima = M.taxas("ml", 150, cfgBase, TX);
  assert.equal(acima.manual, true, "acima de R$ 100 o envio é informado à mão");
  perto(acima.fixo, 20, "envio informado");
});

test("Full Super: tabela oficial (ajuda 49972)", () => {
  const c = { ...cfgBase, pesoKg: 1.03 };
  perto(M.taxas("full", 24.9, c, TX).envio, 2.4, "demais, 1–1,5 kg, R$ 19–28,99");
  perto(M.taxas("full", 24.9, { ...c, fsSel: true }, TX).envio, 1.6, "selecionados, mesma faixa");
  perto(M.taxas("full", 205, c, TX).envio, 25.45, "a partir de R$ 199");
  perto(M.taxas("full", 10, { ...cfgBase, pesoKg: 4.5 }, TX).envio, 2.5, "abaixo de R$ 29 paga no máximo 25% do preço");
  assert.equal(M.taxas("full", 6, cfgBase, TX).abaixoMinimo, true, "preço mínimo R$ 8");
  const comEntrada = M.taxas("full", 24.9, { ...c, fsin: 0.8, unidades: 3 }, TX);
  perto(comEntrada.fixo, 2.4 + 2.4, "entrada no Full multiplica pelas unidades do anúncio");
});

test("Amazon DBA: faixas e comissão mínima", () => {
  perto(M.taxas("amz", 25, cfgBase, TX).fixo, 4.5, "abaixo de 30");
  perto(M.taxas("amz", 35, cfgBase, TX).fixo, 6.5, "30 a 49,99");
  perto(M.taxas("amz", 60, cfgBase, TX).fixo, 6.75, "50 a 78,99");
  perto(M.taxas("amz", 5, cfgBase, TX).com, 1, "comissão mínima R$ 1");
  assert.equal(M.taxas("amz", 90, cfgBase, TX).manual, true, "acima de 79 envio informado");
});

test("Peso cobrado: maior entre real e cúbico (÷ 6000)", () => {
  const a = M.pesoCobrado({ g: 1030, c: 17, l: 25, a: 8 });
  perto(a.kg, 1.03, "percarbonato conta pelo peso real");
  assert.equal(a.cubico, false);
  const b = M.pesoCobrado({ g: 400, c: 30, l: 30, a: 20 });
  perto(b.kg, 3, "caixa grande conta pelo cúbico");
  assert.equal(b.cubico, true);
  assert.equal(M.pesoCobrado({ g: 0, c: 0, l: 0, a: 0 }), null);
});

test("Caso Tek Bond: kit 3 a R$ 22,90 na Shopee", () => {
  const e = ent({ lote: 12, loteQtd: 3 });
  const v = M.venda("shopee", 22.9, e, cfgBase, TX);
  perto(v.lucro, -0.096, "lucro com custo de R$ 12 o trio");
  const max = M.custoMaximo("shopee", 22.9, e, cfgBase, TX, 0.15);
  perto(max, 2.8233, "pode pagar até R$ 2,82/un para 15%");
  perto(M.precoMinimo("shopee", e, cfgBase, TX, 0), 23.03, "preço de empate");
  perto(M.precoMinimo("shopee", e, cfgBase, TX, 0.15), 28.69, "preço para 15%");
  const eco = M.economia(4, max, 300);
  perto(eco.total, 353.10, "300 unidades a R$ 4 vs R$ 2,8233 (máximo exato)");
});

test("Zona morta: R$ 85 na Shopee rende menos que R$ 79,99", () => {
  const z = M.zonaMorta("shopee", 85, ent({ lote: 12, loteQtd: 3 }), cfgBase, TX);
  assert.ok(z, "deve detectar zona morta");
  perto(z.preco, 79.99, "preço que rende mais");
  perto(z.compensaAPartirDe, 88.17, "só compensa passar a faixa a partir de (0,82P − 16 ≥ 0,76 × 79,99 − 4,50)");
  assert.equal(M.zonaMorta("shopee", 60, ent({ lote: 12, loteQtd: 3 }), cfgBase, TX), null);
});

test("Kits: preço mínimo cresce com o kit e o por unidade cai", () => {
  const k = M.kits("shopee", ent({ lote: 12, loteQtd: 3 }), cfgBase, TX, 0.15);
  assert.deepEqual(k.map((x) => x.unidades), [1, 2, 3, 5, 10]);
  for (let i = 1; i < k.length; i++) assert.ok(k[i].porUnidade < k[i - 1].porUnidade, "kit maior dilui a taxa fixa");
});

test("Parte da LDF divide só o lucro positivo", () => {
  const e = ent({ lote: 6, loteQtd: 3, custos: { ...custos, parte: 0.5 } });
  const v = M.venda("shopee", 22.9, e, cfgBase, TX);
  perto(v.parteLDF, v.lucro * 0.5, "metade do lucro");
});
