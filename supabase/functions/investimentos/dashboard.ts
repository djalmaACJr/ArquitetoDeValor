// supabase/functions/investimentos/dashboard.ts
// /investimentos/dashboard e /investimentos/ranking — extraído de index.ts.
import { json, erro } from "../_shared/utils.ts";
import { logError, logRequest } from "../_shared/logger.ts";
import { Db, hojeISO } from "./shared.ts";
import {
  conversorCustoBRL, resolverPrecosAtuais, ptaxAtual, PosicaoCusto,
} from "./mercado.ts";

export function mapaUltimoMercado(
  rows: { ativo_id: string; conta_id: string; valor_mercado: number }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of rows) m.set(`${h.ativo_id}|${h.conta_id}`, Number(h.valor_mercado));
  return m;
}

// ------------------------------------------------------------
// Yield on Cost no padrão investidor10
//
// O investidor10 NÃO usa o que você recebeu: usa a distribuição POR COTA do
// fundo nos últimos 12 meses, projetada sobre a sua quantidade atual:
//   YoC = (Σ dividendo_por_cota_12m) × qtd_atual / custo_atual
// Como quem acumula cotas ao longo do ano recebe menos que essa projeção, o
// "recebido / custo" subestima o YoC frente ao investidor10.
//
// O app guarda o valor TOTAL recebido em cada provento, então recuperamos o
// dividendo por cota dividindo pelo nº de cotas que você tinha NA DATA do
// pagamento — reconstruído das operações (mesma lógica de recomputarPosicao):
// COMPRA/APORTE somam; VENDA/RESGATE subtraem. Guardamos um checkpoint por
// data por posição.
// ------------------------------------------------------------

export type OperacaoQtd = {
  posicao_id: string; tipo_operacao: string; quantidade: number; data_operacao: string;
};
export type CheckpointQtd = { data: string; qtd: number };

// Reconstrói a quantidade de cada posição ao longo do tempo.
// `ops` deve vir ordenado por (data_operacao, created_at) ascendente.
export function checkpointsQtdPorPosicao(ops: OperacaoQtd[]): Map<string, CheckpointQtd[]> {
  const porPos = new Map<string, OperacaoQtd[]>();
  for (const o of ops) {
    const lista = porPos.get(o.posicao_id) ?? [];
    lista.push(o);
    porPos.set(o.posicao_id, lista);
  }

  const out = new Map<string, CheckpointQtd[]>();
  for (const [pid, lista] of porPos) {
    let qtd = 0;
    const chk: CheckpointQtd[] = [];
    for (const o of lista) {
      const q = Number(o.quantidade) || 0;
      const tipo = String(o.tipo_operacao);
      if (tipo === "COMPRA" || tipo === "APORTE") qtd += q;
      else if (tipo === "VENDA" || tipo === "RESGATE") { qtd -= Math.min(q, qtd); if (qtd < 0) qtd = 0; }
      // DIVIDENDO não altera a posição. Colapsa checkpoints do mesmo dia.
      const data = String(o.data_operacao);
      const ultimo = chk[chk.length - 1];
      if (ultimo && ultimo.data === data) ultimo.qtd = qtd;
      else chk.push({ data, qtd });
    }
    out.set(pid, chk);
  }
  return out;
}

// Quantidade da posição numa data: último checkpoint com data <= alvo.
export function qtdNaData(chk: CheckpointQtd[] | undefined, alvo: string): number {
  if (!chk?.length) return 0;
  let val = 0;
  for (const c of chk) {
    if (c.data <= alvo) val = c.qtd;
    else break;
  }
  return val;
}

