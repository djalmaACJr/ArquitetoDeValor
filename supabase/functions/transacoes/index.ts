// supabase/functions/transacoes/index.ts
// Arquiteto de Valor — Edge Function: transacoes v9

import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, extrairId, extrairAcao,
         verificarExistencia, validarStatus, calcularDataParcela, corsPreFlight } from "../_shared/utils.ts";
import { logDebug, logError, logInfo, logRequest, logResponse, logSuccess } from "../_shared/logger.ts";

const TIPOS_TX   = ["RECEITA","DESPESA"];
const ESCOPOS    = ["SOMENTE_ESTE","ESTE_E_SEGUINTES","TODOS"];
const FREQUENCIAS = ["DIARIA","SEMANAL","MENSAL","ANUAL"];

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
  const idRecorrencia = params.get("id_recorrencia");
  const comSaldo = params.get("saldo") === "true";
  const page     = parseInt(params.get("page") ?? "1");
  const perPage  = comSaldo
    ? 1000
    : Math.min(parseInt(params.get("per_page") ?? "50"), 200);
  const offset   = comSaldo ? 0 : (page - 1) * perPage;

  const fonte = comSaldo ? "vw_transacoes_com_saldo" : "transacoes";
  let q = c.from(fonte).select("*")
    .order("data",      { ascending: true })
    .order("criado_em", { ascending: true })
    .range(offset, offset + perPage - 1);

  if (mes) {
    const [ano, mesNum] = mes.split("-").map(Number);
    if (fonte === "vw_transacoes_com_saldo") {
      q = q.eq("ano_tx", ano).eq("mes_tx", mesNum);
    } else {
      const primeiroDia = `${ano}-${String(mesNum).padStart(2, '0')}-01`;
      const ultimoDia   = `${ano}-${String(mesNum + 1).padStart(2, '0')}-01`;
      q = q.gte("data", primeiroDia).lt("data", ultimoDia);
    }
  }

  if (contaId) q = q.eq("conta_id", contaId);
  if (catId)   q = q.eq("categoria_id", catId);
  if (status)  q = q.eq("status", status);
  if (idRecorrencia) q = q.eq("id_recorrencia", idRecorrencia);

  const { data, error } = await q;
  if (error) { logError("Listar transações", error); return erro(error.message); }

  logResponse(200, { count: data?.length, page, perPage });
  return json({ dados: data, pagina: page, por_pagina: perPage });
}

async function buscarPorId(c: ReturnType<typeof db>, id: string) {
  logRequest("GET", `/transacoes/${id}`);
  const { data, error } = await c.from("vw_transacoes_com_saldo").select("*").eq("id", id).single();
  if (error) { logResponse(404); return erro("Lançamento não encontrado", 404); }
  logResponse(200, { id });
  return json(data);
}

