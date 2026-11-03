// Servidor intermediário da LDF Calc para a API do Mercado Livre (Cloudflare Workers).
// A chave secreta NUNCA fica neste arquivo: ela é cadastrada no painel do Cloudflare
// como segredo, com os nomes ML_CLIENT_ID e ML_CLIENT_SECRET.

const ORIGENS = ["https://ldf-negocios.github.io"];
const ML = "https://api.mercadolibre.com";
let tokenCache = { valor: null, expira: 0 };

function cors(origem) {
  const ok = ORIGENS.includes(origem);
  return {
    "Access-Control-Allow-Origin": ok ? origem : ORIGENS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
function json(dados, status, origem) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=600", ...cors(origem) },
  });
}

async function token(env) {
  if (tokenCache.valor && Date.now() < tokenCache.expira) return tokenCache.valor;
  const corpo = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.ML_CLIENT_ID,
    client_secret: env.ML_CLIENT_SECRET,
  });
  const r = await fetch(ML + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: corpo,
  });
  if (!r.ok) throw new Error("token " + r.status);
  const j = await r.json();
  tokenCache = { valor: j.access_token, expira: Date.now() + (j.expires_in - 300) * 1000 };
  return tokenCache.valor;
}
async function ml(caminho, env) {
  const r = await fetch(ML + caminho, { headers: { Authorization: "Bearer " + (await token(env)) } });
  const corpo = await r.json().catch(() => ({}));
  return { status: r.status, corpo };
}

async function buscar(q, env) {
  const s = await ml("/sites/MLB/search?limit=20&q=" + encodeURIComponent(q), env);
  if (s.status !== 200) return { erro: "busca", status: s.status, detalhe: s.corpo };
  const res = s.corpo.results || [];
  // detalhes (data de criação) em lote
  const ids = res.map((x) => x.id).join(",");
  const datas = {};
  if (ids) {
    const d = await ml("/items?attributes=id,date_created,start_time,sold_quantity&ids=" + ids, env);
    if (Array.isArray(d.corpo)) d.corpo.forEach((x) => { if (x.body) datas[x.body.id] = x.body; });
  }
  const hoje = Date.now();
  return {
    termo: q,
    total: s.corpo.paging ? s.corpo.paging.total : res.length,
    anuncios: res.map((x) => {
      const det = datas[x.id] || {};
      const criado = det.date_created || det.start_time || null;
      const meses = criado ? Math.max(1, (hoje - Date.parse(criado)) / (30.44 * 864e5)) : null;
      const vendidos = det.sold_quantity ?? x.sold_quantity ?? null;
      return {
        id: x.id,
        titulo: x.title,
        preco: x.price,
        precoOriginal: x.original_price,
        tipo: x.listing_type_id === "gold_pro" ? "Premium" : x.listing_type_id === "gold_special" ? "Clássico" : x.listing_type_id,
        full: x.shipping && x.shipping.logistic_type === "fulfillment",
        freteGratis: !!(x.shipping && x.shipping.free_shipping),
        catalogo: !!x.catalog_listing,
        vendedor: x.seller && (x.seller.nickname || x.seller.id),
        categoria: x.category_id,
        vendidos,
        criadoEm: criado,
        vendasMes: vendidos != null && meses ? Math.round(vendidos / meses) : null,
        link: x.permalink,
        foto: x.thumbnail,
      };
    }),
  };
}

export default {
  async fetch(req, env) {
    const origem = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origem) });
    const url = new URL(req.url);
    try {
      if (url.pathname === "/buscar") {
        const q = (url.searchParams.get("q") || "").trim();
        if (q.length < 3) return json({ erro: "termo curto" }, 400, origem);
        return json(await buscar(q, env), 200, origem);
      }
      if (url.pathname === "/tarifa") {
        const cat = url.searchParams.get("cat"), preco = url.searchParams.get("preco") || "50";
        const t = await ml(`/sites/MLB/listing_prices?price=${encodeURIComponent(preco)}&category_id=${encodeURIComponent(cat)}`, env);
        if (t.status !== 200) return json({ erro: "tarifa", status: t.status }, 502, origem);
        const g = (id) => { const e = (t.corpo || []).find((x) => x.listing_type_id === id); return e ? e.sale_fee_details.percentage_fee : null; };
        return json({ categoria: cat, classico: g("gold_special"), premium: g("gold_pro") }, 200, origem);
      }
      return json({ ok: true, servico: "LDF Calc · Mercado Livre" }, 200, origem);
    } catch (e) {
      return json({ erro: String(e.message || e) }, 500, origem);
    }
  },
};
