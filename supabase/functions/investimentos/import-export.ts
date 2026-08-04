// supabase/functions/investimentos/import-export.ts
// Migração de conta, atualização em lote de ativos/tesouro, importação e
// restauração de backup — extraído de index.ts.
import { json, erro, extrairId, buscarTodasLinhas } from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import {
  Db, TIPOS_ATIVO, SUBTIPOS_ACOES, STATUS_POSICAO, TIPOS_OPERACAO, RE_MES_ANO,
  hojeISO, dataPagamentoPlausivel, contaExiste, ativoExiste, inserirEmLote,
} from "./shared.ts";
import {
  resolverNomes, resolverPrecosAtuais, precosBrapi, precosCripto, resolverMeta,
  nomeTesouro, tesouroSemestral, tickerTesouro,
} from "./mercado.ts";
import { recomputarPosicao } from "./posicoes.ts";
import { calcularDesempenho, recalcularSeguinte, snapshotVizinho } from "./snapshot.ts";
import { descricaoProvento, ptaxVendaAte } from "./dividendos.ts";
import { validarQuestionario } from "./avaliacoes.ts";

export async function rotaMigrarConta(c: Db, req: Request, m: string, _userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const body = await req.json();
  const de   = String(body?.de_conta_id ?? "");
  const para = String(body?.para_conta_id ?? "");
  const ativoIds = Array.isArray(body?.ativo_ids)
    ? [...new Set((body.ativo_ids as unknown[]).map(String).filter(Boolean))]
    : null; // null = migrar a conta inteira
  logRequest("POST", "/investimentos/migrar-conta", { de, para, ativos: ativoIds?.length ?? "todos" });

  if (!de || !para)  return erro("Campos obrigatórios: de_conta_id, para_conta_id");
  if (de === para)   return erro("As contas de origem e destino devem ser diferentes");
  if (ativoIds && ativoIds.length === 0) return erro("Selecione ao menos um ativo para migrar");
  if (!(await contaExiste(c, de))) return erro("Conta de origem não encontrada", 404);
  const { data: contaPara } = await c.from("contas")
    .select("id, tipo, ativa").eq("id", para).maybeSingle();
  if (!contaPara) return erro("Conta de destino não encontrada", 404);
  if (contaPara.tipo !== "INVESTIMENTO") return erro("A conta de destino deve ser do tipo INVESTIMENTO", 409);
  if (!contaPara.ativa) return erro("A conta de destino precisa estar ativa", 409);

  // 1) Posições — update em bloco (da conta e, se pedido, só dos ativos)
  let qPos = c.from("inv_posicoes").update({ conta_id: para }).eq("conta_id", de);
  if (ativoIds) qPos = qPos.in("ativo_id", ativoIds);
  const { data: posMov, error: errPos } = await qPos.select("id");
  if (errPos) { logError("migrar-conta posicoes", errPos); return erro(errPos.message); }

  // 2) Operações — seguem as posições migradas (histórico completo da posição)
  const posIds = ((posMov ?? []) as { id: string }[]).map((p) => p.id);
  let opMovidas = 0;
  for (let i = 0; i < posIds.length; i += 200) {
    const lote = posIds.slice(i, i + 200);
    const { data: ops, error: errOp } = await c.from("inv_operacoes")
      .update({ conta_id: para }).in("posicao_id", lote).select("id");
    if (errOp) { logError("migrar-conta operacoes", errOp); return erro(errOp.message); }
    opMovidas += (ops ?? []).length;
  }

  // 3) Dividendos + transações vinculadas no extrato
  let qDivSel = c.from("inv_dividendos").select("id, transacao_extrato_id").eq("conta_id", de);
  if (ativoIds) qDivSel = qDivSel.in("ativo_id", ativoIds);
  const { data: divs, error: errDivSel } = await qDivSel;
  if (errDivSel) { logError("migrar-conta dividendos sel", errDivSel); return erro(errDivSel.message); }
  let qDivUpd = c.from("inv_dividendos").update({ conta_id: para }).eq("conta_id", de);
  if (ativoIds) qDivUpd = qDivUpd.in("ativo_id", ativoIds);
  const { error: errDiv } = await qDivUpd;
  if (errDiv) { logError("migrar-conta dividendos", errDiv); return erro(errDiv.message); }

  const txIds = ((divs ?? []) as { transacao_extrato_id: string | null }[])
    .map((d) => d.transacao_extrato_id)
    .filter((t): t is string => !!t);
  let txMovidas = 0;
  for (let i = 0; i < txIds.length; i += 200) {          // lotes p/ não estourar a URL
    const lote = txIds.slice(i, i + 200);
    const { data: txs, error: errTx } = await c.from("transacoes")
      .update({ conta_id: para }).in("id", lote).select("id");
    if (errTx) { logError("migrar-conta transacoes", errTx); return erro(errTx.message); }
    txMovidas += (txs ?? []).length;
  }

  // 4) Histórico mensal — UNIQUE (ativo, conta, mes): move ou mescla
  let qHist = c.from("inv_historico_mensal")
    .select("id, ativo_id, mes_ano, valor_mercado, quantidade, preco_medio, rentabilidade_mes")
    .eq("conta_id", de);
  if (ativoIds) qHist = qHist.in("ativo_id", ativoIds);
  const { data: histOrig, error: errHo } = await qHist;
  if (errHo) { logError("migrar-conta hist origem", errHo); return erro(errHo.message); }
  const { data: histDest } = await c.from("inv_historico_mensal")
    .select("id, ativo_id, mes_ano, valor_mercado, quantidade, preco_medio, rentabilidade_mes")
    .eq("conta_id", para);
  type Hist = { id: string; ativo_id: string; mes_ano: string; valor_mercado: number; quantidade: number; preco_medio: number; rentabilidade_mes: number };
  const destPorChave = new Map<string, Hist>();
  for (const h of (histDest ?? []) as Hist[]) destPorChave.set(`${h.ativo_id}|${h.mes_ano}`, h);

  let histMovidos = 0, histMesclados = 0;
  for (const h of (histOrig ?? []) as Hist[]) {
    const alvo = destPorChave.get(`${h.ativo_id}|${h.mes_ano}`);
    if (!alvo) {
      const { error: e1 } = await c.from("inv_historico_mensal")
        .update({ conta_id: para }).eq("id", h.id);
      if (e1) { logError("migrar-conta hist mover", e1); return erro(e1.message); }
      histMovidos++;
      continue;
    }
    // Mesmo ativo/mês nas duas contas → soma quantidades e valores; o preço
    // médio vira a média ponderada pelas quantidades.
    const qtd = Number(alvo.quantidade) + Number(h.quantidade);
    const pm  = qtd > 0
      ? (Number(alvo.preco_medio) * Number(alvo.quantidade) + Number(h.preco_medio) * Number(h.quantidade)) / qtd
      : Number(alvo.preco_medio);
    const { error: e2 } = await c.from("inv_historico_mensal").update({
      valor_mercado:     Number((Number(alvo.valor_mercado) + Number(h.valor_mercado)).toFixed(2)),
      quantidade:        qtd,
      preco_medio:       Number(pm.toFixed(8)),
      rentabilidade_mes: Number((Number(alvo.rentabilidade_mes) + Number(h.rentabilidade_mes)).toFixed(2)),
    }).eq("id", alvo.id);
    if (e2) { logError("migrar-conta hist mesclar", e2); return erro(e2.message); }
    const { error: e3 } = await c.from("inv_historico_mensal").delete().eq("id", h.id);
    if (e3) { logError("migrar-conta hist apagar", e3); return erro(e3.message); }
    histMesclados++;
  }

  const resultado = {
    posicoes:        (posMov ?? []).length,
    operacoes:       opMovidas,
    dividendos:      (divs ?? []).length,
    transacoes:      txMovidas,
    historico_movido:   histMovidos,
    historico_mesclado: histMesclados,
  };
  logSuccess("Migração de conta de investimentos", { de, para, ...resultado });
  return json({ dados: resultado });
}