export async function dashboard(c: Db, params: URLSearchParams) {
  logRequest("GET", "/investimentos/dashboard", { params: Object.fromEntries(params) });
  const contaFiltro = params.get("conta_id");
  // agrupar=conta: total de mercado por CONTA (todas de uma vez), usado pelo
  // resumo "por instituição" do dashboard — antes, o frontend chamava este
  // endpoint uma vez POR CONTA só para ler total_mercado (N requisições HTTP
  // + 4N queries no Postgres, achado de auditoria). Ignora conta_id (não faz
  // sentido combinar os dois filtros).
  const agruparConta = params.get("agrupar") === "conta";

  const [posRes, alocRes, histRes, divRes] = await Promise.all([
    (() => {
      let q = c.from("inv_posicoes")
        .select("id, ativo_id, conta_id, quantidade, valor_custo, data_compra, status, inv_ativos(tipo_ativo, moeda)")
        .eq("status", "ATIVA");
      if (contaFiltro) q = q.eq("conta_id", contaFiltro);
      return q;
    })(),
    c.from("inv_alocacoes_tipo").select("tipo_ativo, percentual_ideal"),
    c.from("vw_inv_ultimo_mercado").select("ativo_id, conta_id, valor_mercado"),
    // tipo_ativo vem do ativo (join), não da cópia desnormalizada — assim a
    // reclassificação de um ativo reflete na hora no gráfico de proventos.
    // Respeita o mesmo filtro de conta das posições — senão o card filtrado
    // por conta mostraria os dividendos de TODAS as contas.
    (() => {
      let q = c.from("inv_dividendos").select("valor, inv_ativos(tipo_ativo)");
      if (contaFiltro) q = q.eq("conta_id", contaFiltro);
      return q;
    })(),
  ]);

  if (posRes.error)  { logError("Dashboard posicoes", posRes.error);  return erro(posRes.error.message); }
  if (alocRes.error) { logError("Dashboard alocacoes", alocRes.error); return erro(alocRes.error.message); }
  if (histRes.error) { logError("Dashboard historico", histRes.error); return erro(histRes.error.message); }
  if (divRes.error)  { logError("Dashboard dividendos", divRes.error); return erro(divRes.error.message); }

  // Último valor_mercado por ativo+conta (view já entrega 1 linha por par)
  const ultimoMercado = mapaUltimoMercado(histRes.data ?? []);

  // Acumula por tipo
  type Agg = { tipo_ativo: string; valor_custo: number; valor_mercado: number; dividendos: number };
  const porTipo = new Map<string, Agg>();
  const garante = (tipo: string): Agg => {
    if (!porTipo.has(tipo)) porTipo.set(tipo, { tipo_ativo: tipo, valor_custo: 0, valor_mercado: 0, dividendos: 0 });
    return porTipo.get(tipo)!;
  };

  // Custo de ativos em moeda estrangeira → BRL (PTAX da data da compra)
  const custoBRL = await conversorCustoBRL(c, (posRes.data ?? []) as PosicaoCusto[]);

  // Agrupa posições por ativo+conta antes de aplicar o snapshot — o
  // snapshot mensal cobre TODAS as posições do par; somar por posição
  // contaria o mesmo valor de mercado mais de uma vez.
  const porAtivoConta = new Map<string, { tipo: string; custo: number }>();
  for (const p of posRes.data ?? []) {
    const tipo = (p.inv_ativos as { tipo_ativo?: string } | null)?.tipo_ativo;
    if (!tipo) continue;
    const k = `${p.ativo_id}|${p.conta_id}`;
    const atual = porAtivoConta.get(k) ?? { tipo, custo: 0 };
    atual.custo += custoBRL(p);
    porAtivoConta.set(k, atual);
  }
  if (agruparConta) {
    const porConta = new Map<string, { valor_custo: number; valor_mercado: number }>();
    for (const [k, ac] of porAtivoConta) {
      const contaId = k.split("|")[1];
      const agg = porConta.get(contaId) ?? { valor_custo: 0, valor_mercado: 0 };
      agg.valor_custo   += ac.custo;
      agg.valor_mercado += ultimoMercado.get(k) ?? ac.custo;
      porConta.set(contaId, agg);
    }
    const totaisPorConta = [...porConta.entries()].map(([conta_id, v]) => ({
      conta_id,
      valor_custo:   Number(v.valor_custo.toFixed(2)),
      total_mercado: Number(v.valor_mercado.toFixed(2)),
    }));
    return json({ dados: { totais_por_conta: totaisPorConta } });
  }

  for (const [k, ac] of porAtivoConta) {
    const agg = garante(ac.tipo);
    agg.valor_custo   += ac.custo;
    agg.valor_mercado += ultimoMercado.get(k) ?? ac.custo;
  }

  for (const d of divRes.data ?? []) {
    const tipo = (d.inv_ativos as { tipo_ativo?: string } | null)?.tipo_ativo;
    if (!tipo) continue;
    garante(String(tipo)).dividendos += Number(d.valor) || 0;
  }

  const alocMap = new Map<string, number>();
  for (const a of alocRes.data ?? []) alocMap.set(String(a.tipo_ativo), Number(a.percentual_ideal) || 0);

  const totalMercado = [...porTipo.values()].reduce((s, a) => s + a.valor_mercado, 0);

  const tipos = [...porTipo.values()].map((a) => {
    const percentualAtual = totalMercado > 0 ? (a.valor_mercado / totalMercado) * 100 : 0;
    const percentualIdeal = alocMap.get(a.tipo_ativo) ?? 0;
    return {
      tipo_ativo:        a.tipo_ativo,
      valor_custo:       Number(a.valor_custo.toFixed(2)),
      valor_mercado:     Number(a.valor_mercado.toFixed(2)),
      ganho_perda:       Number((a.valor_mercado - a.valor_custo).toFixed(2)),
      rentabilidade_pct: a.valor_custo > 0 ? Number((((a.valor_mercado - a.valor_custo) / a.valor_custo) * 100).toFixed(2)) : 0,
      dividendos:        Number(a.dividendos.toFixed(2)),
      percentual_atual:  Number(percentualAtual.toFixed(2)),
      percentual_ideal:  percentualIdeal,
      desvio_pct:        Number((percentualAtual - percentualIdeal).toFixed(2)),
    };
  }).sort((x, y) => y.valor_mercado - x.valor_mercado);

  const totalCusto = tipos.reduce((s, t) => s + t.valor_custo, 0);
  const totalDiv   = tipos.reduce((s, t) => s + t.dividendos, 0);

  return json({
    dados: {
      total_custo:    Number(totalCusto.toFixed(2)),
      total_mercado:  Number(totalMercado.toFixed(2)),
      ganho_perda:    Number((totalMercado - totalCusto).toFixed(2)),
      total_dividendos: Number(totalDiv.toFixed(2)),
      tipos,
    },
  });
}

