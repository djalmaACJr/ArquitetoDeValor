// supabase/functions/transferencias/index.ts
// Arquiteto de Valor — Edge Function: transferencias v2
// Suporta recorrência: total_parcelas + tipo_recorrencia (frequência) + intervalo_recorrencia

import "@supabase/functions-js/edge-runtime.d.ts";
import {
  json, erro, db, autenticar, extrairId,
  validarStatus, calcularDataParcela, corsPreFlight
} from "../_shared/utils.ts";
import { logError, logSuccess, logRequest, logResponse } from "../_shared/logger.ts";

const FREQUENCIAS = ["DIARIA","SEMANAL","MENSAL","ANUAL"];
const ESCOPOS     = ["SOMENTE_ESTE","ESTE_E_SEGUINTES","TODOS"];

interface Transacao {
  id: string; user_id: string; conta_id: string; categoria_id: string
  tipo: 'RECEITA' | 'DESPESA'; valor: number; data: string; descricao: string
  status: string; id_recorrencia: string | null; id_par_transferencia: string | null
  nr_parcela: number | null; total_parcelas: number | null; tipo_recorrencia: string | null
  criado_em: string; atualizado_em: string; [key: string]: unknown
}

async function idCategoriaTransferencias(c: ReturnType<typeof db>, userId: string): Promise<string | null> {
  const { data } = await c.from("categorias").select("id")
    .eq("user_id", userId).eq("descricao", "Transferências").eq("protegida", true).is("id_pai", null).single();
  return data?.id ?? null;
}

async function buscarPar(c: ReturnType<typeof db>, idPar: string, userId: string): Promise<{ debito: Transacao; credito: Transacao } | null> {
  const { data, error } = await c.from("transacoes").select("*")
    .eq("id_par_transferencia", idPar).eq("user_id", userId).order("tipo");
  if (error || !data || data.length !== 2) return null;
  const debito  = data.find((t: Transacao) => t.tipo === "DESPESA") as Transacao | undefined;
  const credito = data.find((t: Transacao) => t.tipo === "RECEITA") as Transacao | undefined;
  if (!debito || !credito) return null;
  return { debito, credito };
}

function montarTransferencia(debito: Transacao, credito: Transacao) {
  return {
    id_par:           debito.id_par_transferencia,
    conta_origem_id:  debito.conta_id,
    conta_destino_id: credito.conta_id,
    valor:            debito.valor,
    data:             debito.data,
    descricao:        debito.descricao?.replace(/^\[Transf\. saída\] ?/, "") || null,
    status:           debito.status,
    id_recorrencia:   debito.id_recorrencia,
    total_parcelas:   debito.total_parcelas ?? null,
    parcela_atual:    debito.nr_parcela ?? null,
    tipo_recorrencia: debito.tipo_recorrencia ?? null,
    id_debito:        debito.id,
    id_credito:       credito.id,
    criado_em:        debito.criado_em,
    atualizado_em:    debito.atualizado_em,
  };
}

async function verificarContaAtiva(c: ReturnType<typeof db>, contaId: string, label: string): Promise<Response | null> {
  const { data, error } = await c.from("contas").select("id, ativa").eq("id", contaId).maybeSingle();
  if (error) return erro(`Erro ao verificar ${label.toLowerCase()}: ` + error.message, 500);
  if (!data)       return erro(`${label} não encontrada`, 404);
  if (!data.ativa) return erro(`${label} está inativa`, 422);
  return null;
}