// ============================================================
// /investimentos/rendimento-cripto (POST, JWT do usuário)
//
// Materializa o rendimento (yield) das criptos com cripto_rendimento_aa > 0
// como operações RENDIMENTO: 1 por mês por posição (upsert), com juros
// compostos diários. Aumenta a quantidade com custo zero (mais tokens) — não
// é provento. Idempotente: re-rodar só ajusta os valores dos meses.
// ============================================================
export interface AtivoIn {
  ticker: string; nome?: string; tipo_ativo: string; moeda?: string;
  rf_subtipo?: string | null; rf_indexador?: string | null;
  rf_emissor?: string | null; rf_vencimento?: string | null;
  fii_categoria?: string | null; acoes_subtipo?: string | null;
}
export interface PosicaoIn {
  ticker: string; conta_id: string; quantidade: number; preco_custo: number;
  data_compra: string; valor_mercado: number; mes_ano?: string;
}
export interface OperacaoIn {
  ticker: string; conta_id: string; tipo_operacao: string; quantidade: number;
  preco_unitario?: number; valor_total?: number; data_operacao: string;
}
export interface DividendoIn {
  ticker: string; conta_id: string; valor: number; data_pagamento: string;
  tipo_ativo: string; tipo_dividendo_nome?: string | null;
}


// ============================================================
// /investimentos/atualizar-ativos — re-busca nome/moeda oficiais
//
// Reaplica a fonte externa (brapi) a TODOS os ativos do usuário, para o
// caso de a chamada ter falhado no cadastro/importação (ex.: BRAPI_TOKEN
// ausente na época) e o ativo ter ficado só com o ticker. Conservador:
//   • nome  → só preenche quando o atual está vazio ou é o próprio ticker
//             (nunca sobrescreve um nome editado à mão);
//   • moeda → a fonte é autoritativa; corrige quando diverge (ex.: STOCKS
//             que ficaram em BRL devem virar USD).
// Renda fixa privada e Tesouro Direto não têm fonte → são ignorados.
// ============================================================
export async function rotaAtualizarAtivos(c: Db, _req: Request, m: string, _userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/atualizar-ativos", {});

  const { data, error } = await c.from("inv_ativos")
    .select("id, ticker, nome, tipo_ativo, moeda, logo_url, setor");
  if (error) { logError("Atualizar ativos — listar", error); return erro(error.message); }
  const lista = (data ?? []) as
    { id: string; ticker: string; nome: string; tipo_ativo: string; moeda: string; logo_url: string | null; setor: string | null }[];
  if (lista.length === 0) {
    return json({ dados: { processados: 0, atualizados: 0, ativos: [] } });
  }

  const meta = await resolverMeta(lista.map((a) =>
    ({ ticker: a.ticker, tipo_ativo: a.tipo_ativo })));

  const atualizados: { ticker: string; nome: string }[] = [];
  for (const a of lista) {
    const info = meta.get(String(a.ticker).toUpperCase());
    if (!info) continue;
    const tk = String(a.ticker).toUpperCase();
    const campos: Record<string, unknown> = {};

    // Preenche o nome quando o atual está vazio ou é só o ticker. Grava mesmo
    // quando o nome oficial É o próprio ticker (ex.: USDC) — senão fica "—".
    const nomeEhTicker = !a.nome || a.nome.trim().toUpperCase() === tk;
    if (info.nome && nomeEhTicker && info.nome !== a.nome) {
      campos.nome = info.nome;
    }
    if (info.moeda && info.moeda.length <= 3 && info.moeda !== a.moeda) {
      campos.moeda = info.moeda;
    }
    if (info.logo && info.logo !== a.logo_url) {
      campos.logo_url = info.logo;
    }
    if (info.setor && info.setor !== a.setor) {
      campos.setor = info.setor;
    }
    if (Object.keys(campos).length === 0) continue;

    const { error: eUp } = await c.from("inv_ativos").update(campos).eq("id", a.id);
    if (eUp) { logError(`Atualizar ativo ${tk}`, eUp); continue; }
    atualizados.push({ ticker: a.ticker, nome: String(campos.nome ?? a.nome) });
  }

  logSuccess("Ativos atualizados", { processados: lista.length, atualizados: atualizados.length });
  return json({ dados: { processados: lista.length, atualizados: atualizados.length, ativos: atualizados } });
}

