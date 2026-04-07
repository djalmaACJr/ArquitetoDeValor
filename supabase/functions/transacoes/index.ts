// ============================================================
// Arquiteto de Valor — Edge Function: transacoes v4
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, getUserId } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  const url    = new URL(req.url);
  const partes = url.pathname.split("/").filter(Boolean);
  const ultimo = partes[partes.length - 1];
  const penult = partes[partes.length - 2];
  const isAntecipar = ultimo === "antecipar";
  const id     = isAntecipar ? penult : (ultimo !== "transacoes" ? ultimo : null);
  const acao   = isAntecipar ? "antecipar" : null;
  const m      = req.method;
  const c      = db(req);
  const userId = getUserId(req);

  try {
    if (m === "GET"    && !id)                       return await listar(c, url.searchParams);
    if (m === "GET"    &&  id)                       return await buscarPorId(c, id);
    if (m === "POST"   && !id)                       return await criar(c, await req.json(), userId);
    if (m === "POST"   &&  id && acao==="antecipar") return await antecipar(c, id, userId);
    if (m === "PUT"    &&  id)                       return await editar(c, id, await req.json(), url.searchParams.get("escopo") ?? "SOMENTE_ESTE");
    if (m === "DELETE" &&  id)                       return await excluir(c, id, url.searchParams.get("escopo") ?? "SOMENTE_ESTE");
    return erro("Rota não encontrada", 404);
  } catch (e) { console.error(e); return erro("Erro interno", 500); }
});

async function listar(c: ReturnType<typeof db>, params: URLSearchParams) {
  const mes      = params.get("mes");
  const contaId  = params.get("conta_id");
  const catId    = params.get("categoria_id");
  const status   = params.get("status");
  const comSaldo = params.get("saldo") === "true";
  const page     = parseInt(params.get("page") ?? "1");
  const perPage  = Math.min(parseInt(params.get("per_page") ?? "50"), 200);
  const offset   = (page - 1) * perPage;

  const fonte = comSaldo ? "vw_transacoes_com_saldo" : "transacoes";
  let q = c.from(fonte).select("*")
    .order("data", { ascending: true })
    .order("criado_em", { ascending: true })
    .range(offset, offset + perPage - 1);

  if (mes) {
    const [ano, mesNum] = mes.split("-").map(Number);
    q = q.eq("ano_tx", ano).eq("mes_tx", mesNum);
  }
  if (contaId) q = q.eq("conta_id", contaId);
  if (catId)   q = q.eq("categoria_id", catId);
  if (status)  q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return erro(error.message);
  return json({ dados: data, pagina: page, por_pagina: perPage });
}

async function buscarPorId(c: ReturnType<typeof db>, id: string) {
  const { data, error } = await c.from("vw_transacoes_com_saldo").select("*").eq("id", id).single();
  if (error) return erro("Lançamento não encontrado", 404);
  return json(data);
}

async function criar(c: ReturnType<typeof db>, body: Record<string, unknown>, userId: string | null) {
  if (!userId) return erro("Usuário não autenticado", 401);
  if (!body.descricao || String(body.descricao).length < 2) return erro("RV-001: descricao deve ter entre 2 e 200 caracteres");
  if (!body.valor || Number(body.valor) <= 0)               return erro("RV-002: valor deve ser maior que zero");
  if (!body.data)                                           return erro("RV-003: data é obrigatória");
  if (!body.conta_id)                                       return erro("RV-004: conta_id é obrigatório");
  if (!body.tipo || !["RECEITA","DESPESA"].includes(String(body.tipo)))
    return erro("RV-006: tipo deve ser RECEITA ou DESPESA");
  if (!body.status || !["PAGO","PENDENTE","PROJECAO"].includes(String(body.status)))
    return erro("RV-007: status deve ser PAGO, PENDENTE ou PROJECAO");

  const { valor_projetado, ...dadosLimpos } = body;
  const { data, error } = await c.from("transacoes").insert({
    ...dadosLimpos,
    user_id: userId,
  }).select().single();
  if (error) return erro(error.message);
  return json(data, 201);
}

async function editar(c: ReturnType<typeof db>, id: string, body: Record<string, unknown>, escopo: string) {
  const { data: atual, error: e } = await c.from("transacoes").select("*").eq("id", id).single();
  if (e || !atual) return erro("Lançamento não encontrado", 404);

  const { valor_projetado, ...dadosLimpos } = body;
  let ids: string[] = [id];

  if (atual.id_recorrencia && escopo !== "SOMENTE_ESTE") {
    let q = c.from("transacoes").select("id").eq("id_recorrencia", atual.id_recorrencia);
    if (escopo === "ESTE_E_SEGUINTES") q = q.gte("nr_parcela", atual.nr_parcela);
    const { data: rec } = await q;
    ids = (rec ?? []).map((r: { id: string }) => r.id);
  }

  const { data, error } = await c.from("transacoes").update(dadosLimpos).in("id", ids).select();
  if (error) return erro(error.message);
  return json({ atualizados: data?.length ?? 0, dados: data });
}

async function excluir(c: ReturnType<typeof db>, id: string, escopo: string) {
  const { data: atual, error: e } = await c.from("transacoes").select("id,id_recorrencia,nr_parcela").eq("id", id).single();
  if (e || !atual) return erro("Lançamento não encontrado", 404);

  let ids: string[] = [id];
  if (atual.id_recorrencia && escopo !== "SOMENTE_ESTE") {
    let q = c.from("transacoes").select("id").eq("id_recorrencia", atual.id_recorrencia);
    if (escopo === "ESTE_E_SEGUINTES") q = q.gte("nr_parcela", atual.nr_parcela);
    const { data: rec } = await q;
    ids = (rec ?? []).map((r: { id: string }) => r.id);
  }

  const { error } = await c.from("transacoes").delete().in("id", ids);
  if (error) return erro(error.message);
  return json({ excluidos: ids.length, ids });
}

async function antecipar(c: ReturnType<typeof db>, id: string, userId: string | null) {
  if (!userId) return erro("Usuário não autenticado", 401);

  const { data: tx, error: eTx } = await c.from("transacoes").select("id").eq("id", id).single();
  if (eTx || !tx) return erro("Lançamento não encontrado", 404);

  const { data, error } = await c.rpc("fn_antecipar_parcelas", {
    p_transacao_id: id,
    p_user_id:      userId,
  });
  if (error) {
    if (error.message.includes("LAST_INSTALLMENT"))         return erro("Não é possível antecipar a última parcela", 400);
    if (error.message.includes("NOT_INSTALLMENT"))          return erro("Disponível apenas para lançamentos do tipo PARCELA", 400);
    if (error.message.includes("TRANSACAO_NAO_ENCONTRADA")) return erro("Lançamento não encontrado", 404);
    return erro(error.message);
  }
  return json({ mensagem: "Antecipação realizada com sucesso", resultado: data?.[0] ?? data });
}