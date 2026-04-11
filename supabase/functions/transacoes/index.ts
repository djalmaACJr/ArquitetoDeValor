// ============================================================
// Arquiteto de Valor — Edge Function: transacoes v8
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, extrairId, extrairAcao,
         verificarExistencia, validarStatus, corsPreFlight } from "../_shared/utils.ts";
import { logDebug, logError, logInfo, logRequest, logResponse, logSuccess, logWarn } from "../_shared/logger.ts";

const TIPOS_TX  = ["RECEITA","DESPESA"];
const ESCOPOS   = ["SOMENTE_ESTE","ESTE_E_SEGUINTES","TODOS"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id     = extrairId(req, "transacoes");
  const acao   = extrairAcao(req, "transacoes");
  const m      = req.method;
  const c      = db(req);
  const params = new URL(req.url).searchParams;
  const escopo = params.get("escopo") ?? "SOMENTE_ESTE";

  try {
    if (m === "GET"    && !id)                       return await listar(c, params);
    if (m === "GET"    &&  id)                       return await buscarPorId(c, id);
    if (m === "POST"   && !id)                       return await criar(c, await req.json(), userId);
    if (m === "POST"   &&  id && acao==="antecipar") return await antecipar(c, id, userId);
    if (m === "PUT"    &&  id)                       return await editar(c, id, await req.json(), escopo);
    if (m === "DELETE" &&  id)                       return await excluir(c, id, escopo);
    return erro("Rota não encontrada", 404);
  } catch (e) { 
    logError("Handler principal", e);
    return erro("Erro interno", 500); 
  }
});

async function listar(c: ReturnType<typeof db>, params: URLSearchParams) {
  logRequest("GET", "/transacoes", { params: Object.fromEntries(params) });
  
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
    .order("data",      { ascending: true })
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
  if (error) {
    logError("Listar transações", error);
    return erro(error.message);
  }
  
  logResponse(200, { count: data?.length, page, perPage });
  return json({ dados: data, pagina: page, por_pagina: perPage });
}

async function buscarPorId(c: ReturnType<typeof db>, id: string) {
  logRequest("GET", `/transacoes/${id}`);
  
  const { data, error } = await c.from("vw_transacoes_com_saldo").select("*").eq("id", id).single();
  if (error) {
    logResponse(404);
    return erro("Lançamento não encontrado", 404);
  }
  
  logResponse(200, { id, tipo: data.tipo, valor: data.valor });
  return json(data);
}

async function criar(c: ReturnType<typeof db>, body: Record<string, unknown>, userId: string) {
  logRequest("POST", "/transacoes", body);
  
  // Validações de negócio (RV-001 a RV-007)
  if (!body.descricao || String(body.descricao).length < 2) {
    logResponse(422, { erro: "RV-001: descricao deve ter entre 2 e 200 caracteres" });
    return erro("RV-001: descricao deve ter entre 2 e 200 caracteres");
  }
  if (String(body.descricao).length > 200) {
    logResponse(422, { erro: "RV-001: descricao deve ter entre 2 e 200 caracteres" });
    return erro("RV-001: descricao deve ter entre 2 e 200 caracteres");
  }
  if (!body.valor || Number(body.valor) <= 0) {
    logResponse(422, { erro: "RV-002: valor deve ser maior que zero" });
    return erro("RV-002: valor deve ser maior que zero");
  }
  if (!body.data) {
    logResponse(422, { erro: "RV-003: data é obrigatória" });
    return erro("RV-003: data é obrigatória");
  }
  if (!body.conta_id) {
    logResponse(422, { erro: "RV-004: conta_id é obrigatório" });
    return erro("RV-004: conta_id é obrigatório");
  }
  if (!body.tipo || !TIPOS_TX.includes(String(body.tipo))) {
    logResponse(422, { erro: "RV-006: tipo deve ser RECEITA ou DESPESA" });
    return erro("RV-006: tipo deve ser RECEITA ou DESPESA");
  }

  const erroStatus = validarStatus(body.status);
  if (erroStatus || !body.status) {
    logResponse(422, { erro: erroStatus ?? "RV-007: status deve ser PAGO, PENDENTE ou PROJECAO" });
    return erro(erroStatus ?? "RV-007: status deve ser PAGO, PENDENTE ou PROJECAO");
  }

  const { valor_projetado, ...dadosLimpos } = body;
  const { data, error } = await c.from("transacoes").insert({
    ...dadosLimpos, user_id: userId,
  }).select().single();
  
  if (error) {
    logError("Criar transação", error);
    if (error.message.includes("CONTA_INVALIDA")) {
      logResponse(422, { erro: "RV-004: conta inexistente ou inativa" });
      return erro("RV-004: conta inexistente ou inativa", 422);
    }
    if (error.message.includes("CATEGORIA_INVALIDA")) {
      logResponse(422, { erro: "categoria inexistente ou inativa" });
      return erro("categoria inexistente ou inativa", 422);
    }
    return erro(error.message);
  }
  
  logSuccess("Transação criada", { id: data.id, tipo: data.tipo, valor: data.valor });
  logResponse(201, data);
  return json(data, 201);
}