// ============================================================
// /investimentos/normalizar-tesouro — padroniza o ticker/nome dos títulos
// do Tesouro já cadastrados para o formato legível (TD-IPCA-2040…), derivado
// de indexador + vencimento (+ juros semestrais). Idempotente: re-rodar não
// muda nada. Pula quando faltam dados ou quando o código novo colidiria com
// outro ativo já existente (relatado em `ignorados`).
// ============================================================
export async function rotaNormalizarTesouro(c: Db, _req: Request, m: string, _userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/normalizar-tesouro");

  const { data, error } = await c.from("inv_ativos")
    .select("id, ticker, nome, rf_indexador, rf_vencimento")
    .eq("tipo_ativo", "TESOURO_DIRETO");
  if (error) { logError("Normalizar Tesouro — listar", error); return erro(error.message); }
  const lista = (data ?? []) as {
    id: string; ticker: string; nome: string | null;
    rf_indexador: string | null; rf_vencimento: string | null;
  }[];
  if (lista.length === 0) return json({ dados: { processados: 0, renomeados: 0, ativos: [], ignorados: [] } });

  // tickers em uso (para detectar colisão antes do UPDATE)
  const emUso = new Set(lista.map((a) => String(a.ticker).toUpperCase()));
  const renomeados: { de: string; para: string }[] = [];
  const ignorados:  { ticker: string; motivo: string }[] = [];

  for (const a of lista) {
    const indexador = a.rf_indexador;
    const venc      = a.rf_vencimento;
    const atual     = String(a.ticker).toUpperCase();
    if (!indexador || !venc) { ignorados.push({ ticker: a.ticker, motivo: "sem indexador/vencimento" }); continue; }
    const semestral = tesouroSemestral(String(a.nome ?? ""));
    const novo = tickerTesouro(indexador, venc, semestral);
    if (!novo) { ignorados.push({ ticker: a.ticker, motivo: "vencimento inválido" }); continue; }
    if (novo === atual) continue;                               // já no padrão
    if (emUso.has(novo)) { ignorados.push({ ticker: a.ticker, motivo: `já existe ${novo}` }); continue; }

    const campos: Record<string, unknown> = { ticker: novo };
    // Nome: só preenche/normaliza quando vazio ou ainda era o ticker antigo
    // (nunca sobrescreve um nome editado à mão).
    const nomeAtual = String(a.nome ?? "").trim();
    if (!nomeAtual || nomeAtual.toUpperCase() === atual) campos.nome = nomeTesouro(indexador, venc, semestral);

    const { error: eUp } = await c.from("inv_ativos").update(campos).eq("id", a.id);
    if (eUp) { ignorados.push({ ticker: a.ticker, motivo: eUp.message }); continue; }
    emUso.delete(atual); emUso.add(novo);
    renomeados.push({ de: a.ticker, para: novo });
  }

  logSuccess("Tesouro normalizado", { processados: lista.length, renomeados: renomeados.length });
  return json({ dados: { processados: lista.length, renomeados: renomeados.length, ativos: renomeados, ignorados } });
}