function validarPayload(body: Record<string, unknown>, modoEdicao = false): string | null {
  if (!modoEdicao) {
    if (!body.conta_origem_id)  return "conta_origem_id é obrigatório";
    if (!body.conta_destino_id) return "conta_destino_id é obrigatório";
    if (!body.valor)            return "valor é obrigatório";
    if (!body.data)             return "data é obrigatória";
  }
  if (body.conta_origem_id && body.conta_destino_id && body.conta_origem_id === body.conta_destino_id)
    return "conta_origem_id e conta_destino_id devem ser diferentes";
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id  = extrairId(req, "transferencias");
  const m   = req.method;
  const c   = db(req);
  const url = new URL(req.url);

  const escopo = url.searchParams.get("escopo") ?? "SOMENTE_ESTE";

  try {
    if (m === "GET"    && id)  return await buscarPorId(c, id, userId);
    if (m === "GET"    && !id) return await listar(c, userId, url.searchParams);
    if (m === "POST"   && !id) return await criar(c, await req.json(), userId);
    if (m === "PUT"    && id)  return await editar(c, id, await req.json(), userId, escopo);
    if (m === "DELETE" && id)  return await excluir(c, id, userId, escopo);
    return erro("Rota não encontrada", 404);
  } catch (e) {
    logError("Handler principal", e);
    return erro("Erro interno: " + (e as Error).message, 500);
  }
});

async function buscarPorId(c: ReturnType<typeof db>, idPar: string, userId: string) {
  const par = await buscarPar(c, idPar, userId);
  if (!par) return erro("Transferência não encontrada", 404);
  return json(montarTransferencia(par.debito, par.credito));
}

async function listar(c: ReturnType<typeof db>, userId: string, params: URLSearchParams) {
  const catId = await idCategoriaTransferencias(c, userId);
  if (!catId) return erro("Categoria Transferências não encontrada", 500);

  let query = c.from("transacoes").select("*")
    .eq("user_id", userId).eq("categoria_id", catId).eq("tipo", "DESPESA")
    .not("id_par_transferencia", "is", null).order("data", { ascending: false });

  const mes = params.get("mes");
  if (mes) {
    const [anoStr, mesNumStr] = mes.split("-");
    const ano = parseInt(anoStr, 10), mesNum = parseInt(mesNumStr, 10);
    if (!isNaN(ano) && !isNaN(mesNum)) query = query.eq("ano_tx", ano).eq("mes_tx", mesNum);
  }
  const statusParam = params.get("status");
  if (statusParam) query = query.eq("status", statusParam);

  const { data: debitos, error: err } = await query;
  if (err) return erro(err.message, 500);
  if (!debitos || debitos.length === 0) return json([]);

  const idsPar = debitos.map((d: Transacao) => d.id_par_transferencia).filter(Boolean);
  const { data: creditos, error: errCred } = await c.from("transacoes").select("*")
    .in("id_par_transferencia", idsPar).eq("tipo", "RECEITA");
  if (errCred) return erro(errCred.message, 500);

  const creditoMap = new Map<string, Transacao>();
  (creditos ?? []).forEach((cr: Transacao) => {
    if (cr.id_par_transferencia) creditoMap.set(cr.id_par_transferencia, cr);
  });

  return json(debitos.map((debito: Transacao) => {
    const credito = creditoMap.get(debito.id_par_transferencia!);
    if (!credito) return null;
    return montarTransferencia(debito, credito);
  }).filter(Boolean));
}

