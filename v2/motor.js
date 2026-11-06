/* Motor de cálculo da LDF Calc — funções puras, sem tela.
   Usado pelo app (window.Motor) e pelos testes automáticos (require).
   Toda regra de canal fica aqui; a tela só lê e mostra. */
(function (raiz, fabrica) {
  const M = fabrica();
  if (typeof module === "object" && module.exports) module.exports = M;
  else raiz.Motor = M;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CANAIS = {
    shopee: "Shopee",
    ml: "Mercado Livre",
    full: "ML Full Super",
    amz: "Amazon",
    outro: "Outro canal",
  };
  // faixas de peso do envio normal do ML (kg, limite superior)
  const PESOS_ML = [0.3, 0.5, 1, 1.5, 2, 3, 4, 5];
  const DIVISOR_CUBICO = 6000; // ML: C x L x A (cm) / 6000 = kg

  const r2 = (n) => Math.round(n * 100) / 100;

  /* Peso cobrado: o maior entre o real e o cúbico. Entradas em g e cm. */
  function pesoCobrado(p) {
    if (!p) return null;
    const real = p.g > 0 ? p.g / 1000 : 0;
    const cub = p.c > 0 && p.l > 0 && p.a > 0 ? (p.c * p.l * p.a) / DIVISOR_CUBICO : 0;
    if (!real && !cub) return null;
    const kg = Math.max(real, cub);
    return { real, cub, kg, cubico: cub > real };
  }

  function faixaPesoML(kg) {
    let i = PESOS_ML.findIndex((x) => kg <= x + 1e-9);
    const acima = i < 0;
    if (acima) i = PESOS_ML.length - 1;
    return { i, acima };
  }

  /* Taxas do canal num preço P. Devolve comissão (R$), fixo (R$: taxa fixa + envio) e detalhes. */
  function taxas(canal, P, cfg, TX) {
    const kg = cfg.pesoKg > 0 ? cfg.pesoKg : 0.3;
    if (canal === "shopee") {
      const S = TX.shopee;
      const f = S.faixas.find((x) => x.ate == null || P < x.ate) || S.faixas[S.faixas.length - 1];
      const pct = f.pct / 100;
      if (P < S.minPreco) return { com: pct * P, fixo: P * S.minFracao, pct, rotulo: "taxa fixa = " + S.minFracao * 100 + "% do preço" };
      return { com: pct * P, fixo: f.fixo, pct, rotulo: "taxa fixa" };
    }
    if (canal === "full") {
      const F = TX.ml.fullsuper;
      let w = F.pesos.findIndex((x) => x == null || kg <= x + 1e-9);
      if (w < 0) w = F.pesos.length - 1;
      let b = F.limites.findIndex((x) => P < x);
      if (b < 0) b = F.limites.length;
      let envio = (cfg.fsSel ? F.selecionados : F.demais)[w][b];
      if (P < F.tetoAte) envio = Math.min(envio, F.tetoPct * P);
      const entrada = (cfg.fsin || 0) * (cfg.unidades || 1);
      return { com: cfg.mlcom * P, fixo: envio + entrada, envio, entrada, pct: cfg.mlcom, rotulo: "envio Full Super", abaixoMinimo: P < F.minPreco };
    }
    if (canal === "ml") {
      const L = TX.ml.limites;
      const fp = faixaPesoML(kg);
      if (P > L[L.length - 1]) return { com: cfg.mlcom * P, fixo: cfg.mlfrete100 || 0, pct: cfg.mlcom, rotulo: "envio informado", manual: true, pesoAcima: fp.acima };
      let b = L.findIndex((x) => P < x);
      if (b < 0) b = L.length - 1;
      return { com: cfg.mlcom * P, fixo: TX.ml.envio[fp.i][b], pct: cfg.mlcom, rotulo: "envio Mercado Envios", pesoAcima: fp.acima };
    }
    if (canal === "amz") {
      const A = TX.amz;
      const f = A.faixas.find((x) => P < x.ate);
      return { com: Math.max(cfg.amzcom * P, A.minCom), fixo: f ? f.fixo : cfg.amzfrete79 || 0, pct: cfg.amzcom, rotulo: "envio DBA", manual: !f };
    }
    return { com: cfg.outroPct * P, fixo: cfg.outroFixo || 0, pct: cfg.outroPct, rotulo: "taxa fixa" };
  }

  /* Resultado de uma venda. op = custos da operação em fração do preço (imp, ads, op, afil, dev) + emb (R$) */
  function venda(canal, P, ent, cfg, TX) {
    const c = { ...cfg, unidades: ent.unidades };
    const t = taxas(canal, P, c, TX);
    const custoUn = ent.loteQtd > 0 ? ent.lote / ent.loteQtd : 0;
    const produto = custoUn * ent.unidades;
    const o = ent.custos;
    const pctVar = o.imp + o.ads + o.op + o.afil + o.dev;
    const variaveis = pctVar * P;
    const lucro = P - t.com - t.fixo - variaveis - o.emb - produto;
    return {
      canal, P, t, custoUn, produto,
      imp: o.imp * P, ads: o.ads * P, op: o.op * P, afil: o.afil * P, dev: o.dev * P, emb: o.emb,
      lucro, margem: P > 0 ? lucro / P : 0,
      parteLDF: lucro > 0 ? lucro * o.parte : lucro,
    };
  }

  /* Custo máximo por unidade para ter margem m vendendo a P. */
  function custoMaximo(canal, P, ent, cfg, TX, m) {
    const x = venda(canal, P, { ...ent, lote: 0 }, cfg, TX);
    return (x.lucro - m * P) / ent.unidades;
  }

  function limites(canal, TX) {
    if (canal === "shopee") return TX.shopee.faixas.filter((f) => f.ate != null).map((f) => f.ate);
    if (canal === "ml") return TX.ml.limites.slice();
    if (canal === "full") return TX.ml.fullsuper.limites.slice();
    if (canal === "amz") return TX.amz.faixas.map((f) => f.ate);
    return [];
  }

  /* Menor preço (centavos) com lucro >= m*P. Dentro de cada faixa o lucro cresce com o preço; os saltos ficam nos limites. */
  function precoMinimo(canal, ent, cfg, TX, m) {
    const custoUn = ent.loteQtd > 0 ? ent.lote / ent.loteQtd : 0;
    const ini = Math.max(1, Math.floor((custoUn * ent.unidades + ent.custos.emb) * 100));
    const ok = (i) => venda(canal, i / 100, ent, cfg, TX).lucro >= m * (i / 100) - 1e-9;
    let achou = null;
    for (let i = ini; i <= 2000000; i += 50) if (ok(i)) { achou = i; break; }
    limites(canal, TX).forEach((L) => {
      const i = Math.round(L * 100) - 1;
      if (i >= ini && (achou == null || i < achou) && ok(i)) achou = i;
    });
    if (achou == null) return null;
    while (achou - 1 >= ini && ok(achou - 1)) achou--;
    return achou / 100;
  }

  /* Zona morta: um preço abaixo (no fim de uma faixa) que rende mais que o preço atual. */
  function zonaMorta(canal, P, ent, cfg, TX) {
    const atual = venda(canal, P, ent, cfg, TX).lucro;
    let melhor = null;
    limites(canal, TX).forEach((L) => {
      if (L > P || L - 0.01 <= 0) return;
      const p = r2(L - 0.01);
      const l = venda(canal, p, ent, cfg, TX).lucro;
      if (l > atual + 0.005 && (!melhor || l > melhor.lucro)) melhor = { preco: p, limite: L, lucro: l };
    });
    if (!melhor) return null;
    const base = Math.round(melhor.limite * 100);
    const ok = (i) => venda(canal, i / 100, ent, cfg, TX).lucro >= melhor.lucro - 1e-9;
    let j = null;
    for (let i = base; i <= base + 200000; i += 50) if (ok(i)) { j = i; break; }
    if (j != null) while (j - 1 >= base && ok(j - 1)) j--;
    return { ...melhor, lucroAtual: atual, compensaAPartirDe: j != null ? j / 100 : null };
  }

  /* Tabela de kits: para cada tamanho, preço mínimo (com custo) ou quanto pagar (sem custo, no preço por unidade do líder). */
  function kits(canal, ent, cfg, TX, m, tamanhos) {
    const lista = [...new Set([...(tamanhos || [1, 2, 3, 5, 10]), ent.unidades])].filter((n) => n > 0).sort((a, b) => a - b);
    const temCusto = ent.lote > 0;
    const pUn = ent.preco / ent.unidades;
    return lista.map((n) => {
      const e = { ...ent, unidades: n };
      if (temCusto) {
        const p = precoMinimo(canal, e, cfg, TX, m);
        return { unidades: n, custo: (ent.lote / ent.loteQtd) * n, precoMinimo: p, porUnidade: p ? p / n : null };
      }
      const P = r2(pUn * n);
      const cm = custoMaximo(canal, P, e, cfg, TX, m);
      return { unidades: n, preco: P, pagarAteUn: cm, pagarAteKit: cm * n };
    });
  }

  /* Quanto a negociação vale: diferença entre a oferta e o máximo, vezes o pedido. */
  function economia(custoOfertaUn, custoMaxUn, qtdPedido) {
    const dif = custoOfertaUn - custoMaxUn;
    return { porUnidade: dif, total: dif * (qtdPedido || 0), acimaDoLimite: dif > 0 };
  }

  function veredito(margem, alvo) {
    if (margem >= alvo - 1e-9) return "viavel";
    if (margem >= 0) return "apertado";
    return "prejuizo";
  }

  /* Validação da tabela de taxas (taxas.json) — evita publicar tabela quebrada. */
  function validarTabela(TX) {
    const erros = [];
    const num = (v) => typeof v === "number" && isFinite(v);
    if (!TX || !TX.shopee || !Array.isArray(TX.shopee.faixas) || !TX.shopee.faixas.length) erros.push("shopee.faixas");
    else {
      TX.shopee.faixas.forEach((f, i) => {
        if (!num(f.pct) || !num(f.fixo)) erros.push("shopee.faixas[" + i + "]");
        if (i < TX.shopee.faixas.length - 1 && !num(f.ate)) erros.push("shopee.faixas[" + i + "].ate");
      });
      if (TX.shopee.faixas[TX.shopee.faixas.length - 1].ate != null) erros.push("shopee: última faixa precisa ser sem teto");
    }
    if (!TX.ml || !Array.isArray(TX.ml.envio) || TX.ml.envio.length !== PESOS_ML.length) erros.push("ml.envio deve ter " + PESOS_ML.length + " faixas de peso");
    else TX.ml.envio.forEach((l, i) => { if (l.length !== TX.ml.limites.length || !l.every(num)) erros.push("ml.envio[" + i + "]"); });
    const F = TX.ml && TX.ml.fullsuper;
    if (!F) erros.push("ml.fullsuper");
    else ["selecionados", "demais"].forEach((k) => {
      if (!Array.isArray(F[k]) || F[k].length !== F.pesos.length) erros.push("fullsuper." + k + " linhas");
      else F[k].forEach((l, i) => { if (l.length !== F.limites.length + 1 || !l.every(num)) erros.push("fullsuper." + k + "[" + i + "]"); });
    });
    if (!TX.amz || !Array.isArray(TX.amz.faixas) || !TX.amz.faixas.every((f) => num(f.ate) && num(f.fixo))) erros.push("amz.faixas");
    return erros;
  }

  return { CANAIS, PESOS_ML, pesoCobrado, taxas, venda, custoMaximo, precoMinimo, zonaMorta, kits, limites, veredito, economia, validarTabela, r2 };
});