export async function rotaImportar(c: Db, req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const body = await req.json();
  logRequest("POST", "/investimentos/importar", {
    ativos: body?.ativos?.length, posicoes: body?.posicoes?.length,
    operacoes: body?.operacoes?.length, dividendos: body?.dividendos?.length,
    gerar_extrato: body?.gerar_extrato_proventos,
  });

  const ativosIn     = Array.isArray(body.ativos)     ? body.ativos     as AtivoIn[]     : [];
  const posicoesIn   = Array.isArray(body.posicoes)   ? body.posicoes   as PosicaoIn[]   : [];
  const operacoesIn  = Array.isArray(body.operacoes)  ? body.operacoes  as OperacaoIn[]  : [];
  const dividendosIn = Array.isArray(body.dividendos) ? body.dividendos as DividendoIn[] : [];
  const gerarExtrato = body.gerar_extrato_proventos === true;
  const avisos: string[] = [];

  if (ativosIn.length === 0 && posicoesIn.length === 0 &&
      operacoesIn.length === 0 && dividendosIn.length === 0) {
    return erro("Nada para importar");
  }

  const up = (s: unknown) => String(s ?? "").trim().toUpperCase();

  try {
    // ── Validação de contas (uma vez) ───────────────────────────────
    const contaIds = [...new Set([
      ...posicoesIn.map((p) => p.conta_id),
      ...operacoesIn.map((o) => o.conta_id),
      ...dividendosIn.map((d) => d.conta_id),
    ].filter(Boolean))];
    const contasValidas = new Set<string>();
    if (contaIds.length > 0) {
      const { data: contasOk } = await c.from("contas").select("id").in("id", contaIds);
      for (const x of contasOk ?? []) contasValidas.add(String(x.id));
    }

    // ── 1) Ativos — insere só os que ainda não existem ──────────────
    const { data: existentes } = await c.from("inv_ativos").select("id, ticker, nome, moeda");
    const idPorTicker = new Map<string, string>();
    const nomePorTicker = new Map<string, string>();   // ticker → nome (p/ descrição do provento)
    const moedaPorTicker = new Map<string, string>();  // ticker → moeda (p/ converter proventos)
    for (const a of existentes ?? []) {
      idPorTicker.set(up(a.ticker), String(a.id));
      nomePorTicker.set(up(a.ticker), String(a.nome ?? ""));
      moedaPorTicker.set(up(a.ticker), String(a.moeda ?? "BRL").toUpperCase());
    }

    const novosPorTicker = new Map<string, Record<string, unknown>>();
    for (const a of ativosIn) {
      const ticker = up(a.ticker);
      if (!ticker || ticker.length > 20) continue;
      if (!TIPOS_ATIVO.includes(String(a.tipo_ativo))) continue;
      if (idPorTicker.has(ticker) || novosPorTicker.has(ticker)) continue;
      novosPorTicker.set(ticker, {
        user_id:       userId,
        ticker,
        nome:          String(a.nome ?? ticker).trim().slice(0, 120) || ticker,
        tipo_ativo:    a.tipo_ativo,
        moeda:         a.moeda ? up(a.moeda).slice(0, 3) : "BRL",
        rf_subtipo:    a.rf_subtipo ?? null,
        rf_indexador:  a.rf_indexador ?? null,
        rf_emissor:    a.rf_emissor ?? null,
        rf_vencimento: a.rf_vencimento ?? null,
        fii_categoria: a.fii_categoria ?? null,
        acoes_subtipo: SUBTIPOS_ACOES.includes(String(a.acoes_subtipo)) ? a.acoes_subtipo : null,
      });
    }
    // Nome oficial via busca externa para os que vieram sem nome (= ticker)
    if (novosPorTicker.size > 0) {
      const semNome = [...novosPorTicker.values()].filter((r) =>
        !r.nome || String(r.nome).toUpperCase() === String(r.ticker).toUpperCase());
      if (semNome.length > 0) {
        const nomes = await resolverNomes(semNome.map((r) =>
          ({ ticker: String(r.ticker), tipo_ativo: String(r.tipo_ativo) })));
        for (const r of semNome) {
          const n = nomes.get(String(r.ticker).toUpperCase());
          if (n) r.nome = n;
        }
      }
    }

    // Nomes/moeda dos ativos novos entram nos mapas p/ descrição e conversão do provento.
    for (const [tk, r] of novosPorTicker) {
      nomePorTicker.set(tk, String(r.nome ?? ""));
      moedaPorTicker.set(tk, String(r.moeda ?? "BRL").toUpperCase());
    }

    let ativosCriados = 0;
    if (novosPorTicker.size > 0) {
      const criados = await inserirEmLote(c, "inv_ativos", [...novosPorTicker.values()], "id, ticker");
      ativosCriados = criados.length;
      for (const a of criados) idPorTicker.set(up(a.ticker), String(a.id));
    }

    // ── 2) Posições — uma por (ativo_id, conta_id), status ATIVA ────
    const posPorPar = new Map<string, string>(); // ativo_id|conta_id -> posicao_id
    const { data: posExist } = await c.from("inv_posicoes")
      .select("id, ativo_id, conta_id").eq("status", "ATIVA");
    for (const p of posExist ?? []) posPorPar.set(`${p.ativo_id}|${p.conta_id}`, String(p.id));

    const posInserir: Record<string, unknown>[] = [];
    const posAtualizar: { id: string; campos: Record<string, unknown> }[] = [];
    const vistosPar = new Set<string>();
    for (const p of posicoesIn) {
      const ativoId = idPorTicker.get(up(p.ticker));
      if (!ativoId || !p.conta_id || !contasValidas.has(p.conta_id)) continue;
      const key = `${ativoId}|${p.conta_id}`;
      if (vistosPar.has(key)) continue;
      vistosPar.add(key);
      const campos = {
        quantidade:  Number(p.quantidade)  || 0,
        preco_custo: Number(p.preco_custo) || 0,
        data_compra: String(p.data_compra),
        status:      "ATIVA",
      };
      const existId = posPorPar.get(key);
      if (existId) posAtualizar.push({ id: existId, campos });
      else posInserir.push({ user_id: userId, ativo_id: ativoId, conta_id: p.conta_id, ...campos });
    }
    let posicoesCount = 0;
    if (posInserir.length > 0) {
      const criadas = await inserirEmLote(c, "inv_posicoes", posInserir, "id, ativo_id, conta_id");
      posicoesCount += criadas.length;
      for (const p of criadas) posPorPar.set(`${p.ativo_id}|${p.conta_id}`, String(p.id));
    }
    for (const u of posAtualizar) {
      const { error } = await c.from("inv_posicoes").update(u.campos).eq("id", u.id);
      if (error) avisos.push(`Falha ao atualizar posição: ${error.message}`);
      else posicoesCount++;
    }

    // Posições "fantasma" ENCERRADAS para pares que só aparecem no
    // extrato (ativo totalmente vendido) — dão lar às operações sem
    // distorcer a carteira atual (quantidade 0).
    const paresOperacao = new Set<string>();
    for (const o of operacoesIn) {
      const ativoId = idPorTicker.get(up(o.ticker));
      if (ativoId && o.conta_id && contasValidas.has(o.conta_id)) paresOperacao.add(`${ativoId}|${o.conta_id}`);
    }
    const orfas: Record<string, unknown>[] = [];
    for (const par of paresOperacao) {
      if (posPorPar.has(par)) continue;
      const [ativoId, contaId] = par.split("|");
      // data_compra = 1ª operação do par
      const datas = operacoesIn
        .filter((o) => idPorTicker.get(up(o.ticker)) === ativoId && o.conta_id === contaId)
        .map((o) => String(o.data_operacao)).filter(Boolean).sort();
      orfas.push({
        user_id: userId, ativo_id: ativoId, conta_id: contaId,
        quantidade: 0, preco_custo: 0,
        data_compra: datas[0] ?? new Date().toISOString().split("T")[0],
        status: "ENCERRADA", _par: par,
      });
    }
    if (orfas.length > 0) {
      const semPar = orfas.map(({ _par, ...r }) => r);
      const criadas = await inserirEmLote(c, "inv_posicoes", semPar, "id, ativo_id, conta_id");
      for (const p of criadas) posPorPar.set(`${p.ativo_id}|${p.conta_id}`, String(p.id));
    }

    // ── 3) Operações — dedup por (posicao, tipo, data, qtd, valor) ──
    const posIds = [...posPorPar.values()];
    const opKey = (o: Record<string, unknown>) =>
      `${o.posicao_id}|${o.tipo_operacao}|${o.data_operacao}|${Number(o.quantidade)}|${Number(o.valor_total)}`;
    const opsExistSet = new Set<string>();
    if (posIds.length > 0) {
      // .in() em pedaços para não estourar limite de URL
      for (let i = 0; i < posIds.length; i += 200) {
        const { data } = await c.from("inv_operacoes")
          .select("posicao_id, tipo_operacao, data_operacao, quantidade, valor_total")
          .in("posicao_id", posIds.slice(i, i + 200));
        for (const o of data ?? []) opsExistSet.add(opKey(o));
      }
    }
    const opsInserir: Record<string, unknown>[] = [];
    for (const o of operacoesIn) {
      const ativoId = idPorTicker.get(up(o.ticker));
      if (!ativoId || !o.conta_id || !contasValidas.has(o.conta_id)) continue;
      if (!TIPOS_OPERACAO.includes(String(o.tipo_operacao))) continue;
      const posId = posPorPar.get(`${ativoId}|${o.conta_id}`);
      if (!posId) continue;
      const qtd   = Number(o.quantidade) || 0;
      const preco = Number(o.preco_unitario) || 0;
      const valor = o.valor_total != null ? Number(o.valor_total) : qtd * preco;
      const row = {
        user_id: userId, posicao_id: posId, tipo_operacao: o.tipo_operacao,
        conta_id: o.conta_id, quantidade: qtd, preco_unitario: preco,
        valor_total: valor, data_operacao: String(o.data_operacao),
      };
      const k = opKey(row);
      if (opsExistSet.has(k)) continue;
      opsExistSet.add(k);
      opsInserir.push(row);
    }
    let operacoesCount = 0;
    if (opsInserir.length > 0) {
      const criadas = await inserirEmLote(c, "inv_operacoes", opsInserir);
      operacoesCount = criadas.length;
    }

    // ── 4) Dividendos — dedup por (ativo, data, valor, tipo_ativo) ──
    const { data: tiposDiv } = await c.from("inv_tipos_dividendo").select("id, nome, categoria_id");
    const tipoDivPorNome = new Map<string, { id: string; categoria_id: string | null }>();
    for (const t of tiposDiv ?? []) {
      tipoDivPorNome.set(String(t.nome).toLowerCase(), { id: String(t.id), categoria_id: t.categoria_id ?? null });
    }
    // cria tipos de provento ausentes (sem categoria mapeada)
    const nomesNecessarios = [...new Set(
      dividendosIn.map((d) => (d.tipo_dividendo_nome ?? "").trim()).filter(Boolean),
    )];
    for (const nome of nomesNecessarios) {
      if (tipoDivPorNome.has(nome.toLowerCase())) continue;
      const { data, error } = await c.from("inv_tipos_dividendo")
        .insert({ user_id: userId, nome: nome.slice(0, 40) }).select("id, categoria_id").single();
      if (!error && data) tipoDivPorNome.set(nome.toLowerCase(), { id: String(data.id), categoria_id: data.categoria_id ?? null });
    }

    const { data: divExist } = await c.from("inv_dividendos")
      .select("ativo_id, data_pagamento, valor, tipo_ativo");
    const divKey = (ativoId: string, data: string, valor: number, tipo: string) =>
      `${ativoId}|${data}|${valor}|${tipo}`;
    const divExistSet = new Set<string>();
    for (const d of divExist ?? []) divExistSet.add(divKey(String(d.ativo_id), String(d.data_pagamento), Number(d.valor), String(d.tipo_ativo)));

    const hoje = new Date().toISOString().split("T")[0];
    const divSemExtrato: Record<string, unknown>[] = [];
    const divComExtrato: { div: Record<string, unknown>; categoriaId: string; ticker: string; nome: string }[] = [];
    let semCategoria = 0;
    // PTAX por data já resolvida nesta importação (evita repetir a consulta
    // para vários proventos do mesmo dia).
    const ptaxCache = new Map<string, number | null>();
    for (const d of dividendosIn) {
      const ativoId = idPorTicker.get(up(d.ticker));
      let valor = Number(d.valor);
      if (!ativoId || !d.conta_id || !contasValidas.has(d.conta_id)) continue;
      if (!(valor > 0) || !TIPOS_ATIVO.includes(String(d.tipo_ativo))) continue;
      // Descarta datas-sentinela ("a definir" → 9999) vindas da importação.
      if (!dataPagamentoPlausivel(String(d.data_pagamento).slice(0, 10))) continue;
      // Provento de ativo em moeda estrangeira: converte p/ BRL antes de
      // gravar — inv_dividendos.valor/transacoes.valor só existem em BRL
      // (mesma regra do lançamento manual e da busca automática de USD).
      const moedaAtivo = moedaPorTicker.get(up(d.ticker)) ?? "BRL";
      if (moedaAtivo !== "BRL") {
        const dataPag = String(d.data_pagamento).slice(0, 10);
        if (!ptaxCache.has(dataPag)) ptaxCache.set(dataPag, await ptaxVendaAte(c, dataPag));
        const ptax = ptaxCache.get(dataPag);
        if (!ptax) continue; // sem PTAX p/ essa data: não dá p/ converter com segurança
        valor = Number((valor * ptax).toFixed(2));
      }
      const k = divKey(ativoId, String(d.data_pagamento), valor, String(d.tipo_ativo));
      if (divExistSet.has(k)) continue;
      divExistSet.add(k);
      const tipo = d.tipo_dividendo_nome ? tipoDivPorNome.get(String(d.tipo_dividendo_nome).toLowerCase()) : undefined;
      const base = {
        user_id: userId, ativo_id: ativoId, conta_id: d.conta_id, valor,
        data_pagamento: String(d.data_pagamento), tipo_ativo: d.tipo_ativo,
        tipo_dividendo_id: tipo?.id ?? null,
      };
      if (gerarExtrato && tipo?.categoria_id) {
        divComExtrato.push({ div: base, categoriaId: tipo.categoria_id, ticker: up(d.ticker), nome: nomePorTicker.get(up(d.ticker)) ?? "" });
      } else {
        if (gerarExtrato && d.tipo_dividendo_nome && !tipo?.categoria_id) semCategoria++;
        divSemExtrato.push(base);
      }
    }

    let dividendosCount = 0;
    let dividendosNoExtrato = 0;
    if (divSemExtrato.length > 0) {
      const criados = await inserirEmLote(c, "inv_dividendos", divSemExtrato, "id");
      dividendosCount += criados.length;
    }
    // Subset com extrato: por linha (precisa vincular a transação criada)
    for (const item of divComExtrato) {
      const { data: div, error: errDiv } = await c.from("inv_dividendos").insert(item.div).select("id").single();
      if (errDiv || !div) { avisos.push(`Falha ao gravar dividendo ${item.ticker}: ${errDiv?.message ?? ""}`); continue; }
      dividendosCount++;
      const futuro = String((item.div as Record<string, unknown>).data_pagamento) > hoje;
      const desc = descricaoProvento(item.ticker, item.nome);
      const { data: tx, error: errTx } = await c.from("transacoes").insert({
        user_id: userId,
        conta_id: (item.div as Record<string, unknown>).conta_id,
        categoria_id: item.categoriaId,
        data: (item.div as Record<string, unknown>).data_pagamento,
        descricao: desc,
        valor: (item.div as Record<string, unknown>).valor,
        tipo: "RECEITA",
        status: futuro ? "PROJECAO" : "PAGO",
        valor_projetado: futuro ? (item.div as Record<string, unknown>).valor : null,
      }).select("id").single();
      if (errTx || !tx) { avisos.push(`Dividendo ${item.ticker} gravado, mas falhou no extrato: ${errTx?.message ?? ""}`); continue; }
      await c.from("inv_dividendos").update({ transacao_extrato_id: tx.id }).eq("id", div.id);
      dividendosNoExtrato++;
    }
    if (semCategoria > 0) {
      avisos.push(`${semCategoria} provento(s) gravados sem extrato: o tipo não tem categoria mapeada (configure em Investimentos › Tipos de provento).`);
    }

    // ── 5) Histórico mensal — snapshot do mês corrente ──────────────
    const mesAno = hoje.slice(0, 7);
    let historicoCount = 0;
    const histVistos = new Set<string>();
    for (const p of posicoesIn) {
      const ativoId = idPorTicker.get(up(p.ticker));
      if (!ativoId || !p.conta_id || !contasValidas.has(p.conta_id)) continue;
      const mes = p.mes_ano && RE_MES_ANO.test(String(p.mes_ano)) ? String(p.mes_ano) : mesAno;
      const par = `${ativoId}|${p.conta_id}|${mes}`;
      if (histVistos.has(par)) continue;
      histVistos.add(par);
      const valorMercado = Number(p.valor_mercado);
      if (!Number.isFinite(valorMercado) || valorMercado < 0) continue;
      const quantidade = Number(p.quantidade) || 0;
      const precoMedio = Number(p.preco_custo) || 0;
      const prev = await snapshotVizinho(c, ativoId, p.conta_id, mes, "anterior");
      const desempenho = calcularDesempenho(valorMercado, quantidade, precoMedio, prev);
      const { error } = await c.from("inv_historico_mensal").upsert({
        user_id: userId, ativo_id: ativoId, conta_id: p.conta_id, mes_ano: mes,
        valor_mercado: valorMercado, quantidade, preco_medio: precoMedio, ...desempenho,
      }, { onConflict: "ativo_id,conta_id,mes_ano" });
      if (error) { avisos.push(`Histórico ${up(p.ticker)}: ${error.message}`); continue; }
      await recalcularSeguinte(c, ativoId, p.conta_id, mes);
      historicoCount++;
    }

    logSuccess("Importação de investimentos concluída", {
      ativosCriados, posicoesCount, operacoesCount, dividendosCount, dividendosNoExtrato,
    });
    return json({
      dados: {
        ativos_criados:        ativosCriados,
        posicoes:              posicoesCount,
        operacoes:             operacoesCount,
        dividendos:            dividendosCount,
        dividendos_no_extrato: dividendosNoExtrato,
        historico:             historicoCount,
        avisos,
      },
    }, 201);
  } catch (e) {
    logError("Importar investimentos", e);
    return erro(`Falha na importação: ${(e as Error).message}`);
  }
}