async function criar(c: ReturnType<typeof db>, body: Record<string, unknown>, userId: string) {
  logRequest("POST", "/transacoes", body);

  // ── Validações básicas ──────────────────────────────────────
  if (!body.descricao || String(body.descricao).length < 2 || String(body.descricao).length > 200)
    return erro("RV-001: descricao deve ter entre 2 e 200 caracteres");
  if (!body.valor || Number(body.valor) <= 0)
    return erro("RV-002: valor deve ser maior que zero");
  if (!body.data)
    return erro("RV-003: data é obrigatória");
  if (!body.conta_id)
    return erro("RV-004: conta_id é obrigatório");
  if (!body.tipo || !TIPOS_TX.includes(String(body.tipo)))
    return erro("RV-006: tipo deve ser RECEITA ou DESPESA");

  const erroStatus = validarStatus(body.status);
  if (erroStatus || !body.status)
    return erro(erroStatus ?? "RV-007: status deve ser PAGO, PENDENTE ou PROJECAO");

  const statusOriginal = String(body.status);
  const dataBase       = String(body.data);
  const hoje           = new Date().toISOString().split("T")[0];

  // ── Validação: PROJECAO só para datas futuras ───────────────
  if (statusOriginal === "PROJECAO" && dataBase <= hoje)
    return erro("RV-008: status PROJECAO só é permitido para datas futuras", 422);

  const totalParcelas    = body.total_parcelas ? parseInt(String(body.total_parcelas)) : 1;
  const frequencia       = body.tipo_recorrencia ? String(body.tipo_recorrencia) : null;
  const intervalo        = body.intervalo_recorrencia ? parseInt(String(body.intervalo_recorrencia)) : 1;
  const isRecorrente     = totalParcelas > 1 && frequencia && FREQUENCIAS.includes(frequencia);

  // ── Lançamento simples (sem recorrência) ────────────────────
  if (!isRecorrente) {
    const { data, error } = await c.from("transacoes").insert({
      user_id:         userId,
      tipo:            body.tipo,
      data:            dataBase,
      descricao:       body.descricao,
      valor:           body.valor,
      conta_id:        body.conta_id,
      categoria_id:    body.categoria_id ?? null,
      status:          statusOriginal,
      observacao:      body.observacao ?? null,
      tipo_recorrencia: null,
      nr_parcela:      null,
      total_parcelas:  null,
      id_recorrencia:  null,
    }).select().single();

    if (error) {
      logError("Criar transação", error);
      if (error.message.includes("CONTA_INVALIDA"))    return erro("RV-004: conta inexistente ou inativa", 422);
      if (error.message.includes("CATEGORIA_INVALIDA")) return erro("categoria inexistente ou inativa", 422);
      return erro(error.message);
    }
    logSuccess("Transação criada", { id: data.id });
    return json(data, 201);
  }

  // ── Recorrência — criar N parcelas ─────────────────────────
  const idRecorrencia  = crypto.randomUUID();
  // tipo_recorrencia no banco: PROJECAO ou PARCELA
  const tipoRecBanco   = statusOriginal === "PROJECAO" ? "PROJECAO" : "PARCELA";
  const parcelas: Record<string, unknown>[] = [];

  for (let i = 0; i < totalParcelas; i++) {
    const dataParcela = calcularDataParcela(dataBase, frequencia!, i * intervalo);

    // Status de cada parcela
    let statusParcela: string;
    if (dataParcela <= hoje) {
      statusParcela = "PAGO";
    } else if (statusOriginal === "PROJECAO") {
      statusParcela = "PROJECAO";
    } else {
      statusParcela = "PENDENTE";
    }

    parcelas.push({
      user_id:          userId,
      tipo:             body.tipo,
      data:             dataParcela,
      descricao:        body.descricao,
      valor:            body.valor,
      conta_id:         body.conta_id,
      categoria_id:     body.categoria_id ?? null,
      status:           statusParcela,
      observacao:       body.observacao ?? null,
      tipo_recorrencia: tipoRecBanco,
      nr_parcela:       i + 1,
      total_parcelas:   totalParcelas,
      id_recorrencia:   idRecorrencia,
    });
  }

  const { data, error } = await c.from("transacoes").insert(parcelas).select();
  if (error) {
    logError("Criar recorrência", error);
    if (error.message.includes("CONTA_INVALIDA"))    return erro("RV-004: conta inexistente ou inativa", 422);
    if (error.message.includes("CATEGORIA_INVALIDA")) return erro("categoria inexistente ou inativa", 422);
    return erro(error.message);
  }

  logSuccess("Recorrência criada", { id_recorrencia: idRecorrencia, parcelas: totalParcelas });
  return json({ id_recorrencia: idRecorrencia, total: data.length, parcelas: data }, 201);
}

