// @ts-nocheck
// ============================================================
// Suite de Testes: transferencias.test.ts
// Critérios: CA-TRF01 a CA-TRF18
// ============================================================

import "@supabase/functions-js/edge-runtime.d.ts";
import {
  json,
  erro,
  db,
  autenticar,
  extrairId,
  validarStatus,
} from "../_shared/utils.ts";
import { log, logRequest, logResponse, logError, logSuccess } from "../_shared/logger.ts";

/** Busca o id da categoria protegida */
async function idCategoriaTransferencias(
  c: ReturnType<typeof db>,
  userId: string
): Promise<string | null> {
  log("Buscando categoria Transferências", { userId });
  
  const { data, error } = await c
    .from("categorias")
    .select("id")
    .eq("user_id", userId)
    .eq("descricao", "Transferências")
    .eq("protegida", true)
    .is("id_pai", null)
    .single();
  
  if (error) {
    logError("Buscar categoria", error);
    return null;
  }
  
  log("Categoria encontrada", { id: data?.id });
  return data?.id ?? null;
}

/** Retorna o par de transações */
async function buscarPar(c: ReturnType<typeof db>, idRecorrencia: string, userId: string) {
  log("Buscando par", { idRecorrencia, userId });
  
  const { data, error } = await c
    .from("transacoes")
    .select("*")
    .eq("id_recorrencia", idRecorrencia)
    .eq("user_id", userId)
    .order("tipo");

  if (error || !data || data.length !== 2) {
    logError("Buscar par", error || "Par não encontrado ou incompleto");
    return null;
  }
  
  return {
    debito:  data.find((t) => t.tipo === "DESPESA"),
    credito: data.find((t) => t.tipo === "RECEITA"),
  };
}

/** Monta objeto de resposta */
function montarTransferencia(
  debito: Record<string, unknown>,
  credito: Record<string, unknown>
) {
  return {
    id_par:           debito.id_recorrencia,
    conta_origem_id:  debito.conta_id,
    conta_destino_id: credito.conta_id,
    valor:            debito.valor,
    data:             debito.data,
    descricao:        (debito.descricao as string)?.replace(/^\[Transf\. saída\] ?/, "") || null,
    status:           debito.status,
    recorrente:       debito.tipo_recorrencia === "PARCELA",
    total_parcelas:   debito.total_parcelas ?? null,
    parcela_atual:    debito.nr_parcela ?? null,
    id_debito:        debito.id,
    id_credito:       credito.id,
    criado_em:        debito.criado_em,
    atualizado_em:    debito.atualizado_em,
  };
}

/** Verifica conta ativa */
async function verificarContaAtiva(
  c: ReturnType<typeof db>,
  contaId: string,
  label: string
): Promise<Response | null> {
  log(`Verificando ${label}`, { contaId });
  
  const { data, error } = await c
    .from("contas")
    .select("id, ativa")
    .eq("id", contaId)
    .single();

  if (error || !data) {
    logError(`${label} não encontrada`, error);
    return erro(`${label} não encontrada`, 404);
  }
  
  if (!data.ativa) {
    log(`${label} está inativa`, { contaId });
    return erro(`${label} está inativa`, 422);
  }
  
  return null;
}

/** Valida payload */
function validarPayload(body: Record<string, unknown>, modoEdicao = false): string | null {
  log("Validando payload", { body, modoEdicao });
  
  if (!modoEdicao) {
    if (!body.conta_origem_id)  return "conta_origem_id é obrigatório";
    if (!body.conta_destino_id) return "conta_destino_id é obrigatório";
    if (!body.valor)            return "valor é obrigatório";
    if (!body.data)             return "data é obrigatória";
  }

  if (body.conta_origem_id && body.conta_destino_id &&
      body.conta_origem_id === body.conta_destino_id)
    return "contas devem ser diferentes";

  if (body.valor !== undefined) {
    const v = Number(body.valor);
    if (isNaN(v) || v <= 0) return "valor deve ser maior que zero";
  }

  const erroStatus = validarStatus(body.status);
  if (erroStatus) return erroStatus;

  const descricao = body.descricao as string | undefined;
  if (descricao != null && (descricao.length < 2 || descricao.length > 200))
    return "descricao deve ter entre 2 e 200 caracteres";

  return null;
}