async function criar(c: ReturnType<typeof db>, body: Record<string, unknown>, userId: string) {
  logRequest("POST", "/transferencias", body);

  const erroVal = validarPayload(body);
  if (erroVal) return erro(erroVal, 422);

  const [semOrigem, semDestino] = await Promise.all([
    verificarContaAtiva(c, body.conta_origem_id as string, "Conta de origem"),
    verificarContaAtiva(c, body.conta_destino_id as string, "Conta de destino"),
  ]);
  if (semOrigem)  return semOrigem;
  if (semDestino) return semDestino;

  const catId = await idCategoriaTransferencias(c, userId);
  if (!catId) return erro("Categoria Transferências não encontrada", 500);

  const statusOriginal = String(body.status ?? "PAGO");
  const dataBase       = String(body.data);
  const hoje           = new Date().toISOString().split("T")[0];
  const valor          = Number(body.valor);
  const desc           = String(body.descricao ?? "");

  // Validação: PROJECAO só para datas futuras
  if (statusOriginal === "PROJECAO" && dataBase <= hoje)
    return erro("RV-008: status PROJECAO só é permitido para datas futuras", 422);

  const totalParcelas = body.total_parcelas ? parseInt(String(body.total_parcelas)) : 1;
  const frequencia    = body.tipo_recorrencia ? String(body.tipo_recorrencia) : null;
  const intervalo     = body.intervalo_recorrencia ? parseInt(String(body.intervalo_recorrencia)) : 1;
  const isRecorrente  = totalParcelas > 1 && frequencia && FREQUENCIAS.includes(frequencia);

  // ── Transferência simples ───────────────────────────────────
  if (!isRecorrente) {
    const idPar = crypto.randomUUID();
    const base = {
      user_id: userId, categoria_id: catId, valor, data: dataBase,
      status: statusOriginal, id_par_transferencia: idPar,
      id_recorrencia: null, nr_parcela: null, total_parcelas: null, tipo_recorrencia: null,
    };
    const { data: debito, error: e1 } = await c.from("transacoes").insert({
      ...base, conta_id: body.conta_origem_id, tipo: "DESPESA",
      descricao: `[Transf. saída] ${desc}`.trim(),
    }).select().single();
    if (e1 || !debito) { logError("Criar transferência — débito", e1); return erro("Erro ao criar lançamento de saída", 500); }

    const { data: credito, error: e2 } = await c.from("transacoes").insert({
      ...base, conta_id: body.conta_destino_id, tipo: "RECEITA",
      descricao: `[Transf. entrada] ${desc}`.trim(),
    }).select().single();
    if (e2 || !credito) {
      await c.from("transacoes").delete().eq("id", debito.id);
      logError("Criar transferência — crédito", e2);
      return erro("Erro ao criar lançamento de entrada", 500);
    }
    return json(montarTransferencia(debito as Transacao, credito as Transacao), 201);
  }

  // ── Transferência recorrente — criar N pares ────────────────
  const idRecorrencia  = crypto.randomUUID();
  const tipoRecBanco   = statusOriginal === "PROJECAO" ? "PROJECAO" : "PARCELA";
  const resultado: ReturnType<typeof montarTransferencia>[] = [];

  for (let i = 0; i < totalParcelas; i++) {
    const dataParcela = calcularDataParcela(dataBase, frequencia!, i * intervalo);
    let statusParcela: string;
    if (dataParcela <= hoje)             statusParcela = "PAGO";
    else if (statusOriginal === "PROJECAO") statusParcela = "PROJECAO";
    else                                 statusParcela = "PENDENTE";

    const idPar = crypto.randomUUID();
    const base = {
      user_id: userId, categoria_id: catId, valor, data: dataParcela,
      status: statusParcela, id_par_transferencia: idPar,
      id_recorrencia: idRecorrencia, nr_parcela: i + 1,
      total_parcelas: totalParcelas, tipo_recorrencia: tipoRecBanco,
    };

    const { data: debito, error: e1 } = await c.from("transacoes").insert({
      ...base, conta_id: body.conta_origem_id, tipo: "DESPESA",
      descricao: `[Transf. saída] ${desc}`.trim(),
    }).select().single();
    if (e1 || !debito) { logError(`Criar par ${i+1} — débito`, e1); return erro(`Erro ao criar parcela ${i+1}`, 500); }

    const { data: credito, error: e2 } = await c.from("transacoes").insert({
      ...base, conta_id: body.conta_destino_id, tipo: "RECEITA",
      descricao: `[Transf. entrada] ${desc}`.trim(),
    }).select().single();
    if (e2 || !credito) {
      await c.from("transacoes").delete().eq("id", debito.id);
      logError(`Criar par ${i+1} — crédito`, e2);
      return erro(`Erro ao criar parcela ${i+1}`, 500);
    }
    resultado.push(montarTransferencia(debito as Transacao, credito as Transacao));
  }

  logSuccess("Transferência recorrente criada", { id_recorrencia: idRecorrencia, parcelas: totalParcelas });
  return json({ id_recorrencia: idRecorrencia, total: resultado.length, parcelas: resultado }, 201);
}

