// supabase/functions/investimentos/snapshot.ts
// Snapshot mensal de patrimônio (histórico), auto/cron/backfill, e a rota
// de histórico-mensal — extraído de index.ts.
import { json, erro, db, dbAdmin, extrairId, buscarTodasLinhas, autenticarCron, mesCorrenteBR } from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import {
  Db, RE_MES_ANO, CDI_FALLBACK, IPCA_FALLBACK, hojeISO, deslocarDias, mesesEntre,
  ativoExiste, contaExiste,
} from "./shared.ts";
import {
  conversorCustoBRL, resolverPrecosAtuais, sgsUltimo, ptaxAtual, PosicaoCusto,
  garantirSincronizado, carregarIndicesMensais, garantirTesouroMesCorrente,
  carregarTesouroMtM, valorRFPosicoes, sincronizarTesouro, ptaxPorMesMap,
  fimSerieRF, resolverHistoricoCotado, resolverHistoricoCripto, gravarCacheDiario,
  INDICES_DATA_CORTE, TESOURO_DATA_CORTE,
  baixarCupomTesouro, datasCupomParaAtivo, tesouroSemestral, type CupomTesouro, type FaixaRF,
} from "./mercado.ts";
import { fecharPosicoesVencidas } from "./posicoes.ts";

export interface SnapshotMes {
  id?: string;
  mes_ano: string;
  valor_mercado: number;
  quantidade: number;
}

export function calcularDesempenho(
  valorMercado: number, quantidade: number, precoMedio: number, prev: SnapshotMes | null,
): { variacao_percentual: number; rentabilidade_mes: number } {
  if (!prev || prev.valor_mercado <= 0) return { variacao_percentual: 0, rentabilidade_mes: 0 };
  const fluxo  = (quantidade - prev.quantidade) * precoMedio;
  const rentab = valorMercado - prev.valor_mercado - fluxo;
  return {
    variacao_percentual: Number(((rentab / prev.valor_mercado) * 100).toFixed(4)),
    rentabilidade_mes:   Number(rentab.toFixed(2)),
  };
}

export async function snapshotVizinho(
  c: Db, ativoId: string, contaId: string, mesAno: string, direcao: "anterior" | "seguinte",
): Promise<(SnapshotMes & { id: string; preco_medio: number }) | null> {
  let q = c.from("inv_historico_mensal")
    .select("id, mes_ano, valor_mercado, quantidade, preco_medio")
    .eq("ativo_id", ativoId).eq("conta_id", contaId);
  q = direcao === "anterior"
    ? q.lt("mes_ano", mesAno).order("mes_ano", { ascending: false })
    : q.gt("mes_ano", mesAno).order("mes_ano", { ascending: true });
  const { data } = await q.limit(1).maybeSingle();
  return data as (SnapshotMes & { id: string; preco_medio: number }) | null;
}

// Após upsert/delete, o snapshot do mês seguinte (se houver) fica com a
// variação desatualizada — recalcula contra o novo "mês anterior" dele.
export async function recalcularSeguinte(c: Db, ativoId: string, contaId: string, mesAno: string) {
  const seguinte = await snapshotVizinho(c, ativoId, contaId, mesAno, "seguinte");
  if (!seguinte) return;
  const prevDoSeguinte = await snapshotVizinho(c, ativoId, contaId, seguinte.mes_ano, "anterior");
  const desempenho = calcularDesempenho(
    Number(seguinte.valor_mercado), Number(seguinte.quantidade), Number(seguinte.preco_medio), prevDoSeguinte,
  );
  await c.from("inv_historico_mensal").update(desempenho).eq("id", seguinte.id);
}