/** Handler principal */
Deno.serve(async (req: Request) => {
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id = extrairId(req, "transferencias");
  const m  = req.method;
  const c  = db(req);
  const url = new URL(req.url);

  try {
    if (m === "GET" && id)  return await buscarPorId(c, id, userId);
    if (m === "GET" && !id) return await listar(c, userId, url.searchParams);
    if (m === "POST" && !id) return await criar(c, await req.json(), userId);
    if (m === "PUT" && id)  return await editar(c, id, await req.json(), userId);
    if (m === "DELETE" && id) return await excluir(c, id, userId);
    return erro("Rota não encontrada", 404);
  } catch (e) { 
    logError("Handler principal", e);
    return erro("Erro interno: " + (e as Error).message, 500); 
  }
});

async function buscarPorId(c: ReturnType<typeof db>, idPar: string, userId: string) {
  logRequest("GET", `/transferencias/${idPar}`);
  const par = await buscarPar(c, idPar, userId);
  if (!par) {
    logResponse(404);
    return erro("Transferência não encontrada", 404);
  }
  const result = montarTransferencia(par.debito, par.credito);
  logResponse(200, result);
  return json(result);
}

async function listar(
  c: ReturnType<typeof db>,
  userId: string,
  params: URLSearchParams
) {
  logRequest("GET", "/transferencias", { params: Object.fromEntries(params) });
  
  const catId = await idCategoriaTransferencias(c, userId);
  if (!catId) {
    logResponse(500);
    return erro("Categoria Transferências não encontrada", 500);
  }

  let query = c
    .from("transacoes")
    .select("*")
    .eq("user_id", userId)
    .eq("categoria_id", catId)
    .eq("tipo", "DESPESA")
    .not("id_recorrencia", "is", null)
    .order("data", { ascending: false });

  const mes = params.get("mes");
  if (mes) {
    const [ano, mesNum] = mes.split("-");
    query = query.eq("ano_tx", Number(ano)).eq("mes_tx", Number(mesNum));
  }
  
  const { data: debitos, error: err } = await query;
  if (err) {
    logError("Listar débitos", err);
    return erro(err.message, 500);
  }

  const transferencias = await Promise.all(
    (debitos ?? []).map(async (debito) => {
      const { data: credito } = await c
        .from("transacoes")
        .select("*")
        .eq("id_recorrencia", debito.id_recorrencia)
        .eq("tipo", "RECEITA")
        .single();
      if (!credito) return null;
      return montarTransferencia(debito, credito);
    })
  );

  const result = transferencias.filter(Boolean);
  logResponse(200, { count: result.length });
  return json(result);
}

async function criar(
  c: ReturnType<typeof db>,
  body: Record<string, unknown>,
  userId: string
) {
  logRequest("POST", "/transferencias", body);
  
  const erroVal = validarPayload(body);
  if (erroVal) {
    logResponse(422, { erro: erroVal });
    return erro(erroVal, 422);
  }

  const semOrigem = await verificarContaAtiva(c, body.conta_origem_id as string, "Conta de origem");
  if (semOrigem) return semOrigem;
  
  const semDestino = await verificarContaAtiva(c, body.conta_destino_id as string, "Conta de destino");
  if (semDestino) return semDestino;

  const catId = await idCategoriaTransferencias(c, userId);
  if (!catId) {
    logResponse(500);
    return erro("Categoria Transferências não encontrada", 500);
  }

  const status = (body.status as string) ?? "PAGO";
  const valor = Number(body.valor);
  const desc = (body.descricao as string) ?? "";
  const idGrupoPar = crypto.randomUUID();

  log("Criando transações", { idGrupoPar, valor, status });

  // Inserir débito
  const { data: debito, error: e1 } = await c
    .from("transacoes")
    .insert({
      user_id: userId,
      conta_id: body.conta_origem_id,
      categoria_id: catId,
      tipo: "DESPESA",
      valor,
      data: body.data,
      descricao: `[Transf. saída] ${desc}`.trim(),
      status,
      id_recorrencia: idGrupoPar,
      nr_parcela: 1,
      total_parcelas: 1,
      tipo_recorrencia: null,
    })
    .select()
    .single();

  if (e1 || !debito) {
    logError("Criar débito", e1);
    logResponse(500, { erro: e1?.message });
    return erro("Erro ao criar lançamento de saída: " + (e1?.message || "erro desconhecido"), 500);
  }

  logSuccess("Débito criado", { id: debito.id });

  // Inserir crédito
  const { data: credito, error: e2 } = await c
    .from("transacoes")
    .insert({
      user_id: userId,
      conta_id: body.conta_destino_id,
      categoria_id: catId,
      tipo: "RECEITA",
      valor,
      data: body.data,
      descricao: `[Transf. entrada] ${desc}`.trim(),
      status,
      id_recorrencia: idGrupoPar,
      nr_parcela: 1,
      total_parcelas: 1,
      tipo_recorrencia: null,
    })
    .select()
    .single();

  if (e2 || !credito) {
    logError("Criar crédito", e2);
    await c.from("transacoes").delete().eq("id", debito.id);
    logResponse(500, { erro: e2?.message });
    return erro("Erro ao criar lançamento de entrada: " + (e2?.message || "erro desconhecido"), 500);
  }

  logSuccess("Crédito criado", { id: credito.id });

  const result = montarTransferencia(debito, credito);
  logResponse(201, result);
  return json(result, 201);
}