async function editar(c: ReturnType<typeof db>, idPar: string, body: Record<string, unknown>, userId: string, escopo: string) {
  if (!ESCOPOS.includes(escopo))
    return erro("escopo inválido: use SOMENTE_ESTE | ESTE_E_SEGUINTES | TODOS", 400);

  const erroVal = validarPayload(body, true);
  if (erroVal) return erro(erroVal, 422);

  const par = await buscarPar(c, idPar, userId);
  if (!par) return erro("Transferência não encontrada", 404);

  const verificacoes = await Promise.all([
    body.conta_origem_id && body.conta_origem_id !== par.debito.conta_id
      ? verificarContaAtiva(c, body.conta_origem_id as string, "Conta de origem") : Promise.resolve(null),
    body.conta_destino_id && body.conta_destino_id !== par.credito.conta_id
      ? verificarContaAtiva(c, body.conta_destino_id as string, "Conta de destino") : Promise.resolve(null),
  ]);
  if (verificacoes[0]) return verificacoes[0];
  if (verificacoes[1]) return verificacoes[1];

  const novaOrigem  = body.conta_origem_id  ?? par.debito.conta_id;
  const novaDestino = body.conta_destino_id ?? par.credito.conta_id;
  if (novaOrigem === novaDestino) return erro("conta_origem_id e conta_destino_id devem ser diferentes", 422);

  // Validação PROJECAO só para datas futuras
  const hoje = new Date().toISOString().split("T")[0];
  const dataEfetiva = String(body.data ?? par.debito.data);
  if (body.status === "PROJECAO" && dataEfetiva <= hoje)
    return erro("RV-008: status PROJECAO só é permitido para datas futuras", 422);

  const desc = body.descricao !== undefined ? (body.descricao as string) : null;
  const camposComuns: Record<string, unknown> = {};
  if (body.valor  !== undefined) camposComuns.valor  = Number(body.valor);
  if (body.data   !== undefined) camposComuns.data   = body.data;
  if (body.status !== undefined) camposComuns.status = body.status;

  // ── Escopo SOMENTE_ESTE (ou par sem recorrência) ─────────────
  if (escopo === "SOMENTE_ESTE" || !par.debito.id_recorrencia) {
    const { error: eu1 } = await c.from("transacoes").update({
      ...camposComuns, conta_id: novaOrigem,
      ...(desc !== null ? { descricao: `[Transf. saída] ${desc}`.trim() } : {}),
    }).eq("id", par.debito.id);
    if (eu1) return erro("Erro ao atualizar débito: " + eu1.message, 500);

    const { error: eu2 } = await c.from("transacoes").update({
      ...camposComuns, conta_id: novaDestino,
      ...(desc !== null ? { descricao: `[Transf. entrada] ${desc}`.trim() } : {}),
    }).eq("id", par.credito.id);
    if (eu2) return erro("Erro ao atualizar crédito: " + eu2.message, 500);

    const parAtualizado = await buscarPar(c, idPar, userId);
    if (!parAtualizado) return erro("Erro ao recuperar transferência atualizada", 500);
    return json(montarTransferencia(parAtualizado.debito, parAtualizado.credito));
  }

  // ── Escopo TODOS ou ESTE_E_SEGUINTES ─────────────────────────
  // Apenas valor/status/descricao são propagados (data e contas continuam por par).
  let qDebitos = c.from("transacoes").select("id, id_par_transferencia, nr_parcela")
    .eq("user_id", userId)
    .eq("id_recorrencia", par.debito.id_recorrencia)
    .eq("tipo", "DESPESA");
  if (escopo === "ESTE_E_SEGUINTES" && par.debito.nr_parcela != null)
    qDebitos = qDebitos.gte("nr_parcela", par.debito.nr_parcela);

  const { data: debitos, error: eDeb } = await qDebitos;
  if (eDeb || !debitos) return erro("Erro ao buscar parcelas da série: " + (eDeb?.message ?? "")  , 500);

  const idsPar = debitos.map((d: { id_par_transferencia: string }) => d.id_par_transferencia).filter(Boolean);
  if (idsPar.length === 0) return erro("Nenhuma parcela encontrada para o escopo informado", 404);

  const updateDebito: Record<string, unknown> = { ...camposComuns };
  const updateCredito: Record<string, unknown> = { ...camposComuns };
  if (desc !== null) {
    updateDebito.descricao  = `[Transf. saída] ${desc}`.trim();
    updateCredito.descricao = `[Transf. entrada] ${desc}`.trim();
  }

  const { error: eUpDeb } = await c.from("transacoes")
    .update(updateDebito)
    .in("id_par_transferencia", idsPar)
    .eq("tipo", "DESPESA");
  if (eUpDeb) return erro("Erro ao atualizar débitos da série: " + eUpDeb.message, 500);

  const { error: eUpCred } = await c.from("transacoes")
    .update(updateCredito)
    .in("id_par_transferencia", idsPar)
    .eq("tipo", "RECEITA");
  if (eUpCred) return erro("Erro ao atualizar créditos da série: " + eUpCred.message, 500);

  logSuccess("Série de transferências atualizada", { escopo, atualizados: idsPar.length });
  return json({ atualizados: idsPar.length, escopo });
}

