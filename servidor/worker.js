// Servidor intermediário da LDF Calc para a API do Mercado Livre (Cloudflare Workers).
// A chave secreta NUNCA fica neste arquivo: ela é cadastrada no painel do Cloudflare
// como segredo, com os nomes ML_CLIENT_ID e ML_CLIENT_SECRET.
// A autorização da conta LDF (login único) fica guardada no KV com a vinculação "KV".

const ORIGENS = ["https://ldf-negocios.github.io"];
const APP = "https://ldf-negocios.github.io/calculadora/"; // redirect cadastrado no app do ML (tem que ser idêntico)
const ML = "https://api.mercadolibre.com";
const AUTH = "https://auth.mercadolivre.com.br/authorization";
let appToken = { valor: null, expira: 0 };

function cors(origem) {
  const ok = ORIGENS.includes(origem);
  return {
    "Access-Control-Allow-Origin": ok ? origem : ORIGENS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
function json(dados, status, origem, cache) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache || "no-store", ...cors(origem) },
  });
}
async function oauth(corpo) {
  const r = await fetch(ML + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("token " + r.status + " " + (j.message || j.error || ""));
  return j;
}

// Token do aplicativo (sem usuário): serve para tarifas.
async function tokenApp(env) {
  if (appToken.valor && Date.now() < appToken.expira) return appToken.valor;
  const j = await oauth({ grant_type: "client_credentials", client_id: env.ML_CLIENT_ID, client_secret: env.ML_CLIENT_SECRET });
  appToken = { valor: j.access_token, expira: Date.now() + (j.expires_in - 300) * 1000 };
  return appToken.valor;
}

// Token da conta LDF (login único): serve para a busca de anúncios.
async function tokenUsuario(env) {
  if (!env.KV) throw new Error("sem KV");
  const salvo = await env.KV.get("ml_usuario", "json");
  if (!salvo) return null;
  if (Date.now() < salvo.expira) return salvo.access_token;
  const j = await oauth({ grant_type: "refresh_token", client_id: env.ML_CLIENT_ID, client_secret: env.ML_CLIENT_SECRET, refresh_token: salvo.refresh_token });
  await guardar(env, j);
  return j.access_token;
}
async function guardar(env, j) {
  await env.KV.put("ml_usuario", JSON.stringify({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    user_id: j.user_id,
    expira: Date.now() + (j.expires_in - 300) * 1000,
    em: new Date().toISOString(),
  }));
}
async function ml(caminho, tk) {
  const r = await fetch(ML + caminho, { headers: { Authorization: "Bearer " + tk } });
  const corpo = await r.json().catch(() => ({}));
  return { status: r.status, corpo };
}

// Busca: até 50 anúncios por relevância, enriquecidos com vendidos e data; devolve os 20 mais vendidos.
async function buscar(q, env) {
  const tk = await tokenUsuario(env);
  if (!tk) return { erro: "login" };
  const s = await ml("/sites/MLB/search?limit=50&q=" + encodeURIComponent(q), tk);
  if (s.status === 401 || s.status === 403) return { erro: "login", status: s.status, detalhe: s.corpo };
  if (s.status !== 200) return { erro: "busca", status: s.status, detalhe: s.corpo };
  const res = s.corpo.results || [];
  const det = {};
  for (let i = 0; i < res.length; i += 20) {
    const ids = res.slice(i, i + 20).map((x) => x.id).join(",");
    const d = await ml("/items?attributes=id,date_created,start_time,sold_quantity,health,status&ids=" + ids, tk);
    if (Array.isArray(d.corpo)) d.corpo.forEach((x) => { if (x.body) det[x.body.id] = x.body; });
  }
  const hoje = Date.now();
  const anuncios = res.map((x) => {
    const d = det[x.id] || {};
    const criado = d.date_created || d.start_time || null;
    const meses = criado ? Math.max(1, (hoje - Date.parse(criado)) / (30.44 * 864e5)) : null;
    const vendidos = d.sold_quantity ?? x.sold_quantity ?? null;
    return {
      id: x.id,
      titulo: x.title,
      preco: x.price,
      precoOriginal: x.original_price,
      tipo: x.listing_type_id === "gold_pro" ? "Premium" : x.listing_type_id === "gold_special" ? "Clássico" : x.listing_type_id,
      full: !!(x.shipping && x.shipping.logistic_type === "fulfillment"),
      freteGratis: !!(x.shipping && x.shipping.free_shipping),
      catalogo: !!x.catalog_listing,
      vendedor: x.seller && (x.seller.nickname || x.seller.id),
      categoria: x.category_id,
      vendidos,
      criadoEm: criado,
      mesesNoAr: meses ? Math.round(meses * 10) / 10 : null,
      vendasMes: vendidos != null && meses ? Math.round(vendidos / meses) : null,
      link: x.permalink,
      foto: x.thumbnail,
    };
  });
  anuncios.sort((a, b) => (b.vendidos ?? -1) - (a.vendidos ?? -1));
  return {
    termo: q,
    total: s.corpo.paging ? s.corpo.paging.total : res.length,
    analisados: res.length,
    semVendidos: anuncios.filter((a) => a.vendidos == null).length,
    anuncios: anuncios.slice(0, 20),
  };
}

export default {
  async fetch(req, env) {
    const origem = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origem) });
    const url = new URL(req.url);
    try {
      // 1) Login único da conta LDF: manda para o Mercado Livre, que devolve ao app com ?code=
      if (url.pathname === "/login") {
        const destino = AUTH + "?response_type=code&client_id=" + encodeURIComponent(env.ML_CLIENT_ID) + "&redirect_uri=" + encodeURIComponent(APP);
        return Response.redirect(destino, 302);
      }
      // 2) O app entrega o code; aqui ele vira token e fica guardado no KV
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (!code) return json({ erro: "sem code" }, 400, origem);
        if (!env.KV) return json({ erro: "sem KV: crie a vinculação KV no Worker" }, 500, origem);
        const j = await oauth({ grant_type: "authorization_code", client_id: env.ML_CLIENT_ID, client_secret: env.ML_CLIENT_SECRET, code, redirect_uri: APP });
        await guardar(env, j);
        return json({ ok: true, usuario: j.user_id }, 200, origem);
      }
      if (url.pathname === "/status") {
        const salvo = env.KV ? await env.KV.get("ml_usuario", "json") : null;
        return json({ kv: !!env.KV, conectado: !!salvo, usuario: salvo && salvo.user_id, desde: salvo && salvo.em }, 200, origem);
      }
      // mais vendidos de uma categoria (lista oficial do ML) + detalhes dos anúncios
      if (url.pathname === "/top") {
        const cat = (url.searchParams.get("cat") || "").replace(/[^A-Z0-9]/g, "");
        if (!cat) return json({ erro: "cat" }, 400, origem);
        const tk = await tokenUsuario(env);
        if (!tk) return json({ erro: "login" }, 200, origem);
        const h = await ml("/highlights/MLB/category/" + cat, tk);
        if (h.status !== 200) return json({ erro: "top", status: h.status, detalhe: h.corpo }, 200, origem);
        const ids = (h.corpo.content || []).filter((x) => x.type === "ITEM").map((x) => x.id).slice(0, 20);
        const d = ids.length ? await ml("/items?ids=" + ids.join(",") + "&attributes=id,title,price,date_created,start_time,sold_quantity,permalink,listing_type_id,shipping,seller_id,catalog_listing", tk) : { corpo: [] };
        return json({ categoria: cat, itens: Array.isArray(d.corpo) ? d.corpo.map((x) => x.body || x) : d.corpo, status_itens: d.status }, 200, origem);
      }
      if (url.pathname === "/item") {
        const id = (url.searchParams.get("id") || "").replace(/[^A-Z0-9]/g, "");
        if (!id) return json({ erro: "id" }, 400, origem);
        const tk = await tokenUsuario(env);
        if (!tk) return json({ erro: "login" }, 200, origem);
        return json(await ml("/items/" + id + "?attributes=id,title,price,date_created,start_time,sold_quantity,permalink,listing_type_id,status", tk), 200, origem);
      }
      if (url.pathname === "/buscar") {
        const q = (url.searchParams.get("q") || "").trim();
        if (q.length < 3) return json({ erro: "termo curto" }, 400, origem);
        return json(await buscar(q, env), 200, origem);
      }
      if (url.pathname === "/tarifa") {
        const cat = url.searchParams.get("cat"), preco = url.searchParams.get("preco") || "50";
        const t = await ml(`/sites/MLB/listing_prices?price=${encodeURIComponent(preco)}&category_id=${encodeURIComponent(cat)}`, await tokenApp(env));
        if (t.status !== 200) return json({ erro: "tarifa", status: t.status }, 502, origem);
        const g = (id) => { const e = (t.corpo || []).find((x) => x.listing_type_id === id); return e ? e.sale_fee_details.percentage_fee : null; };
        return json({ categoria: cat, classico: g("gold_special"), premium: g("gold_pro") }, 200, origem, "public, max-age=3600");
      }
      return json({ ok: true, servico: "LDF Calc · Mercado Livre" }, 200, origem);
    } catch (e) {
      return json({ erro: String(e.message || e) }, 500, origem);
    }
  },
};