export async function rotaHistorico(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "historico-mensal");

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/historico-mensal", { params: Object.fromEntries(params) });
    const ativoId = params.get("ativo_id");
    const contaId = params.get("conta_id");
    const mesAno  = params.get("mes_ano");
    const de      = params.get("de");
    const ate     = params.get("ate");
    const montar = (dePag: number, atePag: number) => {
      let q = c.from("inv_historico_mensal")
        .select("*, inv_ativos(ticker, nome, tipo_ativo)")
        .order("mes_ano", { ascending: false })
        .range(dePag, atePag);
      if (ativoId) q = q.eq("ativo_id", ativoId);
      if (contaId) q = q.eq("conta_id", contaId);
      if (mesAno && RE_MES_ANO.test(mesAno)) q = q.eq("mes_ano", mesAno);
      if (de  && RE_MES_ANO.test(de))  q = q.gte("mes_ano", de);
      if (ate && RE_MES_ANO.test(ate)) q = q.lte("mes_ano", ate);
      return q;
    };
    const { data, error } = await buscarTodasLinhas(montar);
    if (error) { logError("Listar historico", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/historico-mensal", body);

    if (!body.ativo_id || !body.conta_id || !body.mes_ano || body.valor_mercado == null) {
      return erro("Campos obrigatórios: ativo_id, conta_id, mes_ano, valor_mercado");
    }
    const mesAno = String(body.mes_ano);
    if (!RE_MES_ANO.test(mesAno)) return erro("mes_ano deve estar no formato YYYY-MM");
    const valorMercado = Number(body.valor_mercado);
    if (!Number.isFinite(valorMercado) || valorMercado < 0) return erro("valor_mercado deve ser >= 0");
    if (!(await ativoExiste(c, body.ativo_id))) return erro("Ativo não encontrado", 404);
    if (!(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);

    // quantidade/preco_medio omitidos → derivados das posições ATIVAS do ativo+conta
    let quantidade = body.quantidade != null ? Number(body.quantidade) : null;
    let precoMedio = body.preco_medio != null ? Number(body.preco_medio) : null;
    if (quantidade == null || precoMedio == null) {
      const { data: pos } = await c.from("inv_posicoes")
        .select("quantidade, valor_custo, data_compra, inv_ativos(moeda)")
        .eq("ativo_id", body.ativo_id).eq("conta_id", body.conta_id).eq("status", "ATIVA");
      // Custo em BRL (PTAX da data da compra) — mesma conversão do dashboard,
      // senão o preço médio derivado fica na moeda do ativo (ex.: USD).
      const custoBRL = await conversorCustoBRL(c, (pos ?? []) as PosicaoCusto[]);
      const qtdTotal   = (pos ?? []).reduce((s, p) => s + Number(p.quantidade), 0);
      const custoTotal = (pos ?? []).reduce((s, p) => s + custoBRL(p as PosicaoCusto), 0);
      if (quantidade == null) quantidade = qtdTotal;
      if (precoMedio == null) precoMedio = qtdTotal > 0 ? custoTotal / qtdTotal : 0;
    }
    if (!Number.isFinite(quantidade) || quantidade < 0) return erro("quantidade deve ser >= 0");
    if (!Number.isFinite(precoMedio) || precoMedio < 0) return erro("preco_medio deve ser >= 0");

    const prev = await snapshotVizinho(c, String(body.ativo_id), String(body.conta_id), mesAno, "anterior");
    const desempenho = calcularDesempenho(valorMercado, quantidade, precoMedio, prev);

    const { data, error } = await c.from("inv_historico_mensal").upsert({
      user_id:       userId,
      ativo_id:      body.ativo_id,
      conta_id:      body.conta_id,
      mes_ano:       mesAno,
      valor_mercado: valorMercado,
      quantidade,
      preco_medio:   precoMedio,
      ...desempenho,
    }, { onConflict: "ativo_id,conta_id,mes_ano" }).select().single();
    if (error) { logError("Upsert historico", error); return erro(error.message); }

    await recalcularSeguinte(c, String(body.ativo_id), String(body.conta_id), mesAno);
    logSuccess("Histórico mensal registrado", { id: data.id, mes_ano: mesAno });
    return json({ dados: data }, 201);
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/historico-mensal/${id}`);
    const { data: snap } = await c.from("inv_historico_mensal")
      .select("id, ativo_id, conta_id, mes_ano").eq("id", id).maybeSingle();
    if (!snap) return erro("Registro não encontrado", 404);

    const { error } = await c.from("inv_historico_mensal").delete().eq("id", id);
    if (error) { logError("Excluir historico", error); return erro(error.message); }

    await recalcularSeguinte(c, String(snap.ativo_id), String(snap.conta_id), String(snap.mes_ano));
    return json({ mensagem: "Registro excluído com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

// ============================================================
// /investimentos/snapshot-auto — captura automática do valor de
// mercado do MÊS CORRENTE (botão "Atualizar valores do mês" e
// captura ao abrir a página). Para cada posição ATIVA:
//   • cotados (ações/FII/ETF/BDR)    → preço atual da brapi
//   • CRIPTOMOEDAS                   → preço atual da brapi (BRL)
//   • STOCKS / ETF internacional USD → preço brapi × PTAX
//   • Renda Fixa / Tesouro           → acúmulo pelo indexador/taxa
// Faz upsert do snapshot do mês (reusa a lógica de histórico-mensal)
// e devolve um resumo do que foi atualizado e do que foi ignorado.
//
// Observação: usa cotação ATUAL, então o snapshot reflete o preço do
// momento em que roda (ideal: fim do mês). O backfill de meses passados
// (séries históricas) é tratado por rota separada.
// ============================================================

export async function gravarSnapshot(
  c: Db, userId: string, ativoId: string, contaId: string, mesAno: string, valorMercado: number,
  qtdOverride?: number, precoMedioOverride?: number,
) {
  let qtdTotal: number, precoMedio: number;
  if (qtdOverride != null && precoMedioOverride != null) {
    // Backfill: quantidade/preço-médio do mês informado (≠ posição atual)
    qtdTotal = qtdOverride; precoMedio = precoMedioOverride;
  } else {
    const { data: pos } = await c.from("inv_posicoes")
      .select("quantidade, valor_custo, data_compra, inv_ativos(moeda)")
      .eq("ativo_id", ativoId).eq("conta_id", contaId).eq("status", "ATIVA");
    // Custo em BRL (PTAX da data da compra) — mesma conversão do dashboard.
    const custoBRL = await conversorCustoBRL(c, (pos ?? []) as PosicaoCusto[]);
    qtdTotal   = (pos ?? []).reduce((s, p) => s + Number(p.quantidade), 0);
    const custoTotal = (pos ?? []).reduce((s, p) => s + custoBRL(p as PosicaoCusto), 0);
    precoMedio = qtdTotal > 0 ? custoTotal / qtdTotal : 0;
  }
  const prev = await snapshotVizinho(c, ativoId, contaId, mesAno, "anterior");
  const desempenho = calcularDesempenho(valorMercado, qtdTotal, precoMedio, prev);
  const { error } = await c.from("inv_historico_mensal").upsert({
    user_id: userId, ativo_id: ativoId, conta_id: contaId, mes_ano: mesAno,
    valor_mercado: Number(valorMercado.toFixed(2)), quantidade: qtdTotal, preco_medio: precoMedio, ...desempenho,
  }, { onConflict: "ativo_id,conta_id,mes_ano" });
  if (error) throw error;
  await recalcularSeguinte(c, ativoId, contaId, mesAno);
}

export interface GrupoPosicao {
  ativoId: string; contaId: string; ticker: string; nome: string; tipo: string; moeda: string;
  indexador: string | null; taxa: string | null; vencimento: string | null;
  faixa: FaixaRF | null;
  posicoes: { quantidade: number; valor_custo: number; data_compra: string }[];
}

// Taxa escalonada (rf_limite_faixa/rf_percentual_indice_2) do registro cru de
// inv_ativos vindo do join — null quando o ativo não usa faixa (caso comum).
function faixaDoAtivo(a: Record<string, unknown>): FaixaRF | null {
  const limite = a.rf_limite_faixa != null ? Number(a.rf_limite_faixa) : null;
  const pct2   = a.rf_percentual_indice_2 != null ? Number(a.rf_percentual_indice_2) : null;
  return limite != null && pct2 != null ? { limite, percentual2: pct2 } : null;
}

// Núcleo da captura do mês: agrupa posições ATIVAS do usuário, resolve os
// preços (cache compartilhado) e grava o snapshot do mês. Serve tanto ao
// client do usuário (RLS) quanto ao client admin do cron — por isso filtra
// user_id explicitamente e passa qtd/preço-médio na hora de gravar.
export async function executarSnapshotMes(
  client: Db, userId: string, mesAno: string, contaId?: string | null,
): Promise<{ atualizados: number; ignorados: { ticker: string; motivo: string }[] }> {
  const mesCorrente = mesCorrenteBR();
  const [ano, mes] = mesAno.split("-").map(Number);
  const dataRef = mesAno === mesCorrente ? new Date() : new Date(Date.UTC(ano, mes, 0, 12));

  let q = client.from("inv_posicoes")
    .select("ativo_id, conta_id, quantidade, valor_custo, data_compra, inv_ativos(ticker, nome, tipo_ativo, moeda, rf_indexador, rf_taxa, rf_vencimento, rf_limite_faixa, rf_percentual_indice_2, cotacao_automatica)")
    .eq("status", "ATIVA").eq("user_id", userId);
  if (contaId) q = q.eq("conta_id", contaId);
  const { data: posicoes, error } = await q;
  if (error) { logError("snapshot posicoes", error); throw new Error(error.message); }

  // Custo em BRL (PTAX da data da compra) — mesma conversão do dashboard.
  // valor_custo de ativo em moeda estrangeira vem cru (USD); sem isso o
  // preço médio do snapshot fica em USD enquanto o valor_mercado é BRL,
  // inflando artificialmente o ganho de capital do ativo.
  const custoBRL = await conversorCustoBRL(client, (posicoes ?? []) as PosicaoCusto[]);

  // Agrupa por (ativo, conta)
  const grupos = new Map<string, GrupoPosicao>();
  for (const p of posicoes ?? []) {
    const raw = (p as { inv_ativos?: Record<string, unknown> | Record<string, unknown>[] }).inv_ativos;
    const a   = (Array.isArray(raw) ? raw[0] : raw) ?? {};
    if (a.cotacao_automatica === false) continue; // ativo opta por não buscar cotação
    const key = `${p.ativo_id}|${p.conta_id}`;
    if (!grupos.has(key)) {
      grupos.set(key, {
        ativoId: String(p.ativo_id), contaId: String(p.conta_id),
        ticker: String(a.ticker ?? "").toUpperCase(), nome: String(a.nome ?? ""), tipo: String(a.tipo_ativo ?? ""),
        moeda: String(a.moeda ?? "BRL").toUpperCase(),
        indexador: (a.rf_indexador as string | null) ?? null, taxa: (a.rf_taxa as string | null) ?? null,
        vencimento: (a.rf_vencimento as string | null) ?? null,
        faixa: faixaDoAtivo(a),
        posicoes: [],
      });
    }
    grupos.get(key)!.posicoes.push({
      quantidade: Number(p.quantidade) || 0, valor_custo: custoBRL(p as PosicaoCusto),
      data_compra: String(p.data_compra),
    });
  }

  const ehCripto = (t: string) => t === "CRIPTOMOEDAS";
  const ehRF     = (t: string) => t === "RENDA_FIXA" || t === "TESOURO_DIRETO";
  const ehCotado = (t: string) => !ehCripto(t) && !ehRF(t);
  const lista = [...grupos.values()];
  const tickersCotados = [...new Set(lista.filter((g) => ehCotado(g.tipo)).map((g) => g.ticker).filter(Boolean))];
  const tickersCripto  = [...new Set(lista.filter((g) => ehCripto(g.tipo)).map((g) => g.ticker).filter(Boolean))];

  const { precos, cripto: precosCr } = await resolverPrecosAtuais(
    client, mesAno, mesAno === mesCorrente, tickersCotados, tickersCripto,
  );
  // Aproveita a MESMA cotação já resolvida acima pra alimentar o cache
  // DIÁRIO (arqvalor.cotacoes_ativos_diarias), usado só pelo filtro "Semana"
  // do ranking de destaques — só no mês corrente (é "o preço de hoje"; uma
  // execução de backfill de mês passado não deve gravar sob a data de hoje).
  // Idempotente (upsert por ticker+data) mesmo rodando 1x por usuário no cron.
  if (mesAno === mesCorrente) {
    const hoje = hojeISO();
    const diarias: { ticker: string; data: string; preco: number; moeda: string }[] = [];
    for (const [tk, v] of precos)   diarias.push({ ticker: tk, data: hoje, preco: v.preco, moeda: v.moeda });
    for (const [tk, p] of precosCr) diarias.push({ ticker: tk, data: hoje, preco: p, moeda: "BRL" });
    if (diarias.length > 0) await gravarCacheDiario(diarias);
  }
  // a moeda real (USD) só é conhecida após a cotação, então carrega PTAX se
  // houver qualquer cotado (não dá pra confiar só na moeda cadastrada)
  const temCotado = lista.some((g) => ehCotado(g.tipo));
  if (temCotado) { try { await garantirSincronizado(client); } catch (e) { logError("snapshot ptax sync", e); } }
  const ptax = temCotado ? await ptaxAtual(client) : 0;
  const temRF = lista.some((g) => ehRF(g.tipo));
  const cdi  = temRF ? await sgsUltimo(432, CDI_FALLBACK) : CDI_FALLBACK;
  const ipca = temRF ? await sgsUltimo(13522, IPCA_FALLBACK) : IPCA_FALLBACK;
  const { cdi: cdiSerie, ipca: ipcaSerie } = temRF
    ? await carregarIndicesMensais(client, INDICES_DATA_CORTE)
    : { cdi: new Map<string, number>(), ipca: new Map<string, number>() };
  // Marcação a mercado do Tesouro (prefixado/IPCA+). No mês corrente, busca o
  // PU de resgate atual no feed da B3 (demand-driven + cache), como nas ações.
  const vencsTesouro = lista.filter((g) => g.tipo === "TESOURO_DIRETO").map((g) => g.vencimento ?? "");
  if (mesAno === mesCorrente) await garantirTesouroMesCorrente(client, vencsTesouro, mesCorrente);
  const mtmTesouro = await carregarTesouroMtM(client, vencsTesouro);
  // Cupons semestrais pagos — só usados no fallback de valorRFPosicoes
  // (quando não há PU de marcação a mercado pro título); a marcação a
  // mercado, quando disponível, já reflete o preço pós-cupom sozinha.
  // Best-effort: fonte externa fora do ar não derruba o snapshot inteiro.
  const cupons: CupomTesouro[] = vencsTesouro.length > 0
    ? await baixarCupomTesouro().catch((e) => { logError("snapshot cupom tesouro", e); return []; })
    : [];

  let atualizados = 0;
  const ignorados: { ticker: string; motivo: string }[] = [];

  for (const g of lista) {
    const qtd   = g.posicoes.reduce((s, p) => s + p.quantidade, 0);
    const custo = g.posicoes.reduce((s, p) => s + p.valor_custo, 0);
    const precoMedio = qtd > 0 ? custo / qtd : 0;
    let valor: number | null = null;

    if (ehCripto(g.tipo)) {
      const preco = precosCr.get(g.ticker);
      if (preco == null) { ignorados.push({ ticker: g.ticker, motivo: "cotação de cripto indisponível" }); continue; }
      valor = preco * qtd;
    } else if (ehRF(g.tipo)) {
      // Título já vencido em mês anterior não gera snapshot novo.
      if (g.vencimento && g.vencimento.slice(0, 7) < mesAno) {
        ignorados.push({ ticker: g.ticker, motivo: "título vencido" }); continue;
      }
      const menorCompra = g.posicoes.reduce((min, p) => p.data_compra < min ? p.data_compra : min, g.posicoes[0]?.data_compra ?? mesAno);
      const datasResetCupom = g.tipo === "TESOURO_DIRETO"
        ? datasCupomParaAtivo(cupons, g.indexador, tesouroSemestral(g.nome), g.vencimento, menorCompra, dataRef.toISOString().slice(0, 10))
        : undefined;
      valor = valorRFPosicoes(g.posicoes, g.tipo, g.indexador, g.vencimento, g.nome, mesAno, dataRef, g.taxa, cdiSerie, ipcaSerie, cdi, ipca, mtmTesouro, datasResetCupom, g.faixa);
    } else {
      const cot = precos.get(g.ticker);
      if (cot == null) { ignorados.push({ ticker: g.ticker, motivo: "cotação indisponível" }); continue; }
      let preco = cot.preco;
      if (cot.moeda !== "BRL") {
        if (ptax <= 0) { ignorados.push({ ticker: g.ticker, motivo: "PTAX indisponível p/ conversão" }); continue; }
        preco *= ptax;
      }
      valor = preco * qtd;
    }

    try {
      await gravarSnapshot(client, userId, g.ativoId, g.contaId, mesAno, valor ?? 0, qtd, precoMedio);
      atualizados++;
    } catch (e) {
      logError("snapshot gravar", e);
      ignorados.push({ ticker: g.ticker, motivo: "falha ao gravar snapshot" });
    }
  }
  return { atualizados, ignorados };
}

export async function rotaSnapshotAuto(c: Db, req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const body = await req.json().catch(() => ({})) as { mes_ano?: string; conta_id?: string };
  const mesCorrente = mesCorrenteBR();
  const mesAno = body.mes_ano && RE_MES_ANO.test(body.mes_ano) ? body.mes_ano : mesCorrente;
  logRequest("POST", "/investimentos/snapshot-auto", { mesAno, conta_id: body.conta_id ?? null });
  try {
    await fecharPosicoesVencidas(c, userId);
    const { atualizados, ignorados } = await executarSnapshotMes(c, userId, mesAno, body.conta_id ?? null);
    logSuccess("Snapshot automático", { mesAno, atualizados, ignorados: ignorados.length });
    return json({ dados: { mes_ano: mesAno, atualizados, ignorados } });
  } catch (e) {
    logError("snapshot-auto", e);
    return erro((e as Error).message ?? "Erro ao atualizar valores");
  }
}

// ============================================================
// /investimentos/snapshot-cron — JOB DIÁRIO do servidor. Roda a captura
// do mês corrente para TODOS os usuários com posições ativas, via
// service_role. NÃO usa JWT de usuário: é protegido pelo secret no header
// `x-cron-secret` (= secret CRON_SECRET). Agende com pg_cron + pg_net
// (ver migration 20260613000002). Reusa o cache compartilhado de cotações,
// então cada ticker é buscado uma vez só, não por usuário.
// ============================================================
export async function rotaSnapshotCron(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const naoAutorizado = autenticarCron(req);
  if (naoAutorizado) return naoAutorizado;

  const admin = dbAdmin();
  const mesAno = mesCorrenteBR();
  logRequest("POST", "/investimentos/snapshot-cron", { mesAno });

  const { data: users, error } = await admin.from("inv_posicoes").select("user_id").eq("status", "ATIVA");
  if (error) { logError("snapshot-cron users", error); return erro(error.message); }
  const uids = [...new Set((users ?? []).map((u) => String(u.user_id)))];

  let usuariosOk = 0, totalAtualizados = 0;
  for (const uid of uids) {
    try {
      await fecharPosicoesVencidas(admin, uid);
      const { atualizados } = await executarSnapshotMes(admin, uid, mesAno, null);
      totalAtualizados += atualizados; usuariosOk++;
    } catch (e) { logError("snapshot-cron usuario", e); }
  }
  logSuccess("Snapshot cron", { mesAno, usuarios: uids.length, usuariosOk, totalAtualizados });
  return json({ dados: { mes_ano: mesAno, usuarios: uids.length, usuarios_ok: usuariosOk, atualizados: totalAtualizados } });
}

// ============================================================
// /investimentos/dividendos-cron — JOB diário: provisiona proventos
// FUTUROS de ativos em USD a partir da Polygon.io, para TODOS os
// usuários. Sem JWT — protegido pelo secret no header x-cron-secret
// (= CRON_SECRET). Agende com pg_cron + pg_net (migration 20260615000004).
//
// Regras (definidas com o usuário):
//   • 1 requisição Polygon por ticker, respeitando o limite real de 5
//     req/min do plano free (12,5s entre chamadas, ver
//     aguardarRateLimitPolygon/POLYGON_MIN_INTERVALO_MS — job de manhã).
//   • Só proventos futuros (pay_date >= hoje) → lançados como PROJECAO
//     ("provisionado"). Vários do mesmo tipo no MESMO pay_date são somados
//     e lançados 1x.
//   • Valor por POSIÇÃO ATIVA: cash_amount × quantidade na conta × PTAX
//     (venda). Como o pagamento é futuro e ainda não há PTAX da data, usa
//     a última PTAX disponível — corrigida quando a data chega.
//   • Reconciliação: se já existe uma PROJECAO do mesmo ativo+conta+tipo
//     no MESMO mês, corrige valor e data (não duplica).
//   • Tipo de provento: usa o inv_tipos_dividendo "Dividendos" do usuário.
//     Sem categoria mapeada → pula o usuário/ativo (não lança sem extrato).
// ============================================================
export async function rotaSnapshotBackfill(c: Db, req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const body = await req.json().catch(() => ({})) as { conta_id?: string; ate?: string; ativo_id?: string };
  const mesCorrente = mesCorrenteBR();
  // Backfill cobre só meses PASSADOS — para no mês anterior. O mês corrente é
  // tarefa do "Atualizar cotação"/job diário (cotação ao vivo), e o fechamento
  // mensal da fonte (Yahoo) só sai quando o mês termina.
  const [yc, mc] = mesCorrente.split("-").map(Number);
  const dPrev = new Date(Date.UTC(yc, mc - 2, 1));
  const mesAnterior = `${dPrev.getUTCFullYear()}-${String(dPrev.getUTCMonth() + 1).padStart(2, "0")}`;
  const mesFim = body.ate && RE_MES_ANO.test(body.ate) ? body.ate : mesAnterior;
  logRequest("POST", "/investimentos/snapshot-backfill", { conta_id: body.conta_id ?? null, ativo_id: body.ativo_id ?? null, ate: mesFim });

  let q = c.from("inv_posicoes")
    .select("ativo_id, conta_id, quantidade, valor_custo, data_compra, inv_ativos(ticker, nome, tipo_ativo, moeda, rf_indexador, rf_taxa, rf_vencimento, rf_limite_faixa, rf_percentual_indice_2, cotacao_automatica)")
    .eq("status", "ATIVA");
  if (body.conta_id) q = q.eq("conta_id", body.conta_id);
  if (body.ativo_id) q = q.eq("ativo_id", body.ativo_id);
  const { data: posicoes, error } = await q;
  if (error) { logError("backfill posicoes", error); return erro(error.message); }

  // Custo em BRL (PTAX da data da compra) — mesma conversão do dashboard e
  // do snapshot do mês corrente; senão o preço médio fica em USD enquanto
  // o valor_mercado do backfill é BRL, inflando o ganho de capital do ativo.
  const custoBRL = await conversorCustoBRL(c, (posicoes ?? []) as PosicaoCusto[]);

  const grupos = new Map<string, GrupoPosicao & { inicio: string }>();
  for (const p of posicoes ?? []) {
    const raw = (p as { inv_ativos?: Record<string, unknown> | Record<string, unknown>[] }).inv_ativos;
    const a   = (Array.isArray(raw) ? raw[0] : raw) ?? {};
    if (a.cotacao_automatica === false) continue; // ativo opta por não buscar cotação
    const key = `${p.ativo_id}|${p.conta_id}`;
    const mesCompra = String(p.data_compra).slice(0, 7);
    if (!grupos.has(key)) {
      grupos.set(key, {
        ativoId: String(p.ativo_id), contaId: String(p.conta_id),
        ticker: String(a.ticker ?? "").toUpperCase(), nome: String(a.nome ?? ""), tipo: String(a.tipo_ativo ?? ""),
        moeda: String(a.moeda ?? "BRL").toUpperCase(),
        indexador: (a.rf_indexador as string | null) ?? null, taxa: (a.rf_taxa as string | null) ?? null,
        vencimento: (a.rf_vencimento as string | null) ?? null,
        faixa: faixaDoAtivo(a),
        posicoes: [], inicio: mesCompra,
      });
    }
    const g = grupos.get(key)!;
    g.posicoes.push({
      quantidade: Number(p.quantidade) || 0, valor_custo: custoBRL(p as PosicaoCusto),
      data_compra: String(p.data_compra),
    });
    if (mesCompra < g.inicio) g.inicio = mesCompra;
  }

  const ehCripto = (t: string) => t === "CRIPTOMOEDAS";
  const ehRF     = (t: string) => t === "RENDA_FIXA" || t === "TESOURO_DIRETO";
  const ehCotado = (t: string) => !ehCripto(t) && !ehRF(t);
  const lista = [...grupos.values()];

  const temRF = lista.some((g) => ehRF(g.tipo));
  const cdi  = temRF ? await sgsUltimo(432, CDI_FALLBACK) : CDI_FALLBACK;
  const ipca = temRF ? await sgsUltimo(13522, IPCA_FALLBACK) : IPCA_FALLBACK;
  const { cdi: cdiSerie, ipca: ipcaSerie } = temRF
    ? await carregarIndicesMensais(c, INDICES_DATA_CORTE)
    : { cdi: new Map<string, number>(), ipca: new Map<string, number>() };
  // Marcação a mercado do Tesouro (prefixado/IPCA+). O histórico por título só
  // existe no CSV do STN — baixado UMA vez (lazy) quando ainda não há cache;
  // depois é reusado. Mês corrente vem do feed da B3 (garantido no snapshot).
  const vencsTesouro = [...new Set(lista.filter((g) => g.tipo === "TESOURO_DIRETO").map((g) => g.vencimento ?? "").filter(Boolean))];
  if (vencsTesouro.length) {
    const { count } = await c.from("cotacoes_tesouro")
      .select("*", { count: "exact", head: true }).in("vencimento", vencsTesouro);
    if (!count) { try { await sincronizarTesouro(TESOURO_DATA_CORTE); } catch (e) { logError("backfill tesouro CSV", e); } }
  }
  const mtmTesouro = await carregarTesouroMtM(c, vencsTesouro);
  // Cupons semestrais — mesmo raciocínio de executarSnapshotMes: só usado no
  // fallback de valorRFPosicoes quando não há PU de marcação a mercado.
  const cupons: CupomTesouro[] = vencsTesouro.length > 0
    ? await baixarCupomTesouro().catch((e) => { logError("backfill cupom tesouro", e); return []; })
    : [];

  // sempre carrega PTAX se houver cotado — a moeda real (USD) só é descoberta
  // ao buscar a série, então não dá pra confiar só na moeda cadastrada.
  // Garante a PTAX sincronizada (backfill desde 2021) p/ converter USD.
  const temCotado   = lista.some((g) => ehCotado(g.tipo));
  if (temCotado) { try { await garantirSincronizado(c); } catch (e) { logError("backfill ptax sync", e); } }
  const inicioGeral = lista.reduce((min, g) => (g.inicio < min ? g.inicio : min), mesFim);
  const ptaxPorMes  = temCotado ? await ptaxPorMesMap(c, `${inicioGeral}-01`) : new Map<string, number>();
  // Convenção PTAX: se o mês exato não tem cotação, usa a do último mês
  // disponível ANTES dele (último dia útil ≤ alvo). Resolve o mês mais
  // recente, que ainda não entrou na série, sem deixar buraco.
  const ptaxMesesOrd = [...ptaxPorMes.keys()].sort();
  const ptaxNoMes = (me: string): number | undefined => {
    const exato = ptaxPorMes.get(me);
    if (exato) return exato;
    let val: number | undefined;
    for (const k of ptaxMesesOrd) { if (k <= me) val = ptaxPorMes.get(k); else break; }
    return val;
  };

  let mesesGravados = 0;
  let ativosProcessados = 0;
  const ignorados: { ticker: string; motivo: string }[] = [];
  const diagnostico: Record<string, unknown>[] = [];

  for (const g of lista) {
    // meses já gravados — só reprocessa se a base (quantidade/preço médio)
    // mudou desde então. Isso cobre o lançamento retroativo: uma compra/venda
    // com data passada altera a quantidade de meses já snapshotados, que
    // antes ficavam presos no valor antigo (só meses NOVOS eram varridos).
    const { data: existentes } = await c.from("inv_historico_mensal")
      .select("mes_ano, quantidade, preco_medio").eq("ativo_id", g.ativoId).eq("conta_id", g.contaId);
    const baseExistente = new Map(
      (existentes ?? []).map((e) => [String(e.mes_ano), { qtd: Number(e.quantidade) || 0, preco: Number(e.preco_medio) || 0 }]),
    );
    // RF não gera histórico depois do vencimento.
    const fimGrupo = ehRF(g.tipo) ? fimSerieRF(g.vencimento, mesFim) : mesFim;
    const EPS = 1e-6;
    const candidatos = mesesEntre(g.inicio, fimGrupo).map((me) => {
      const posMes = g.posicoes.filter((p) => p.data_compra.slice(0, 7) <= me);
      const qtdMes = posMes.reduce((s, p) => s + p.quantidade, 0);
      const precoMedio = qtdMes > 0 ? posMes.reduce((s, p) => s + p.valor_custo, 0) / qtdMes : 0;
      return { me, posMes, qtdMes, precoMedio };
    }).filter((x) => x.qtdMes > 0);
    const faltantes = candidatos.filter((x) => {
      const base = baseExistente.get(x.me);
      return !base || Math.abs(base.qtd - x.qtdMes) > EPS || Math.abs(base.preco - x.precoMedio) > EPS;
    });
    if (faltantes.length === 0) continue;

    // série de preços por mês (cotados/cripto) + moeda real detectada
    let precoPorMes: Map<string, number> | null = null;
    let moedaReal = g.moeda;
    if (ehCotado(g.tipo)) {
      const r = await resolverHistoricoCotado(c, g.ticker, g.moeda, g.inicio);
      precoPorMes = r.precos; moedaReal = r.moeda || g.moeda;
      if (precoPorMes.size === 0) {
        ignorados.push({ ticker: g.ticker, motivo: "histórico de cotação indisponível" });
        diagnostico.push({ ticker: g.ticker, inicio: g.inicio, faltantes: faltantes.length, fonte: 0, motivo: "fonte sem série (Yahoo/brapi não retornaram)" });
        continue;
      }
    } else if (ehCripto(g.tipo)) {
      precoPorMes = await resolverHistoricoCripto(c, g.ticker, g.inicio);
      moedaReal = "BRL";
      if (precoPorMes.size === 0) { ignorados.push({ ticker: g.ticker, motivo: "histórico de cripto indisponível" }); continue; }
    }

    let gravouAlgum = false;
    let gravadosAtivo = 0, semCotacaoMes = 0, semPtax = 0;

    for (const { me, posMes, qtdMes, precoMedio } of faltantes) {
      const dataRef = new Date(Date.UTC(Number(me.slice(0, 4)), Number(me.slice(5, 7)), 0, 12)); // último dia do mês

      let valor: number;
      if (ehRF(g.tipo)) {
        const menorCompra = posMes.reduce((min, p) => p.data_compra < min ? p.data_compra : min, posMes[0]?.data_compra ?? me);
        const datasResetCupom = g.tipo === "TESOURO_DIRETO"
          ? datasCupomParaAtivo(cupons, g.indexador, tesouroSemestral(g.nome), g.vencimento, menorCompra, dataRef.toISOString().slice(0, 10))
          : undefined;
        valor = valorRFPosicoes(posMes, g.tipo, g.indexador, g.vencimento, g.nome, me, dataRef, g.taxa, cdiSerie, ipcaSerie, cdi, ipca, mtmTesouro, datasResetCupom, g.faixa);
      } else {
        let preco = precoPorMes!.get(me);
        if (preco == null) { semCotacaoMes++; continue; } // sem cotação naquele mês
        if (ehCotado(g.tipo) && moedaReal !== "BRL") {
          const px = ptaxNoMes(me);
          if (!px) { semPtax++; continue; } // sem PTAX (mês anterior ao início da série)
          preco *= px;
        }
        valor = preco * qtdMes;
      }
      if (!(valor > 0)) continue;

      try {
        await gravarSnapshot(c, userId, g.ativoId, g.contaId, me, valor, qtdMes, precoMedio);
        mesesGravados++; gravadosAtivo++; gravouAlgum = true;
      } catch (e) { logError("backfill gravar", e); }
    }
    if (gravouAlgum) ativosProcessados++;
    // diagnóstico: só os cotados/cripto que NÃO preencheram tudo
    if (!ehRF(g.tipo) && gravadosAtivo < faltantes.length) {
      diagnostico.push({
        ticker: g.ticker, moeda: moedaReal, inicio: g.inicio,
        faltantes: faltantes.length, fonte_meses: precoPorMes?.size ?? 0,
        gravados: gravadosAtivo, sem_cotacao_mes: semCotacaoMes, sem_ptax: semPtax,
        ptax_meses: ptaxPorMes.size,
      });
    }
  }

  logSuccess("Backfill de histórico", { ate: mesFim, mesesGravados, ativosProcessados, ignorados: ignorados.length, diagnostico });
  return json({ dados: { ate: mesFim, meses_gravados: mesesGravados, ativos_processados: ativosProcessados, ignorados, diagnostico } });
}

// ============================================================
// /investimentos/importar — importação em lote (extrato + posição B3)
//
// O frontend faz o parsing dos dois arquivos da B3 e envia UM payload
// já resolvido (instituições já viram conta_id; tipos já escolhidos).
// O servidor insere em ordem de dependência (ativo → posição → operação
// → dividendo → histórico) usando inserts em lote, com dedup/upsert para
// ser idempotente (re-importar não duplica).
//
// Princípio: a POSIÇÃO é a fonte da verdade da quantidade atual e do
// valor de mercado; o EXTRATO fornece o custo (média das compras), o
// histórico de operações e os proventos.
// ============================================================