async function excluir(c: ReturnType<typeof db>, idPar: string, userId: string, escopo: string) {
  if (!ESCOPOS.includes(escopo))
    return erro("escopo inválido: use SOMENTE_ESTE | ESTE_E_SEGUINTES | TODOS", 400);

  const par = await buscarPar(c, idPar, userId);
  if (!par) return erro("Transferência não encontrada", 404);

  // ── Escopo SOMENTE_ESTE (ou par sem recorrência) ─────────────
  if (escopo === "SOMENTE_ESTE" || !par.debito.id_recorrencia) {
    const { error: eu1 } = await c.from("transacoes")
      .update({ id_par_transferencia: null }).in("id", [par.debito.id, par.credito.id]);
    if (eu1) return erro("Erro ao preparar exclusão: " + eu1.message, 500);

    const { error: eu2 } = await c.from("transacoes").delete().in("id", [par.debito.id, par.credito.id]);
    if (eu2) return erro("Erro ao excluir: " + eu2.message, 500);

    return json({ mensagem: "Transferência excluída com sucesso", excluidos: 1 });
  }

  // ── Escopo TODOS ou ESTE_E_SEGUINTES ─────────────────────────
  let qDebitos = c.from("transacoes").select("id, id_par_transferencia, nr_parcela")
    .eq("user_id", userId)
    .eq("id_recorrencia", par.debito.id_recorrencia)
    .eq("tipo", "DESPESA");
  if (escopo === "ESTE_E_SEGUINTES" && par.debito.nr_parcela != null)
    qDebitos = qDebitos.gte("nr_parcela", par.debito.nr_parcela);

  const { data: debitos, error: eDeb } = await qDebitos;
  if (eDeb || !debitos) return erro("Erro ao buscar parcelas da série: " + (eDeb?.message ?? ""), 500);

  const idsPar = debitos.map((d: { id_par_transferencia: string }) => d.id_par_transferencia).filter(Boolean);
  if (idsPar.length === 0) return erro("Nenhuma parcela encontrada para o escopo informado", 404);

  // Buscar todos os IDs de transação (débito + crédito) dos pares filtrados
  const { data: todasTx, error: eTx } = await c.from("transacoes").select("id")
    .in("id_par_transferencia", idsPar);
  if (eTx || !todasTx) return erro("Erro ao buscar transações da série: " + (eTx?.message ?? ""), 500);

  const idsTx = todasTx.map((t: { id: string }) => t.id);

  // Limpar id_par_transferencia para destravar trigger de bloqueio
  const { error: eUp } = await c.from("transacoes")
    .update({ id_par_transferencia: null }).in("id", idsTx);
  if (eUp) return erro("Erro ao preparar exclusão da série: " + eUp.message, 500);

  const { error: eDel } = await c.from("transacoes").delete().in("id", idsTx);
  if (eDel) return erro("Erro ao excluir série: " + eDel.message, 500);

  logSuccess("Série de transferências excluída", { escopo, excluidos: idsPar.length });
  return json({ mensagem: "Série de transferências excluída com sucesso", excluidos: idsPar.length, escopo });
}