// ============================================================
// /investimentos/ranking — métricas por ATIVO para classificação
// de performance: em alta / em prejuízo, dividend yield (12 meses)
// e participação na carteira. Devolve a lista completa ordenada
// por rentabilidade; o frontend fatia os destaques.
// ============================================================

export async function ranking(c: Db, params: URLSearchParams) {
  logRequest("GET", "/investimentos/ranking", { params: Object.fromEntries(params) });
  const contaFiltro = params.get("conta_id");
  const tipoFiltro  = params.get("tipo_ativo");

  const corte12m = new Date();
  corte12m.setMonth(corte12m.getMonth() - 12);
  const corteISO = corte12m.toISOString().split("T")[0];
  const hojeRanking = hojeISO();

  const [posRes, histRes, divRes, opsRes, fundoRes] = await Promise.all([
    (() => {
      let q = c.from("inv_posicoes")
        .select("id, ativo_id, conta_id, quantidade, valor_custo, data_compra, inv_ativos(ticker, nome, tipo_ativo, nota_usuario, moeda)")
        .eq("status", "ATIVA");
      if (contaFiltro) q = q.eq("conta_id", contaFiltro);
      return q;
    })(),
    c.from("vw_inv_ultimo_mercado").select("ativo_id, conta_id, valor_mercado"),
    // Janela trailing 12m ATÉ hoje: exclui projeções futuras (PROJECAO/PENDENTE
    // a vencer) do DY/YoC — só conta provento já realizado. Filtro de conta
    // acompanha o das posições: sem ele, dividendos_12m/dy_real somariam
    // proventos de outras contas e a estimativa de rate (valor ÷ qtd na data)
    // dividiria valor de todas as contas pela quantidade de uma só.
    (() => {
      let q = c.from("inv_dividendos").select("ativo_id, valor, data_pagamento, valor_por_cota, tipo_dividendo_id")
        .gte("data_pagamento", corteISO).lte("data_pagamento", hojeRanking);
      if (contaFiltro) q = q.eq("conta_id", contaFiltro);
      return q;
    })(),
    // Operações de TODAS as posições do usuário (inclui ENCERRADAS): a
    // quantidade histórica precisa do ciclo completo para saber quantas cotas
    // havia na data de cada provento. Ordenado por (data, created_at) p/
    // replay determinístico.
    c.from("inv_operacoes")
      .select("posicao_id, tipo_operacao, quantidade, data_operacao")
      .order("data_operacao", { ascending: true })
      .order("created_at", { ascending: true }),
    // Cache do histórico do FUNDO (B3): distribuição por cota nos 12m
    // completos, independente de posse — base do DY/YoC projetado para
    // ativos comprados há menos de 1 ano.
    c.from("inv_proventos_fundo").select("ativo_id, data_pagamento, valor_por_cota")
      .gte("data_pagamento", corteISO).lte("data_pagamento", hojeRanking),
  ]);

  if (posRes.error)  { logError("Ranking posicoes", posRes.error);   return erro(posRes.error.message); }
  if (histRes.error) { logError("Ranking historico", histRes.error); return erro(histRes.error.message); }
  if (divRes.error)  { logError("Ranking dividendos", divRes.error); return erro(divRes.error.message); }
  if (opsRes.error)  { logError("Ranking operacoes", opsRes.error);  return erro(opsRes.error.message); }
  // Cache do fundo é best-effort: sem a migration aplicada (ou vazio),
  // o cálculo cai no Σ rate de inv_dividendos como antes.
  if (fundoRes.error) logError("Ranking proventos_fundo", fundoRes.error);
  const fundoRows = fundoRes.error ? [] : (fundoRes.data ?? []);

  // Último valor_mercado por ativo+conta (view já entrega 1 linha por par)
  const ultimoMercado = mapaUltimoMercado(histRes.data ?? []);

  type AggAtivo = {
    ativo_id: string; ticker: string; nome: string; tipo_ativo: string;
    valor_custo: number; valor_mercado: number; dividendos_12m: number;
    quantidade: number; nota_usuario: number | null;
  };
  const porAtivo = new Map<string, AggAtivo>();
  // ativo_id → posições (id) ATIVAS, para somar o custo histórico do ativo
  const posicoesPorAtivo = new Map<string, string[]>();
  // ativo_id → primeira data de posse (min data_compra/1ª operação). Se a
  // posse tem menos de 12m, o DY/YoC real (recebido) diverge do projetado
  // (ritmo do fundo) e o frontend exibe os dois.
  const primeiraPosse = new Map<string, string>();

  // Custo de ativos em moeda estrangeira → BRL (PTAX da data da compra)
  const custoBRL = await conversorCustoBRL(c, (posRes.data ?? []) as PosicaoCusto[]);

  // Custo agrupado por ativo+conta (snapshot cobre o par inteiro)
  const custoPorPar = new Map<string, { ativo: AggAtivo; custo: number }>();
  for (const p of posRes.data ?? []) {
    const meta = p.inv_ativos as { ticker?: string; nome?: string; tipo_ativo?: string; nota_usuario?: number | null } | null;
    if (!meta?.tipo_ativo) continue;
    if (tipoFiltro && meta.tipo_ativo !== tipoFiltro) continue;
    const aid = String(p.ativo_id);
    if (!porAtivo.has(aid)) {
      porAtivo.set(aid, {
        ativo_id: aid, ticker: meta.ticker ?? "", nome: meta.nome ?? "",
        tipo_ativo: meta.tipo_ativo, valor_custo: 0, valor_mercado: 0, dividendos_12m: 0,
        quantidade: 0, nota_usuario: meta.nota_usuario ?? null,
      });
    }
    porAtivo.get(aid)!.quantidade += Number(p.quantidade) || 0;
    const dc = String(p.data_compra ?? "").slice(0, 10);
    if (dc && (!primeiraPosse.has(aid) || dc < primeiraPosse.get(aid)!)) primeiraPosse.set(aid, dc);
    const pids = posicoesPorAtivo.get(aid) ?? [];
    pids.push(String(p.id));
    posicoesPorAtivo.set(aid, pids);
    const k = `${aid}|${p.conta_id}`;
    const par = custoPorPar.get(k) ?? { ativo: porAtivo.get(aid)!, custo: 0 };
    par.custo += custoBRL(p);
    custoPorPar.set(k, par);
  }
  for (const [k, par] of custoPorPar) {
    par.ativo.valor_custo   += par.custo;
    par.ativo.valor_mercado += ultimoMercado.get(k) ?? par.custo;
  }

  // Quantidade histórica por posição — usada só na ESTIMATIVA do rate quando
  // o provento não tem valor_por_cota gravado (ainda não passou no backfill).
  const checkpoints = checkpointsQtdPorPosicao(opsRes.data ?? []);
  for (const p of posRes.data ?? []) {
    const pid = String(p.id);
    if (!checkpoints.has(pid)) {
      checkpoints.set(pid, [{ data: String(p.data_compra), qtd: Number(p.quantidade) || 0 }]);
    }
  }

  // Refina a primeira posse com a data da 1ª operação de cada posição ativa
  for (const [aid, pids] of posicoesPorAtivo) {
    for (const pid of pids) {
      const d0 = checkpoints.get(pid)?.[0]?.data?.slice(0, 10);
      if (d0 && (!primeiraPosse.has(aid) || d0 < primeiraPosse.get(aid)!)) primeiraPosse.set(aid, d0);
    }
  }

  // Agrupa proventos por (ativo|data|tipo): o dividendo-por-cota (rate) é o
  // mesmo entre contas, então só conta UMA vez por pagamento. Soma o valor
  // recebido (todas as contas) p/ a estimativa e p/ dividendos_12m.
  type GrupoDiv = { ativo: string; data: string; rate: number | null; valorTotal: number };
  const grupos = new Map<string, GrupoDiv>();
  for (const d of divRes.data ?? []) {
    const aid = String(d.ativo_id);
    const agg = porAtivo.get(aid);
    if (!agg) continue;
    agg.dividendos_12m += Number(d.valor) || 0;
    const data = String(d.data_pagamento).slice(0, 10);
    const k = `${aid}|${data}|${d.tipo_dividendo_id ?? ""}`;
    const g = grupos.get(k) ?? { ativo: aid, data, rate: null, valorTotal: 0 };
    g.valorTotal += Number(d.valor) || 0;
    const vpc = d.valor_por_cota != null ? Number(d.valor_por_cota) : NaN;
    if (Number.isFinite(vpc) && vpc > 0) g.rate = vpc;
    grupos.set(k, g);
  }

  // ativo_id → (data_pagamento → Σ rate do dia), a partir de inv_dividendos.
  // Cobre com precisão o período de POSSE (o que o usuário recebeu).
  const divPorData = new Map<string, Map<string, number>>();
  for (const g of grupos.values()) {
    let rate = g.rate;
    if (rate == null) {
      // estimativa: valor recebido no dia ÷ cotas que havia na data
      const qtd = (posicoesPorAtivo.get(g.ativo) ?? []).reduce(
        (s, pid) => s + qtdNaData(checkpoints.get(pid), g.data), 0);
      rate = qtd > 0 ? g.valorTotal / qtd : 0;
    }
    if (rate > 0) {
      const porData = divPorData.get(g.ativo) ?? new Map<string, number>();
      porData.set(g.data, (porData.get(g.data) ?? 0) + rate);
      divPorData.set(g.ativo, porData);
    }
  }

  // Idem a partir do cache do FUNDO (B3) — inclui meses SEM posse.
  const cachePorData = new Map<string, Map<string, number>>();
  for (const f of fundoRows as { ativo_id: string; data_pagamento: string; valor_por_cota: number }[]) {
    const aid  = String(f.ativo_id);
    const data = String(f.data_pagamento).slice(0, 10);
    const rate = Number(f.valor_por_cota) || 0;
    if (rate <= 0) continue;
    const porData = cachePorData.get(aid) ?? new Map<string, number>();
    porData.set(data, (porData.get(data) ?? 0) + rate);
    cachePorData.set(aid, porData);
  }

  // Fusão POR DATA: o cache acrescenta os meses sem posse, e inv_dividendos
  // garante pagamentos que o supplement da B3 já não lista (ele corta os mais
  // antigos). Mesma data nas duas fontes = mesmo pagamento → usa o maior.
  const divPorCota = new Map<string, number>();
  for (const aid of new Set([...divPorData.keys(), ...cachePorData.keys()])) {
    const datas = new Set([
      ...(divPorData.get(aid)?.keys() ?? []),
      ...(cachePorData.get(aid)?.keys() ?? []),
    ]);
    // Agrupa por MÊS-calendário: a janela corrida de 12m pode capturar 13
    // meses (pagamento no início do mês corrente + o do mês do corte ainda
    // dentro da janela). O investidor10 conta 12 → descarta o(s) mais antigo(s).
    const porMes = new Map<string, number>();
    for (const dt of datas) {
      const r = Math.max(divPorData.get(aid)?.get(dt) ?? 0, cachePorData.get(aid)?.get(dt) ?? 0);
      if (r <= 0) continue;
      const mes = dt.slice(0, 7);
      porMes.set(mes, (porMes.get(mes) ?? 0) + r);
    }
    const meses = [...porMes.keys()].sort();
    while (meses.length > 12) meses.shift();
    const soma = meses.reduce((s, m) => s + porMes.get(m)!, 0);
    if (soma > 0) divPorCota.set(aid, soma);
  }

  const totalMercado = [...porAtivo.values()].reduce((s, a) => s + a.valor_mercado, 0);

  const ativos = [...porAtivo.values()].map((a) => {
    // Padrão investidor10: dividendo-por-cota 12m do FUNDO × qtd atual / preço.
    // (fusão inv_dividendos + cache B3 por data de pagamento)
    const rate12m = divPorCota.get(a.ativo_id) ?? 0;
    return {
      ativo_id:           a.ativo_id,
      ticker:             a.ticker,
      nome:               a.nome,
      tipo_ativo:         a.tipo_ativo,
      quantidade:         a.quantidade,
      nota_usuario:       a.nota_usuario,
      valor_custo:        Number(a.valor_custo.toFixed(2)),
      valor_mercado:      Number(a.valor_mercado.toFixed(2)),
      ganho_perda:        Number((a.valor_mercado - a.valor_custo).toFixed(2)),
      rentabilidade_pct:  a.valor_custo > 0 ? Number((((a.valor_mercado - a.valor_custo) / a.valor_custo) * 100).toFixed(2)) : 0,
      dividendos_12m:     Number(a.dividendos_12m.toFixed(2)),
      // (DY usa valor de mercado; YoC usa o custo.)
      dividend_yield_pct: a.valor_mercado > 0
        ? Number(((rate12m * a.quantidade / a.valor_mercado) * 100).toFixed(2))
        : 0,
      yield_on_cost_pct:  a.valor_custo > 0
        ? Number(((rate12m * a.quantidade / a.valor_custo) * 100).toFixed(2))
        : 0,
      // Visão REAL: o que efetivamente caiu na conta nos 12m ÷ mercado/custo.
      // Diverge do projetado quando a posse tem menos de 12 meses.
      dy_real_pct:        a.valor_mercado > 0 ? Number(((a.dividendos_12m / a.valor_mercado) * 100).toFixed(2)) : 0,
      yoc_real_pct:       a.valor_custo   > 0 ? Number(((a.dividendos_12m / a.valor_custo)   * 100).toFixed(2)) : 0,
      posse_12m:          (primeiraPosse.get(a.ativo_id) ?? hojeRanking) <= corteISO,
      participacao_pct:   totalMercado > 0 ? Number(((a.valor_mercado / totalMercado) * 100).toFixed(2)) : 0,
    };
  }).sort((x, y) => y.rentabilidade_pct - x.rentabilidade_pct);

  return json({ dados: { total_mercado: Number(totalMercado.toFixed(2)), ativos } });
}

// ============================================================
// /investimentos/busca-externa — autocomplete de ativos
//
// Fontes (proxy server-side: evita CORS e mantém token fora do client):
//   ACOES | ETF | FII | STOCKS  → brapi.dev /api/quote/list (B3 + BDRs)
//   CRIPTOMOEDAS                → brapi.dev /api/v2/crypto (preço em BRL)
//   TESOURO_DIRETO              → API pública do Tesouro Direto (B3)
//   RENDA_FIXA                  → sem fonte pública (CDB/LCI/LCA/CRI/CRA
//                                 são emissões privadas) → cadastro manual
//
// Token opcional da brapi via secret BRAPI_TOKEN (sem ele a brapi
// aplica rate-limit do plano gratuito).
// ============================================================