// ============================================================
// /investimentos/restaurar — restauração a partir do backup JSON
//
// Recria os dados de investimento preservando a estrutura (lotes,
// vínculos operação→posição, etc.). O client envia os dados do backup
// com seus IDs ORIGINAIS + um mapa conta_id e categoria_id (antigo→novo,
// resolvido no restore das contas/categorias). É idempotente: dedup por
// chaves naturais, então re-rodar não duplica.
// ============================================================

export async function rotaRestaurar(c: Db, req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const body = await req.json();
  const up = (s: unknown) => String(s ?? "").trim().toUpperCase();
  const arr = (x: unknown) => (Array.isArray(x) ? x : []) as Record<string, unknown>[];
  const contaMap     = (body.conta_map     ?? {}) as Record<string, string>;
  const categoriaMap = (body.categoria_map ?? {}) as Record<string, string>;
  const avisos: string[] = [];

  // contas-alvo válidas (do usuário)
  const contasValidas = new Set<string>();
  const alvos = [...new Set(Object.values(contaMap))];
  if (alvos.length) {
    const { data } = await c.from("contas").select("id").in("id", alvos);
    for (const x of data ?? []) contasValidas.add(String(x.id));
  }
  const novaConta = (old: unknown): string | null => {
    const n = contaMap[String(old)];
    return n && contasValidas.has(n) ? n : null;
  };

  try {
    const out = { tipos: 0, ativos: 0, posicoes: 0, operacoes: 0, dividendos: 0, historico: 0, alocacoes: 0, questionarios: 0, avaliacoes: 0 };

    // ── 1) Tipos de dividendo (por nome) ──
    const tiposIn = arr(body.tipos_dividendo);
    const { data: tiposEx } = await c.from("inv_tipos_dividendo").select("id, nome");
    const tipoPorNome = new Map<string, string>();
    for (const t of tiposEx ?? []) tipoPorNome.set(String(t.nome).toLowerCase(), String(t.id));
    const tipoMap: Record<string, string> = {};
    for (const t of tiposIn) {
      const nome = String(t.nome ?? "").trim();
      if (!nome) continue;
      let id = tipoPorNome.get(nome.toLowerCase());
      if (!id) {
        const catId = t.categoria_id ? (categoriaMap[String(t.categoria_id)] ?? null) : null;
        const { data } = await c.from("inv_tipos_dividendo").insert({ user_id: userId, nome: nome.slice(0, 40), categoria_id: catId }).select("id").single();
        if (data) { id = String(data.id); tipoPorNome.set(nome.toLowerCase(), id); out.tipos++; }
      }
      if (id && t.id) tipoMap[String(t.id)] = id;
    }

    // ── 2) Ativos (por ticker) ──
    const ativosIn = arr(body.ativos);
    const { data: ativosEx } = await c.from("inv_ativos").select("id, ticker");
    const ativoPorTicker = new Map<string, string>();
    for (const a of ativosEx ?? []) ativoPorTicker.set(up(a.ticker), String(a.id));
    const novosAtivos: Record<string, unknown>[] = [];
    for (const a of ativosIn) {
      const ticker = up(a.ticker);
      if (!ticker || ativoPorTicker.has(ticker)) continue;
      if (!TIPOS_ATIVO.includes(String(a.tipo_ativo))) continue;
      novosAtivos.push({
        user_id: userId, ticker, nome: String(a.nome ?? ticker).slice(0, 120), tipo_ativo: a.tipo_ativo,
        moeda: a.moeda ? up(a.moeda).slice(0, 3) : "BRL", descricao: a.descricao ?? null,
        nota_usuario: a.nota_usuario ?? null, questionario_respostas: a.questionario_respostas ?? null,
        rf_subtipo: a.rf_subtipo ?? null, rf_indexador: a.rf_indexador ?? null, rf_taxa: a.rf_taxa ?? null,
        rf_indice: a.rf_indice ?? null, rf_percentual_indice: a.rf_percentual_indice ?? null,
        rf_taxa_fixa: a.rf_taxa_fixa ?? null,
        rf_emissor: a.rf_emissor ?? null, rf_vencimento: a.rf_vencimento ?? null,
        cripto_rendimento_aa: a.cripto_rendimento_aa ?? null,
        cripto_rendimento_inicio: a.cripto_rendimento_inicio ?? null,
        cripto_rendimento_periodicidade: a.cripto_rendimento_periodicidade ?? null,
        rf_garantia_fgc: a.rf_garantia_fgc ?? null, rf_isento_ir: a.rf_isento_ir ?? null,
        fii_categoria: a.fii_categoria ?? null, acoes_subtipo: a.acoes_subtipo ?? null,
        cotacao_automatica: a.cotacao_automatica ?? true,
        logo_url: a.logo_url ?? null, setor: a.setor ?? null,
      });
    }
    if (novosAtivos.length) {
      const cr = await inserirEmLote(c, "inv_ativos", novosAtivos, "id, ticker");
      out.ativos = cr.length;
      for (const x of cr) ativoPorTicker.set(up(x.ticker), String(x.id));
    }
    const ativoMap: Record<string, string> = {};
    for (const a of ativosIn) { const nid = ativoPorTicker.get(up(a.ticker)); if (nid && a.id) ativoMap[String(a.id)] = nid; }

    // ── 3) Posições (dedup por ativo+conta+data+qtd+custo) ──
    const posIn = arr(body.posicoes);
    const { data: posEx } = await c.from("inv_posicoes").select("id, ativo_id, conta_id, data_compra, quantidade, preco_custo");
    const posKey = (av: string, ct: string, dt: unknown, q: unknown, p: unknown) => `${av}|${ct}|${dt}|${Number(q)}|${Number(p)}`;
    const posPorChave = new Map<string, string>();
    for (const p of posEx ?? []) posPorChave.set(posKey(String(p.ativo_id), String(p.conta_id), String(p.data_compra), p.quantidade, p.preco_custo), String(p.id));
    const posMap: Record<string, string> = {};
    const posInserir: Record<string, unknown>[] = [];
    const posRef: { oldId: string; key: string }[] = [];
    for (const p of posIn) {
      const ativoId = ativoMap[String(p.ativo_id)];
      const contaId = novaConta(p.conta_id);
      if (!ativoId || !contaId) { avisos.push("Posição ignorada: ativo/conta não restaurados."); continue; }
      const k = posKey(ativoId, contaId, String(p.data_compra), p.quantidade, p.preco_custo);
      const existId = posPorChave.get(k);
      if (existId) { if (p.id) posMap[String(p.id)] = existId; continue; }
      posInserir.push({
        user_id: userId, ativo_id: ativoId, conta_id: contaId,
        quantidade: Number(p.quantidade) || 0, preco_custo: Number(p.preco_custo) || 0,
        data_compra: String(p.data_compra), status: p.status === "ENCERRADA" ? "ENCERRADA" : "ATIVA",
      });
      posRef.push({ oldId: String(p.id ?? ""), key: k });
    }
    if (posInserir.length) {
      const cr = await inserirEmLote(c, "inv_posicoes", posInserir, "id, ativo_id, conta_id, data_compra, quantidade, preco_custo");
      out.posicoes = cr.length;
      const novaPorChave = new Map<string, string>();
      for (const x of cr) novaPorChave.set(posKey(String(x.ativo_id), String(x.conta_id), String(x.data_compra), x.quantidade, x.preco_custo), String(x.id));
      for (const r of posRef) { const nid = novaPorChave.get(r.key); if (nid) { posPorChave.set(r.key, nid); if (r.oldId) posMap[r.oldId] = nid; } }
    }

    // ── 4) Operações (dedup por posição+tipo+data+qtd+valor) ──
    const opIn = arr(body.operacoes);
    const posIds = [...new Set(Object.values(posMap))];
    const opKey = (pos: string, tp: string, dt: string, q: unknown, v: unknown) => `${pos}|${tp}|${dt}|${Number(q)}|${Number(v)}`;
    const opExistSet = new Set<string>();
    for (let i = 0; i < posIds.length; i += 200) {
      const { data } = await c.from("inv_operacoes").select("posicao_id, tipo_operacao, data_operacao, quantidade, valor_total").in("posicao_id", posIds.slice(i, i + 200));
      for (const o of data ?? []) opExistSet.add(opKey(String(o.posicao_id), String(o.tipo_operacao), String(o.data_operacao), o.quantidade, o.valor_total));
    }
    const opInserir: Record<string, unknown>[] = [];
    for (const o of opIn) {
      const posId = posMap[String(o.posicao_id)];
      const contaId = novaConta(o.conta_id);
      if (!posId || !contaId || !TIPOS_OPERACAO.includes(String(o.tipo_operacao))) continue;
      const k = opKey(posId, String(o.tipo_operacao), String(o.data_operacao), o.quantidade, o.valor_total);
      if (opExistSet.has(k)) continue;
      opExistSet.add(k);
      opInserir.push({
        user_id: userId, posicao_id: posId, tipo_operacao: o.tipo_operacao, conta_id: contaId,
        quantidade: Number(o.quantidade) || 0, preco_unitario: Number(o.preco_unitario) || 0,
        valor_total: Number(o.valor_total) || 0, data_operacao: String(o.data_operacao),
      });
    }
    if (opInserir.length) out.operacoes = (await inserirEmLote(c, "inv_operacoes", opInserir)).length;

    // ── 5) Dividendos (dedup por ativo+data+valor+tipo_ativo) ──
    const divIn = arr(body.dividendos);
    const { data: divEx } = await c.from("inv_dividendos").select("ativo_id, data_pagamento, valor, tipo_ativo");
    const divKey = (av: string, dt: string, v: unknown, ta: string) => `${av}|${dt}|${Number(v)}|${ta}`;
    const divExistSet = new Set<string>();
    for (const d of divEx ?? []) divExistSet.add(divKey(String(d.ativo_id), String(d.data_pagamento), d.valor, String(d.tipo_ativo)));
    const divInserir: Record<string, unknown>[] = [];
    for (const d of divIn) {
      const ativoId = ativoMap[String(d.ativo_id)];
      const contaId = novaConta(d.conta_id);
      const valor = Number(d.valor);
      if (!ativoId || !contaId || !(valor > 0) || !TIPOS_ATIVO.includes(String(d.tipo_ativo))) continue;
      const k = divKey(ativoId, String(d.data_pagamento), valor, String(d.tipo_ativo));
      if (divExistSet.has(k)) continue;
      divExistSet.add(k);
      divInserir.push({
        user_id: userId, ativo_id: ativoId, conta_id: contaId, valor, data_pagamento: String(d.data_pagamento),
        tipo_ativo: d.tipo_ativo, descricao: d.descricao ?? null,
        tipo_dividendo_id: d.tipo_dividendo_id ? (tipoMap[String(d.tipo_dividendo_id)] ?? null) : null,
        valor_por_cota: d.valor_por_cota != null ? Number(d.valor_por_cota) : null,
        // O lançamento do extrato é restaurado em separado (não relinkamos).
      });
    }
    if (divInserir.length) out.dividendos = (await inserirEmLote(c, "inv_dividendos", divInserir, "id")).length;

    // ── 6) Histórico mensal (upsert por ativo+conta+mês) ──
    const histIn = arr(body.historico);
    const histInserir: Record<string, unknown>[] = [];
    const histVistos = new Set<string>();
    for (const h of histIn) {
      const ativoId = ativoMap[String(h.ativo_id)];
      const contaId = novaConta(h.conta_id);
      const mes = String(h.mes_ano ?? "");
      if (!ativoId || !contaId || !RE_MES_ANO.test(mes)) continue;
      const k = `${ativoId}|${contaId}|${mes}`;
      if (histVistos.has(k)) continue;
      histVistos.add(k);
      histInserir.push({
        user_id: userId, ativo_id: ativoId, conta_id: contaId, mes_ano: mes,
        valor_mercado: Number(h.valor_mercado) || 0, quantidade: Number(h.quantidade) || 0,
        preco_medio: Number(h.preco_medio) || 0,
        variacao_percentual: Number(h.variacao_percentual) || 0, rentabilidade_mes: Number(h.rentabilidade_mes) || 0,
      });
    }
    if (histInserir.length) {
      const { error } = await c.from("inv_historico_mensal").upsert(histInserir, { onConflict: "ativo_id,conta_id,mes_ano" });
      if (error) avisos.push(`Histórico: ${error.message}`); else out.historico = histInserir.length;
    }

    // ── 7) Alocações ideais (upsert por tipo) ──
    const alocIn = arr(body.alocacoes).filter((a) => TIPOS_ATIVO.includes(String(a.tipo_ativo)));
    if (alocIn.length) {
      const linhas = alocIn.map((a) => ({ user_id: userId, tipo_ativo: a.tipo_ativo, percentual_ideal: Number(a.percentual_ideal) || 0, updated_at: new Date().toISOString() }));
      const { error } = await c.from("inv_alocacoes_tipo").upsert(linhas, { onConflict: "user_id,tipo_ativo" });
      if (error) avisos.push(`Alocações: ${error.message}`); else out.alocacoes = linhas.length;
    }

    // ── 8) Questionários de avaliação custom (upsert por tipo) ──
    const questIn = arr(body.questionarios).filter((q) =>
      TIPOS_ATIVO.includes(String(q.tipo_ativo)) && !validarQuestionario(q.perguntas, q.pesos));
    if (questIn.length) {
      const linhas = questIn.map((q) => ({
        user_id:     userId,
        tipo_ativo:  q.tipo_ativo,
        perguntas:   q.perguntas,
        pesos:       q.pesos,
        origem:      q.origem === "IA" ? "IA" : "MANUAL",
        ia_provedor: q.origem === "IA" ? (q.ia_provedor ?? null) : null,
        ia_modelo:   q.origem === "IA" ? (q.ia_modelo ?? null) : null,
        ia_gerou_em: q.origem === "IA" ? (q.ia_gerou_em ?? new Date().toISOString()) : null,
        updated_at:  new Date().toISOString(),
      }));
      const { error } = await c.from("inv_questionarios").upsert(linhas, { onConflict: "user_id,tipo_ativo" });
      if (error) avisos.push(`Questionários: ${error.message}`); else out.questionarios = linhas.length;
    }

    // ── 9) Avaliações dos mentores (upsert por ativo, remapeia ativo_id) ──
    const avalIn = arr(body.avaliacoes);
    const avalLinhas: Record<string, unknown>[] = [];
    for (const a of avalIn) {
      const ativoId = ativoMap[String(a.ativo_id)];
      if (!ativoId || !a.consenso || typeof a.consenso !== "object") continue;
      avalLinhas.push({
        user_id:    userId,
        ativo_id:   ativoId,
        nota_final: a.nota_final ?? null,
        consenso:   a.consenso,
        historico:  Array.isArray(a.historico) ? a.historico : null,
        gerado_em:  a.gerado_em ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    if (avalLinhas.length) {
      const { error } = await c.from("inv_avaliacoes").upsert(avalLinhas, { onConflict: "user_id,ativo_id" });
      if (error) avisos.push(`Avaliações: ${error.message}`); else out.avaliacoes = avalLinhas.length;
    }

    logSuccess("Investimentos restaurados", out);
    return json({ dados: { ...out, avisos } }, 201);
  } catch (e) {
    logError("Restaurar investimentos", e);
    return erro(`Falha ao restaurar investimentos: ${(e as Error).message}`);
  }
}

// ============================================================
// /investimentos/dashboard — consolidação por tipo de ativo
// Agrega em JS (volume pequeno por usuário). Valor de mercado usa
// o snapshot mensal mais recente por ativo+conta; se não houver,
// cai para o valor de custo.
// ============================================================

// Mapa "ativo|conta" → valor_mercado, a partir das linhas da view
// vw_inv_ultimo_mercado (já 1 por par). Compartilhado por dashboard e ranking.