async function editar(c: ReturnType<typeof db>, id: string, body: Record<string, unknown>, escopo: string) {
  logRequest("PUT", `/transacoes/${id}`, { ...body, escopo });

  if (!ESCOPOS.includes(escopo))
    return erro("escopo inválido: use SOMENTE_ESTE | ESTE_E_SEGUINTES | TODOS");

  const { data: atual, error: e } = await c.from("transacoes").select("*").eq("id", id).single();
  if (e || !atual) { logResponse(404); return erro("Lançamento não encontrado", 404); }

  if (body.status !== undefined) {
    const erroStatus = validarStatus(body.status);
    if (erroStatus) return erro(erroStatus);
  }
  if (body.tipo !== undefined && !TIPOS_TX.includes(String(body.tipo)))
    return erro("tipo deve ser RECEITA ou DESPESA");

  // Validação PROJECAO só para datas futuras
  const hoje = new Date().toISOString().split("T")[0];
  const dataEfetiva = String(body.data ?? atual.data);
  if (body.status === "PROJECAO" && dataEfetiva <= hoje)
    return erro("RV-008: status PROJECAO só é permitido para datas futuras", 422);

  // Campos permitidos no update — sem tipo_recorrencia, frequencia, intervalo
  const camposPermitidos = ["tipo","data","descricao","valor","conta_id","categoria_id","status","observacao"];
  const dadosUpdate: Record<string, unknown> = {};
  camposPermitidos.forEach(k => { if (body[k] !== undefined) dadosUpdate[k] = body[k]; });

  // ── Escopo único ────────────────────────────────────────────
  if (!atual.id_recorrencia || escopo === "SOMENTE_ESTE") {
    const { data, error } = await c.from("transacoes").update(dadosUpdate).eq("id", id).select();
    if (error) { logError("Editar transação", error); return erro(error.message); }
    logSuccess("Transação atualizada", { id });
    return json({ atualizados: data?.length ?? 0, dados: data });
  }

  // ── Escopo ESTE_E_SEGUINTES ou TODOS ─────────────────────────
  // Buscar todas as parcelas do escopo com seus metadados
  let q = c.from("transacoes")
    .select("id, nr_parcela, data")
    .eq("id_recorrencia", atual.id_recorrencia)
    .order("nr_parcela", { ascending: true });

  if (escopo === "ESTE_E_SEGUINTES") q = q.gte("nr_parcela", atual.nr_parcela);

  const { data: parcelas, error: eParcelas } = await q;
  if (eParcelas || !parcelas) return erro("Erro ao buscar parcelas da série");

  logDebug(`Escopo ${escopo}: atualizando ${parcelas.length} transações`);

  // ── Recalcular datas se data foi alterada ────────────────────
  const dataFoiAlterada = body.data !== undefined && body.data !== atual.data;
  const novaDataBase    = dataFoiAlterada ? String(body.data) : null;

  // Determinar frequência e intervalo da série (vem do banco ou do body)
  // A série pode ter sido criada com MENSAL/SEMANAL/etc — precisamos detectar
  // o intervalo atual medindo a diferença entre parcelas consecutivas,
  // ou usar o tipo_recorrencia salvo
  let frequencia: string | null = null;
  let intervalo = 1;

  if (dataFoiAlterada && parcelas.length > 1) {
    // Buscar tipo_recorrencia da série (vem do campo da transação atual)
    const { data: meta } = await c.from("transacoes")
      .select("tipo_recorrencia, data")
      .eq("id_recorrencia", atual.id_recorrencia)
      .order("nr_parcela", { ascending: true })
      .limit(2);

    // tipo_recorrencia no banco é PARCELA ou PROJECAO — não guarda frequência diretamente
    // Detectar intervalo real medindo diferença entre parcelas 1 e 2
    if (meta && meta.length >= 2) {
      const d1 = new Date(meta[0].data);
      const d2 = new Date(meta[1].data);
      const diffDias = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDias === 1)       { frequencia = "DIARIA";  intervalo = 1; }
      else if (diffDias === 7)  { frequencia = "SEMANAL"; intervalo = 1; }
      else if (diffDias % 7 === 0) { frequencia = "SEMANAL"; intervalo = diffDias / 7; }
      else if (diffDias >= 28 && diffDias <= 31) { frequencia = "MENSAL"; intervalo = 1; }
      else if (diffDias >= 56 && diffDias <= 62) { frequencia = "MENSAL"; intervalo = 2; }
      else if (diffDias >= 84 && diffDias <= 93) { frequencia = "MENSAL"; intervalo = 3; }
      else if (diffDias >= 365 && diffDias <= 366) { frequencia = "ANUAL"; intervalo = 1; }
      else { frequencia = "MENSAL"; intervalo = 1; } // fallback
    }
  }

  // ── Atualizar cada parcela individualmente ───────────────────
  const nrAtual = atual.nr_parcela ?? 1;
  let atualizados = 0;

  for (const parcela of parcelas) {
    const update: Record<string, unknown> = { ...dadosUpdate };

    // Recalcular data proporcional ao offset desta parcela na série
    if (dataFoiAlterada && novaDataBase && frequencia) {
      const offset = (parcela.nr_parcela - nrAtual);
      update.data = calcularDataParcela(novaDataBase, frequencia, offset * intervalo);
    } else if (dataFoiAlterada && novaDataBase) {
      // Sem frequência detectada — manter offset de dias original
      const dataOriginalParcela = new Date(parcela.data);
      const dataOriginalBase    = new Date(atual.data);
      const dataNovaBase        = new Date(novaDataBase);
      const diffMs = dataNovaBase.getTime() - dataOriginalBase.getTime();
      const novaData = new Date(dataOriginalParcela.getTime() + diffMs);
      update.data = novaData.toISOString().split("T")[0];
    }

    const { error: eUp } = await c.from("transacoes").update(update).eq("id", parcela.id);
    if (eUp) { logError(`Editar parcela ${parcela.id}`, eUp); }
    else atualizados++;
  }

  logSuccess("Série atualizada", { escopo, atualizados });
  return json({ atualizados, dados: [] });
}