async function editar(c: ReturnType<typeof db>, id: string, body: Record<string, unknown>, escopo: string) {
  logRequest("PUT", `/transacoes/${id}`, { ...body, escopo });
  
  if (!ESCOPOS.includes(escopo)) {
    logResponse(422, { erro: "escopo inválido: use SOMENTE_ESTE | ESTE_E_SEGUINTES | TODOS" });
    return erro("escopo inválido: use SOMENTE_ESTE | ESTE_E_SEGUINTES | TODOS");
  }

  const { data: atual, error: e } = await c.from("transacoes").select("*").eq("id", id).single();
  if (e || !atual) {
    logResponse(404);
    return erro("Lançamento não encontrado", 404);
  }

  // Validações opcionais dos campos enviados
  if (body.status !== undefined) {
    const erroStatus = validarStatus(body.status);
    if (erroStatus) {
      logResponse(422, { erro: erroStatus });
      return erro(erroStatus);
    }
  }
  if (body.tipo !== undefined && !TIPOS_TX.includes(String(body.tipo))) {
    logResponse(422, { erro: "tipo deve ser RECEITA ou DESPESA" });
    return erro("tipo deve ser RECEITA ou DESPESA");
  }

  const { valor_projetado, ...dadosLimpos } = body;
  let ids: string[] = [id];

  if (atual.id_recorrencia && escopo !== "SOMENTE_ESTE") {
    let q = c.from("transacoes").select("id").eq("id_recorrencia", atual.id_recorrencia);
    if (escopo === "ESTE_E_SEGUINTES") q = q.gte("nr_parcela", atual.nr_parcela);
    const { data: rec } = await q;
    ids = (rec ?? []).map((r: { id: string }) => r.id);
    logDebug(`Escopo ${escopo}: atualizando ${ids.length} transações`);
  }

  const { data, error } = await c.from("transacoes").update(dadosLimpos).in("id", ids).select();
  if (error) {
    logError("Editar transação", error);
    return erro(error.message);
  }
  
  logSuccess(`Transação(ões) atualizada(s)`, { count: data?.length });
  logResponse(200, { atualizados: data?.length ?? 0 });
  return json({ atualizados: data?.length ?? 0, dados: data });
}

async function excluir(c: ReturnType<typeof db>, id: string, escopo: string) {
  logRequest("DELETE", `/transacoes/${id}`, { escopo });
  
  if (!ESCOPOS.includes(escopo)) {
    logResponse(422, { erro: "escopo inválido: use SOMENTE_ESTE | ESTE_E_SEGUINTES | TODOS" });
    return erro("escopo inválido: use SOMENTE_ESTE | ESTE_E_SEGUINTES | TODOS");
  }

  const { data: atual, error: e } = await c.from("transacoes")
    .select("id,id_recorrencia,nr_parcela").eq("id", id).single();
  if (e || !atual) {
    logResponse(404);
    return erro("Lançamento não encontrado", 404);
  }

  let ids: string[] = [id];

  if (atual.id_recorrencia && escopo !== "SOMENTE_ESTE") {
    let q = c.from("transacoes").select("id").eq("id_recorrencia", atual.id_recorrencia);
    if (escopo === "ESTE_E_SEGUINTES") q = q.gte("nr_parcela", atual.nr_parcela);
    const { data: rec } = await q;
    ids = (rec ?? []).map((r: { id: string }) => r.id);
    logDebug(`Escopo ${escopo}: excluindo ${ids.length} transações`);
  }

  const { error } = await c.from("transacoes").delete().in("id", ids);
  if (error) {
    logError("Excluir transação", error);
    return erro(error.message);
  }
  
  logSuccess(`Transação(ões) excluída(s)`, { count: ids.length });
  logResponse(200, { excluidos: ids.length });
  return json({ excluidos: ids.length, ids });
}

async function antecipar(c: ReturnType<typeof db>, id: string, userId: string) {
  logRequest("POST", `/transacoes/${id}/antecipar`);
  
  const naoEncontrado = await verificarExistencia(c, "transacoes", id, "Lançamento não encontrado", userId);
  if (naoEncontrado) return naoEncontrado;

  try {
    const { data, error } = await c.rpc("fn_antecipar_parcelas", {
      p_transacao_id: id,
      p_user_id: userId,
    });
    
    if (error) {
      logError("Antecipar parcelas", error);
      
      if (error.message?.includes("LAST_INSTALLMENT")) {
        logResponse(400, { erro: "Não é possível antecipar a última parcela" });
        return erro("Não é possível antecipar a última parcela", 400);
      }
      if (error.message?.includes("NOT_INSTALLMENT")) {
        logResponse(400, { erro: "Disponível apenas para lançamentos do tipo PARCELA" });
        return erro("Disponível apenas para lançamentos do tipo PARCELA", 400);
      }
      return erro("Erro ao antecipar parcelas: " + error.message, 500);
    }
    
    let resultado;
    if (Array.isArray(data) && data.length > 0) {
      resultado = data[0];
    } else if (data && typeof data === 'object') {
      resultado = data;
    } else {
      resultado = { sucesso: true };
    }
    
    logSuccess("Antecipação realizada com sucesso", resultado);
    logResponse(200, { mensagem: "Antecipação realizada com sucesso" });
    return json({ 
      mensagem: "Antecipação realizada com sucesso", 
      resultado: resultado 
    });
    
  } catch (err) {
    logError("Antecipar parcelas (inesperado)", err);
    return erro("Erro interno ao antecipar parcelas", 500);
  }
}