async function editar(
  c: ReturnType<typeof db>,
  idPar: string,
  body: Record<string, unknown>,
  userId: string
) {
  logRequest("PUT", `/transferencias/${idPar}`, body);
  
  const erroVal = validarPayload(body, true);
  if (erroVal) {
    logResponse(422, { erro: erroVal });
    return erro(erroVal, 422);
  }

  const par = await buscarPar(c, idPar, userId);
  if (!par) {
    logResponse(404);
    return erro("Transferência não encontrada", 404);
  }

  if (body.conta_origem_id && body.conta_origem_id !== par.debito.conta_id) {
    const r = await verificarContaAtiva(c, body.conta_origem_id as string, "Conta de origem");
    if (r) return r;
  }
  if (body.conta_destino_id && body.conta_destino_id !== par.credito.conta_id) {
    const r = await verificarContaAtiva(c, body.conta_destino_id as string, "Conta de destino");
    if (r) return r;
  }

  const novaOrigem = body.conta_origem_id ?? par.debito.conta_id;
  const novaDestino = body.conta_destino_id ?? par.credito.conta_id;
  if (novaOrigem === novaDestino) {
    logResponse(422, { erro: "contas devem ser diferentes" });
    return erro("contas devem ser diferentes", 422);
  }

  const desc = body.descricao !== undefined ? (body.descricao as string) : null;
  
  const camposComuns: Record<string, unknown> = {};
  if (body.valor !== undefined) camposComuns.valor = Number(body.valor);
  if (body.data !== undefined) camposComuns.data = body.data;
  if (body.status !== undefined) camposComuns.status = body.status;

  const { error: eu1 } = await c.from("transacoes").update({
    ...camposComuns,
    conta_id: novaOrigem,
    ...(desc !== null ? { descricao: `[Transf. saída] ${desc}`.trim() } : {}),
  }).eq("id", par.debito.id as string);
  
  if (eu1) {
    logError("Atualizar débito", eu1);
    return erro(eu1.message, 500);
  }

  const { error: eu2 } = await c.from("transacoes").update({
    ...camposComuns,
    conta_id: novaDestino,
    ...(desc !== null ? { descricao: `[Transf. entrada] ${desc}`.trim() } : {}),
  }).eq("id", par.credito.id as string);
  
  if (eu2) {
    logError("Atualizar crédito", eu2);
    return erro(eu2.message, 500);
  }

  const parAtualizado = await buscarPar(c, idPar, userId);
  if (!parAtualizado) {
    logResponse(500);
    return erro("Erro ao recuperar transferência atualizada", 500);
  }

  const result = montarTransferencia(parAtualizado.debito, parAtualizado.credito);
  logResponse(200, result);
  return json(result);
}

async function excluir(
  c: ReturnType<typeof db>,
  idPar: string,
  userId: string
) {
  logRequest("DELETE", `/transferencias/${idPar}`);
  
  const par = await buscarPar(c, idPar, userId);
  if (!par) {
    logResponse(404);
    return erro("Transferência não encontrada", 404);
  }

  const { error: eu1 } = await c.from("transacoes")
    .update({ id_recorrencia: null })
    .in("id", [par.debito.id as string, par.credito.id as string]);
  if (eu1) {
    logError("Preparar exclusão", eu1);
    return erro(eu1.message, 500);
  }

  const { error: eu2 } = await c.from("transacoes")
    .delete()
    .in("id", [par.debito.id as string, par.credito.id as string]);
  if (eu2) {
    logError("Excluir", eu2);
    return erro(eu2.message, 500);
  }

  logResponse(200, { mensagem: "Excluída com sucesso" });
  return json({ mensagem: "Transferência excluída com sucesso" });
}