async function excluir(c: ReturnType<typeof db>, id: string, escopo: string) {
  logRequest("DELETE", `/transacoes/${id}`, { escopo });

  if (!ESCOPOS.includes(escopo))
    return erro("escopo inválido: use SOMENTE_ESTE | ESTE_E_SEGUINTES | TODOS");

  const { data: atual, error: e } = await c.from("transacoes")
    .select("id,id_recorrencia,nr_parcela").eq("id", id).single();
  if (e || !atual) { logResponse(404); return erro("Lançamento não encontrado", 404); }

  let ids: string[] = [id];
  if (atual.id_recorrencia && escopo !== "SOMENTE_ESTE") {
    let q = c.from("transacoes").select("id").eq("id_recorrencia", atual.id_recorrencia);
    if (escopo === "ESTE_E_SEGUINTES") q = q.gte("nr_parcela", atual.nr_parcela);
    const { data: rec } = await q;
    ids = (rec ?? []).map((r: { id: string }) => r.id);
    logDebug(`Escopo ${escopo}: excluindo ${ids.length} transações`);
  }

  const { error } = await c.from("transacoes").delete().in("id", ids);
  if (error) { logError("Excluir transação", error); return erro(error.message); }

  logSuccess("Transação(ões) excluída(s)", { count: ids.length });
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
      if (error.message?.includes("LAST_INSTALLMENT"))
        return erro("Não é possível antecipar a última parcela", 400);
      if (error.message?.includes("NOT_INSTALLMENT"))
        return erro("Disponível apenas para lançamentos do tipo PARCELA", 400);
      return erro("Erro ao antecipar parcelas: " + error.message, 500);
    }

    let resultado;
    if (Array.isArray(data) && data.length > 0) resultado = data[0];
    else if (data && typeof data === 'object') resultado = data;
    else resultado = { sucesso: true };

    logSuccess("Antecipação realizada", resultado);
    return json({ mensagem: "Antecipação realizada com sucesso", resultado });

  } catch (err) {
    logError("Antecipar parcelas (inesperado)", err);
    return erro("Erro interno ao antecipar parcelas", 500);
  }
}
