// supabase/functions/transacoes/index.ts
// Arquiteto de Valor — Edge Function: transacoes v9

import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, extrairId, extrairAcao,
         verificarExistencia, validarStatus, calcularDataParcela, corsPreFlight } from "../_shared/utils.ts";
import { registrarOrigem } from "../_shared/utils.ts";
import { logDebug, logError, logInfo, logRequest, logResponse, logSuccess } from "../_shared/logger.ts";

const TIPOS_TX   = ["RECEITA","DESPESA"];
const ESCOPOS    = ["SOMENTE_ESTE","ESTE_E_SEGUINTES","TODOS"];
const FREQUENCIAS = ["DIARIA","SEMANAL","MENSAL","ANUAL"];

Deno.serve(async (req: Request) => {
  registrarOrigem(req);
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = await autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id     = extrairId(req, "transacoes");
  const acao   = extrairAcao(req, "transacoes");
  const m      = req.method;
  const c      = db(req);
  const params = new URL(req.url).searchParams;
  const escopo = params.get("escopo") ?? "SOMENTE_ESTE";

  try {
        if (m === "GET"    && !id)                       return await listar(c, params, userId);
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

// Enriquece transações "cruas" com os campos que a view antiga (window
// function) devolvia via JOIN — categoria/conta (nome, ícone, cor) e o
// nome da categoria-pai. Mesmos nomes de campo, para o frontend não notar
// diferença. `catMap`/`contaMap` vêm de uma leitura única (tabelas pequenas
// por usuário), reusada para todas as linhas do mês.
interface TxRow {
  id: string; categoria_id: string | null; conta_id: string;
  [k: string]: unknown;
}
interface CatInfo { descricao: string; icone: string | null; cor: string | null; id_pai: string | null }
interface ContaInfo { nome: string; icone: string | null; cor: string | null }

function decorarTransacao(
  t: TxRow, catMap: Map<string, CatInfo>, contaMap: Map<string, ContaInfo>,
) {
  const cat    = t.categoria_id ? catMap.get(t.categoria_id) : undefined;
  const catPai = cat?.id_pai ? catMap.get(cat.id_pai) : undefined;
  const conta  = contaMap.get(t.conta_id);
  return {
    ...t,
    categoria_nome:     cat?.descricao ?? null,
    categoria_icone:    cat?.icone ?? null,
    categoria_cor:      cat?.cor ?? null,
    categoria_pai_nome: catPai?.descricao ?? null,
    conta_nome:         conta?.nome ?? null,
    conta_icone:        conta?.icone ?? null,
    conta_cor:          conta?.cor ?? null,
  };
}

// GET /transacoes?saldo=true&mes=YYYY-MM — extrato com saldo corrente por
// linha. ANTES: consultava vw_transacoes_com_saldo, uma view com window
// function (SUM() OVER PARTITION BY user_id ORDER BY data, criado_em) —
// como views não deixam o Postgres empurrar o filtro de mês para antes do
// window, TODA consulta de 1 mês varria e ordenava o HISTÓRICO INTEIRO do
// usuário (medido: 349ms para 113 linhas contra 23mil transações; 89,7% de
// todo o tempo de execução do banco em pg_stat_statements).
//
// AGORA: usa fn_saldo_total_antes_de(user_id, primeiro_dia_do_mes) — uma
// agregação simples (sem window/sort/join) que dá o saldo na véspera do mês
// em ~12ms — e soma incrementalmente em JS só sobre as linhas do mês
// pedido (dezenas a poucas centenas). Matematicamente idêntico ao que a
// view sempre devolveu: ano_tx/mes_tx são GENERATED ALWAYS a partir de
// `data`, então "data < início do mês" é exatamente o mesmo particiona-
// mento cronológico que a window function usava. Validado comparando os
// dois caminhos em 5 pontos do histórico (2009→2028) antes de trocar.
async function listarComSaldo(
  c: ReturnType<typeof db>, params: URLSearchParams, userId: string,
) {
  const mes      = params.get("mes")!; // presença garantida pelo chamador
  const contaId  = params.get("conta_id");
  const catId    = params.get("categoria_id");
  const status   = params.get("status");
  const idRecorrencia = params.get("id_recorrencia");
  const page     = parseInt(params.get("page") ?? "1");
  const perPage  = 1000;

  const [ano, mesNum] = mes.split("-").map(Number);
  const primeiroDia = `${ano}-${String(mesNum).padStart(2, '0')}-01`;
  const anoUlt = mesNum === 12 ? ano + 1 : ano;
  const mesUlt = mesNum === 12 ? 1 : mesNum + 1;
  const ultimoDia   = `${anoUlt}-${String(mesUlt).padStart(2, '0')}-01`;

  let qTx = c.from("transacoes").select("*")
    .gte("data", primeiroDia).lt("data", ultimoDia)
    .order("data", { ascending: true }).order("criado_em", { ascending: true });
  if (contaId) qTx = qTx.eq("conta_id", contaId);
  if (catId)   qTx = qTx.eq("categoria_id", catId);
  if (status)  qTx = qTx.eq("status", status);
  if (idRecorrencia) qTx = qTx.eq("id_recorrencia", idRecorrencia);

  const [baseRes, txRes, catRes, contaRes] = await Promise.all([
    c.rpc("fn_saldo_total_antes_de", { p_user_id: userId, p_data: primeiroDia }),
    qTx,
    c.from("categorias").select("id, descricao, icone, cor, id_pai"),
    c.from("contas").select("id, nome, icone, cor"),
  ]);
  if (baseRes.error)  { logError("Saldo base do mês", baseRes.error);   return erro(baseRes.error.message); }
  if (txRes.error)    { logError("Listar transações (saldo)", txRes.error); return erro(txRes.error.message); }
  if (catRes.error)   { logError("Categorias (saldo)", catRes.error);   return erro(catRes.error.message); }
  if (contaRes.error) { logError("Contas (saldo)", contaRes.error);     return erro(contaRes.error.message); }

  const catMap = new Map<string, CatInfo>(
    (catRes.data ?? []).map((c2) => [c2.id, { descricao: c2.descricao, icone: c2.icone, cor: c2.cor, id_pai: c2.id_pai }]),
  );
  const contaMap = new Map<string, ContaInfo>(
    (contaRes.data ?? []).map((c2) => [c2.id, { nome: c2.nome, icone: c2.icone, cor: c2.cor }]),
  );

  let acumulado = Number(baseRes.data) || 0;
  const decoradas = (txRes.data ?? []).map((t) => {
    acumulado += t.tipo === "RECEITA" ? Number(t.valor) : -Number(t.valor);
    return { ...decorarTransacao(t, catMap, contaMap), saldo_acumulado: Number(acumulado.toFixed(2)) };
  });

  const offset = (page - 1) * perPage;
  const pagina = decoradas.slice(offset, offset + perPage);

  logResponse(200, { count: pagina.length, page, perPage });
  return json({ dados: pagina, pagina: page, por_pagina: perPage });
}

async function listar(c: ReturnType<typeof db>, params: URLSearchParams, userId: string) {
  logRequest("GET", "/transacoes", { params: Object.fromEntries(params) });

  const mes      = params.get("mes");
  const contaId  = params.get("conta_id");
  const catId    = params.get("categoria_id");
  const status   = params.get("status");
  const idRecorrencia = params.get("id_recorrencia");
  const comSaldo = params.get("saldo") === "true";

  if (comSaldo && mes) return await listarComSaldo(c, params, userId);

  const page     = parseInt(params.get("page") ?? "1");
  const perPage  = comSaldo
    ? 1000
    : Math.min(parseInt(params.get("per_page") ?? "50"), 1000);
  const offset   = (page - 1) * perPage;

  // comSaldo sem `mes` é caso raro (não usado pelo frontend hoje — Extrato
  // sempre manda mes junto de saldo=true); mantém o caminho antigo (view)
  // como fallback correto para não quebrar um uso futuro sem otimizar algo
  // que não está no caminho quente medido. Chegando aqui, comSaldo&&mes já
  // foi tratado acima — então mes só aparece com !comSaldo (tabela crua).
  const fonte = comSaldo ? "vw_transacoes_com_saldo" : "transacoes";
  let q = c.from(fonte).select("*")
    .order("data",      { ascending: true })
    .order("criado_em", { ascending: true })
    .range(offset, offset + perPage - 1);

  if (mes) {
    const [ano, mesNum] = mes.split("-").map(Number);
    const primeiroDia = `${ano}-${String(mesNum).padStart(2, '0')}-01`;
    const anoUlt = mesNum === 12 ? ano + 1 : ano;
    const mesUlt = mesNum === 12 ? 1 : mesNum + 1;
    const ultimoDia = `${anoUlt}-${String(mesUlt).padStart(2, '0')}-01`;
    q = q.gte("data", primeiroDia).lt("data", ultimoDia);
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

// ── Vínculo com investimentos (proventos) ────────────────────
// Uma categoria mapeada a um tipo de provento (inv_tipos_dividendo.categoria_id)
// — ou cuja categoria-pai esteja mapeada — torna o lançamento "de investimento".
// Retorna o tipo_dividendo apenas quando o vínculo é único (senão null).
async function vinculoProvento(
  c: ReturnType<typeof db>,
  categoriaId: string | null,
): Promise<{ vinculado: boolean; tipoDividendoId: string | null }> {
  if (!categoriaId) return { vinculado: false, tipoDividendoId: null };
  const { data: cat } = await c.from("categorias").select("id_pai").eq("id", categoriaId).maybeSingle();
  const ids = [categoriaId];
  if (cat?.id_pai) ids.push(String(cat.id_pai));
  const { data: tipos } = await c.from("inv_tipos_dividendo")
    .select("id").in("categoria_id", ids).eq("ativo", true);
  if (!tipos || tipos.length === 0) return { vinculado: false, tipoDividendoId: null };
  return { vinculado: true, tipoDividendoId: tipos.length === 1 ? String(tipos[0].id) : null };
}

// O ticker é o primeiro segmento da descrição (formato "TICKER - Nome").
function tickerDaDescricao(descricao: string): string {
  return String(descricao).split(" - ")[0].trim();
}

async function ativoPorTicker(
  c: ReturnType<typeof db>,
  ticker: string,
): Promise<{ id: string; tipo_ativo: string } | null> {
  const t = ticker.trim();
  if (!t) return null;
  const { data } = await c.from("inv_ativos").select("id, tipo_ativo").ilike("ticker", t).limit(1);
  return data && data.length ? { id: String(data[0].id), tipo_ativo: String(data[0].tipo_ativo) } : null;
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

  // Categoria: se informada, deve existir e estar ativa
  if (body.categoria_id) {
    const { data: cat } = await c.from("categorias")
      .select("ativa").eq("id", String(body.categoria_id)).maybeSingle();
    if (!cat)       return erro("RV-005: categoria não encontrada", 422);
    if (!cat.ativa) return erro("RV-005: categoria inativa não pode ser usada em novos lançamentos", 422);
  }

  // ── Replicação para investimentos (proventos) ──────────────
  // RECEITA numa categoria de provento deve referenciar um ativo cadastrado;
  // cada transação criada espelha um inv_dividendos vinculado.
  // Restore/import passam replicar_investimento=false: os dividendos têm
  // restore próprio (módulo de investimentos), então não se replica aqui.
  let proventoAtivo: { id: string; tipo_ativo: string } | null = null;
  let proventoTipoDividendoId: string | null = null;
  const replicarInvestimento = body.replicar_investimento !== false;
  const vinc = replicarInvestimento
    ? await vinculoProvento(c, body.categoria_id ? String(body.categoria_id) : null)
    : { vinculado: false, tipoDividendoId: null };
  if (vinc.vinculado && String(body.tipo) === "RECEITA") {
    proventoAtivo = await ativoPorTicker(c, tickerDaDescricao(String(body.descricao)));
    if (!proventoAtivo)
      return erro("RV-010: lançamento de provento deve começar pelo ticker de um ativo cadastrado (ex.: PETR4 - ...)", 422);
    proventoTipoDividendoId = vinc.tipoDividendoId;
  }

  const statusOriginal = String(body.status);
  const dataBase       = String(body.data);
  const hoje           = new Date().toISOString().split("T")[0];

  // ── Validação: PROJECAO só para datas futuras ───────────────
  if (statusOriginal === "PROJECAO" && dataBase <= hoje)
    return erro("RV-008: status PROJECAO só é permitido para datas futuras", 422);

  // ── Validação: recorrência é "tudo-ou-nada" ─────────────────
  // Se qualquer campo de recorrência for enviado, todos devem estar presentes.
  const temTotal = body.total_parcelas !== undefined && body.total_parcelas !== null;
  const temFreq  = body.tipo_recorrencia !== undefined && body.tipo_recorrencia !== null;
  const temInt   = body.intervalo_recorrencia !== undefined && body.intervalo_recorrencia !== null;
  if ((temTotal || temFreq || temInt) && !(temTotal && temFreq && temInt))
    return erro("RV-009: recorrência requer total_parcelas, tipo_recorrencia e intervalo_recorrencia juntos", 400);

  const totalParcelas    = temTotal ? parseInt(String(body.total_parcelas)) : 1;
  const frequencia       = temFreq ? String(body.tipo_recorrencia) : null;
  const intervalo        = temInt ? parseInt(String(body.intervalo_recorrencia)) : 1;

  // Se trio enviado, validar conteúdo
  if (temTotal && temFreq && temInt) {
    if (isNaN(totalParcelas) || totalParcelas < 1)
      return erro("RV-009: total_parcelas deve ser inteiro >= 1", 400);
    if (!FREQUENCIAS.includes(frequencia!))
      return erro("RV-009: tipo_recorrencia inválido (use DIARIA | SEMANAL | MENSAL | ANUAL)", 400);
    if (isNaN(intervalo) || intervalo < 1)
      return erro("RV-009: intervalo_recorrencia deve ser inteiro >= 1", 400);
  }

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
    // Espelhar provento em investimentos (atômico: rollback da transação se falhar)
    if (proventoAtivo) {
      const { error: eDiv } = await c.from("inv_dividendos").insert({
        user_id:              userId,
        ativo_id:             proventoAtivo.id,
        conta_id:             body.conta_id,
        valor:                body.valor,
        data_pagamento:       dataBase,
        tipo_ativo:           proventoAtivo.tipo_ativo,
        descricao:            body.descricao,
        tipo_dividendo_id:    proventoTipoDividendoId,
        transacao_extrato_id: data.id,
      });
      if (eDiv) {
        logError("Replicar provento (simples)", eDiv);
        await c.from("transacoes").delete().eq("id", data.id);
        return erro("Falha ao replicar o provento em investimentos: " + eDiv.message, 500);
      }
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
    
    // Debug para verificar status
    logDebug(`Parcela ${i+1}: data=${dataParcela}, hoje=${hoje}, status=${statusParcela}`);

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

  // Espelhar provento em investimentos — um inv_dividendos por parcela criada
  if (proventoAtivo) {
    const divs = (data as Record<string, unknown>[]).map(tx => ({
      user_id:              userId,
      ativo_id:             proventoAtivo!.id,
      conta_id:             tx.conta_id,
      valor:                tx.valor,
      data_pagamento:       tx.data,
      tipo_ativo:           proventoAtivo!.tipo_ativo,
      descricao:            tx.descricao,
      tipo_dividendo_id:    proventoTipoDividendoId,
      transacao_extrato_id: tx.id,
    }));
    const { error: eDiv } = await c.from("inv_dividendos").insert(divs);
    if (eDiv) {
      logError("Replicar provento (recorrência)", eDiv);
      await c.from("transacoes").delete().eq("id_recorrencia", idRecorrencia);
      return erro("Falha ao replicar os proventos em investimentos: " + eDiv.message, 500);
    }
  }

  logSuccess("Recorrência criada", { id_recorrencia: idRecorrencia, parcelas: totalParcelas });
  return json({ id_recorrencia: idRecorrencia, total: data.length, parcelas: data }, 201);
}

// Propaga a troca de ATIVO de um provento ao editar a descrição no extrato
// (modo investimento). Lê o ticker do INÍCIO da descrição (formato do datalist
// "TICKER - Nome"), acha o ativo do usuário e, se for outro, repointar o
// inv_dividendos vinculado. Sem trigger no banco porque só o app sabe casar a
// descrição com o ticker; valor/data/conta já são sincronizados por trigger.
// Sincroniza o espelho em investimentos (inv_dividendos) das transações dadas,
// cobrindo edição única OU em série (recorrência):
//   • RECEITA em categoria de provento + ticker resolvido → cria o vínculo se
//     faltar (replica projeção legada) ou atualiza ativo/tipo se já existir;
//   • saiu da categoria de investimento → remove o espelho;
//   • categoria ainda de investimento mas ticker não resolveu → mantém como está
//     (não apaga por causa de um typo).
// valor/data/conta continuam sincronizados pelo trigger trg_sync_transacao_dividendo.
async function sincronizarProventoTransacoes(c: ReturnType<typeof db>, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data: txs } = await c.from("transacoes")
    .select("id, user_id, tipo, descricao, valor, data, conta_id, categoria_id").in("id", ids);
  if (!txs || txs.length === 0) return;

  const { data: divs } = await c.from("inv_dividendos")
    .select("id, transacao_extrato_id").in("transacao_extrato_id", ids);
  const divPorTx = new Map<string, string>();
  for (const d of divs ?? []) {
    const tid = (d as { transacao_extrato_id: string | null }).transacao_extrato_id;
    if (tid) divPorTx.set(String(tid), String((d as { id: string }).id));
  }

  for (const tx of txs as {
    id: string; user_id: string; tipo: string; descricao: string | null;
    valor: number; data: string; conta_id: string; categoria_id: string | null;
  }[]) {
    const vinc  = await vinculoProvento(c, tx.categoria_id);
    const ativo = (vinc.vinculado && tx.tipo === "RECEITA")
      ? await ativoPorTicker(c, tickerDaDescricao(String(tx.descricao ?? ""))) : null;
    const divId = divPorTx.get(tx.id);

    if (ativo) {
      if (divId) {
        await c.from("inv_dividendos").update({
          ativo_id: ativo.id, tipo_ativo: ativo.tipo_ativo, tipo_dividendo_id: vinc.tipoDividendoId,
        }).eq("id", divId);
      } else {
        const { error } = await c.from("inv_dividendos").insert({
          user_id: tx.user_id, ativo_id: ativo.id, conta_id: tx.conta_id, valor: tx.valor,
          data_pagamento: tx.data, tipo_ativo: ativo.tipo_ativo, tipo_dividendo_id: vinc.tipoDividendoId,
          descricao: tx.descricao, transacao_extrato_id: tx.id,
        });
        if (error) logError("Sincronizar provento (criar)", error);
      }
    } else if (divId && !vinc.vinculado) {
      await c.from("inv_dividendos").delete().eq("id", divId);
    }
  }
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

  // Categoria: se está sendo alterada, a nova deve estar ativa
  if (body.categoria_id !== undefined && body.categoria_id !== null
      && body.categoria_id !== atual.categoria_id) {
    const { data: cat } = await c.from("categorias")
      .select("ativa").eq("id", String(body.categoria_id)).maybeSingle();
    if (!cat)       return erro("categoria não encontrada", 422);
    if (!cat.ativa) return erro("categoria inativa não pode ser atribuída a um lançamento", 422);
  }

  // Campos permitidos no update de dados do lançamento
  const camposPermitidos = ["tipo","data","descricao","valor","conta_id","categoria_id","status","observacao"];
  const dadosUpdate: Record<string, unknown> = {};
  camposPermitidos.forEach(k => { if (body[k] !== undefined) dadosUpdate[k] = body[k]; });

  // Frequência e intervalo enviados pelo frontend (para ESTE_E_SEGUINTES)
  const novaFrequenciaBody = body.tipo_recorrencia ? String(body.tipo_recorrencia) : null;
  const novoIntervaloBody  = body.intervalo_recorrencia ? parseInt(String(body.intervalo_recorrencia)) : null;
  const novoTotalParcelas  = body.total_parcelas ? parseInt(String(body.total_parcelas)) : null;

  // Processar alteração de total_parcelas se for recorrência com escopo ESTE_E_SEGUINTES
  if (atual.id_recorrencia && escopo === "ESTE_E_SEGUINTES" && novoTotalParcelas && atual.total_parcelas !== novoTotalParcelas) {
    logDebug(`Alterando total_parcelas de ${atual.total_parcelas} para ${novoTotalParcelas}`);
    
    if (novoTotalParcelas < atual.total_parcelas) {
      // REDUÇÃO: Excluir parcelas excedentes
      const parcelasParaExcluir = await c.from("transacoes")
        .select("id")
        .eq("id_recorrencia", atual.id_recorrencia)
        .gt("nr_parcela", novoTotalParcelas)
        .gte("nr_parcela", atual.nr_parcela);
      
      if (parcelasParaExcluir.data && parcelasParaExcluir.data.length > 0) {
        const idsParaExcluir = parcelasParaExcluir.data.map((p: { id: string }) => p.id);
        // Replica em investimentos: remove os inv_dividendos espelho ANTES de
        // apagar as parcelas (a FK é ON DELETE SET NULL — sem isto, órfãos).
        const { error: eDivDel } = await c.from("inv_dividendos")
          .delete().in("transacao_extrato_id", idsParaExcluir);
        if (eDivDel) { logError("Excluir proventos das parcelas excedentes", eDivDel); return erro(eDivDel.message); }
        const { error: eExcluir } = await c.from("transacoes").delete().in("id", idsParaExcluir);
        if (eExcluir) {
          logError("Erro ao excluir parcelas excedentes", eExcluir);
          return erro("Erro ao excluir parcelas excedentes");
        }
        logSuccess(`Excluídas ${idsParaExcluir.length} parcelas excedentes`);
      }
    } else if (novoTotalParcelas > atual.total_parcelas) {
      // EXTENSÃO: Criar novas parcelas
      const ultimaParcelaResult = await c.from("transacoes")
        .select("nr_parcela, data")
        .eq("id_recorrencia", atual.id_recorrencia)
        .order("nr_parcela", { ascending: false })
        .limit(1)
        .single();
      
      if (ultimaParcelaResult.data) {
        const ultimaParcela = ultimaParcelaResult.data as { nr_parcela: number; data: string };
        const frequenciaFinal = novaFrequenciaBody || atual.tipo_recorrencia || 'MENSAL';
        const intervaloFinal = novoIntervaloBody || 1;
        
        // tipo_recorrencia no banco: PROJECAO ou PARCELA
        const tipoRecBanco = atual.status === "PROJECAO" ? "PROJECAO" : "PARCELA";
        
        // Criar novas parcelas
        const novasParcelas = [];
        for (let i = atual.total_parcelas + 1; i <= novoTotalParcelas; i++) {
          const offset = i - (ultimaParcela.nr_parcela ?? 1);
          const novaData = calcularDataParcela(ultimaParcela.data, frequenciaFinal, offset * intervaloFinal);
          
          // Status da nova parcela baseado na data
          const hoje = new Date().toISOString().split("T")[0];
          let statusParcela: string;
          if (novaData <= hoje) {
            statusParcela = "PAGO";
          } else if (atual.status === "PROJECAO") {
            statusParcela = "PROJECAO";
          } else {
            statusParcela = "PENDENTE";
          }
          
          novasParcelas.push({
            user_id: atual.user_id,
            id_recorrencia: atual.id_recorrencia,
            nr_parcela: i,
            total_parcelas: novoTotalParcelas,
            tipo: atual.tipo,
            descricao: atual.descricao,
            valor: atual.valor,
            conta_id: atual.conta_id,
            categoria_id: atual.categoria_id,
            status: statusParcela,
            data: novaData,
            observacao: atual.observacao,
            tipo_recorrencia: tipoRecBanco,
          });
        }
        
        if (novasParcelas.length > 0) {
          logDebug(`Tentando criar ${novasParcelas.length} novas parcelas:`, novasParcelas);
          const { error: eCriar } = await c.from("transacoes").insert(novasParcelas);
          if (eCriar) {
            logError("Erro ao criar novas parcelas", eCriar);
            logError("Detalhes do erro:", { 
              message: eCriar.message,
              details: eCriar.details,
              hint: eCriar.hint,
              code: eCriar.code
            });
            return erro(`Erro ao criar novas parcelas: ${eCriar.message}`);
          }
          logSuccess(`Criadas ${novasParcelas.length} novas parcelas`);
        }
      }
    }
    
    // Atualizar total_parcelas em todas as parcelas da recorrência
    await c.from("transacoes")
      .update({ total_parcelas: novoTotalParcelas })
      .eq("id_recorrencia", atual.id_recorrencia);
  }

  // Somente recorrências podem ter escopo estendido
  if (!atual.id_recorrencia || escopo === "SOMENTE_ESTE") {
    const { data, error } = await c.from("transacoes").update(dadosUpdate).eq("id", id).select();
    if (error) { logError("Editar transação", error); return erro(error.message); }
    // Replica/espelha o provento em investimentos (cria vínculo se faltar,
    // atualiza ativo/tipo ou remove se saiu de categoria de investimento).
    await sincronizarProventoTransacoes(c, [id]);
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

  // ── Recalcular datas se data ou frequência foram alteradas ─────
  const dataFoiAlterada      = body.data !== undefined && body.data !== atual.data;
  const novaDataBase         = dataFoiAlterada ? String(body.data) : String(atual.data);

  // Prioridade: frequência/intervalo enviados pelo body (edição explícita)
  // Fallback: detectar via diferença entre as primeiras parcelas da série
  let frequencia: string | null = novaFrequenciaBody && FREQUENCIAS.includes(novaFrequenciaBody) ? novaFrequenciaBody : null;
  let intervalo = novoIntervaloBody && novoIntervaloBody > 0 ? novoIntervaloBody : 1;

  // Se não veio no body, detectar via datas existentes (necessário para recalcular após mudança de data)
  if (!frequencia && parcelas.length > 1) {
    const { data: meta } = await c.from("transacoes")
      .select("data")
      .eq("id_recorrencia", atual.id_recorrencia)
      .order("nr_parcela", { ascending: true })
      .limit(2);

    if (meta && meta.length >= 2) {
      const d1 = new Date(meta[0].data);
      const d2 = new Date(meta[1].data);
      const diffDias = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDias === 1)                          { frequencia = "DIARIA";  intervalo = 1; }
      else if (diffDias % 7 === 0)                 { frequencia = "SEMANAL"; intervalo = diffDias / 7; }
      else if (diffDias >= 28 && diffDias <= 31)   { frequencia = "MENSAL";  intervalo = 1; }
      else if (diffDias >= 56 && diffDias <= 62)   { frequencia = "MENSAL";  intervalo = 2; }
      else if (diffDias >= 84 && diffDias <= 93)   { frequencia = "MENSAL";  intervalo = 3; }
      else if (diffDias >= 365 && diffDias <= 366) { frequencia = "ANUAL";   intervalo = 1; }
      else                                          { frequencia = "MENSAL";  intervalo = 1; }
    }
  }

  // Recalcular datas se: data base mudou OU frequência/intervalo mudaram
  const frequenciaFoiAlterada = novaFrequenciaBody !== null;
  const precisaRecalcularDatas = dataFoiAlterada || frequenciaFoiAlterada;

  // ── Atualizar cada parcela individualmente ───────────────────
  const nrAtual = atual.nr_parcela ?? 1;
  let atualizados = 0;

  for (const parcela of parcelas) {
    const update: Record<string, unknown> = { ...dadosUpdate };

    // Recalcular data proporcional ao offset desta parcela na série
    if (precisaRecalcularDatas && frequencia) {
      const offset = (parcela.nr_parcela - nrAtual);
      const novaData = calcularDataParcela(novaDataBase, frequencia, offset * intervalo);
      update.data = novaData;
      
      // Recalcular status baseado na nova data
      if (novaData <= hoje) {
        update.status = "PAGO";
      } else if (atual.status === "PROJECAO") {
        update.status = "PROJECAO";
      } else {
        update.status = "PENDENTE";
      }
      
      logDebug(`Parcela ${parcela.nr_parcela}: novaData=${novaData}, status=${update.status}`);
    } else if (dataFoiAlterada) {
      // Sem frequência detectada — manter offset de dias original
      const dataOriginalParcela = new Date(parcela.data);
      const dataOriginalBase    = new Date(atual.data);
      const dataNovaBase        = new Date(novaDataBase);
      const diffMs = dataNovaBase.getTime() - dataOriginalBase.getTime();
      const novaData = new Date(dataOriginalParcela.getTime() + diffMs);
      update.data = novaData.toISOString().split("T")[0];
      
      // Recalcular status baseado na nova data
      const dataUpdate = String(update.data);
      if (dataUpdate <= hoje) {
        update.status = "PAGO";
      } else if (atual.status === "PROJECAO") {
        update.status = "PROJECAO";
      } else {
        update.status = "PENDENTE";
      }
      
      logDebug(`Parcela ${parcela.nr_parcela}: novaData=${update.data}, status=${update.status}`);
    }

    const { error: eUp } = await c.from("transacoes").update(update).eq("id", parcela.id);
    if (eUp) { logError(`Editar parcela ${parcela.id}`, eUp); }
    else atualizados++;
  }

  // Replica/espelha o provento em investimentos para TODAS as parcelas do escopo.
  await sincronizarProventoTransacoes(c, parcelas.map((p) => String(p.id)));

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

  // Excluir um lançamento no extrato REFLETE em investimentos: se a
  // transação espelha um provento (inv_dividendos.transacao_extrato_id),
  // o dividendo é removido junto. Feito ANTES de apagar a transação (depois
  // o FK ON DELETE SET NULL zeraria o vínculo e perderíamos a referência).
  //
  // Isto vale só para a exclusão individual pela UI do extrato. A rotina de
  // limpeza (/limpar) NÃO passa por aqui: ela apaga transações direto e
  // preserva os dividendos (apenas desvincula via SET NULL). Por isso a
  // propagação fica na Edge Function, não num trigger de DELETE em transacoes
  // (um trigger dispararia também na limpeza e apagaria os dividendos).
  const { error: eDiv } = await c.from("inv_dividendos")
    .delete().in("transacao_extrato_id", ids);
  if (eDiv) { logError("Excluir dividendos vinculados", eDiv); return erro(eDiv.message); }

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

