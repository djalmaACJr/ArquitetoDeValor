// ============================================================
// Arquiteto de Valor — Edge Function: contas
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function erro(mensagem: string, status = 400) {
  return json({ erro: mensagem }, status);
}
function db(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const id = url.pathname.replace(/^\/functions\/v1\/contas\/?/, "").split("/")[0] || null;
  const m = req.method;
  const c = db(req);
  try {
    if (m === "GET"    && !id) return await listar(c);
    if (m === "GET"    &&  id) return await buscarPorId(c, id);
    if (m === "POST")          return await criar(c, await req.json());
    if (m === "PUT"    &&  id) return await editar(c, id, await req.json());
    if (m === "DELETE" &&  id) return await excluir(c, id);
    return erro("Rota não encontrada", 404);
  } catch (e) { console.error(e); return erro("Erro interno", 500); }
});

async function listar(c: ReturnType<typeof createClient>) {
  const { data, error } = await c.from("vw_saldo_contas").select("*").order("nome");
  if (error) return erro(error.message);
  return json({ dados: data });
}

async function buscarPorId(c: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await c.from("vw_saldo_contas").select("*").eq("conta_id", id).single();
  if (error) return erro("Conta não encontrada", 404);
  return json(data);
}

async function criar(c: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  if (!body.nome || String(body.nome).length < 1) return erro("nome é obrigatório");
  if (String(body.nome).length > 100) return erro("nome deve ter no máximo 100 caracteres");
  if (!body.tipo) return erro("tipo é obrigatório: CORRENTE | REMUNERACAO | CARTAO | INVESTIMENTO | CARTEIRA");
  if (!["CORRENTE","REMUNERACAO","CARTAO","INVESTIMENTO","CARTEIRA"].includes(String(body.tipo)))
    return erro("tipo inválido");
  if (body.cor && !/^#[0-9A-Fa-f]{6}$/.test(String(body.cor)))
    return erro("cor deve estar no formato hex: #RRGGBB");

  const { data, error } = await c.from("contas").insert({
    nome: body.nome, tipo: body.tipo,
    saldo_inicial: body.saldo_inicial ?? 0,
    icone: body.icone ?? null, cor: body.cor ?? null, ativa: true,
  }).select().single();
  if (error) return erro(error.message);
  return json(data, 201);
}

async function editar(c: ReturnType<typeof createClient>, id: string, body: Record<string, unknown>) {
  const { error: e } = await c.from("contas").select("id").eq("id", id).single();
  if (e) return erro("Conta não encontrada", 404);

  if (body.nome !== undefined && (String(body.nome).length < 1 || String(body.nome).length > 50))
    return erro("nome deve ter entre 1 e 100 caracteres");
  if (body.tipo !== undefined && !["CORRENTE","REMUNERACAO","CARTAO","INVESTIMENTO","CARTEIRA"].includes(String(body.tipo)))
    return erro("tipo inválido");
  if (body.cor != null && !/^#[0-9A-Fa-f]{6}$/.test(String(body.cor)))
    return erro("cor deve estar no formato hex: #RRGGBB");

  const campos: Record<string, unknown> = {};
  ["nome","tipo","saldo_inicial","icone","cor","ativa"].forEach(k => {
    if (body[k] !== undefined) campos[k] = body[k];
  });

  const { data, error } = await c.from("contas").update(campos).eq("id", id).select().single();
  if (error) return erro(error.message);
  return json(data);
}

async function excluir(c: ReturnType<typeof createClient>, id: string) {
  const { error } = await c.from("contas").delete().eq("id", id);
  if (error) {
    if (error.message.includes("CONTA_EM_USO")) return erro(error.message, 409);
    return erro(error.message);
  }
  return json({ mensagem: "Conta excluída com sucesso" });
}