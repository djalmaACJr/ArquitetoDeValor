// supabase/functions/investimentos/mercado.ts
// Cotações externas (brapi/Yahoo/CoinGecko/B3), PTAX, índices (CDI/IPCA),
// Tesouro Direto e cálculo de renda fixa — extraído de index.ts.
import { json, erro, db, dbAdmin, mesCorrenteBR } from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import {
  Db, CDI_FALLBACK, IPCA_FALLBACK, TIPOS_ATIVO,
  hojeISO, deslocarDias, recuarDias, maiorData, menorData, mesesEntre,
} from "./shared.ts";
// Import circular com snapshot.ts (mesma natureza do monólito original):
// rebuildHistoricoRF (aqui) precisa persistir via gravarSnapshot (lá), e
// executarSnapshotMes (lá) precisa de cotações/conversão (aqui). Ambos são
// só declarações de função — nunca avaliadas no top-level do módulo — então
// o ciclo é seguro em ESM (Deno resolve normalmente).
import { gravarSnapshot } from "./snapshot.ts";

// Cache em memória por dia: o snapshot-cron chama sgsUltimo(CDI)/sgsUltimo(IPCA)
// uma vez POR USUÁRIO com posição em renda fixa — sem cache, isso batia na
// API do BCB centenas de vezes por execução para buscar exatamente o mesmo
// valor do dia (achado de auditoria). O valor só muda 1x/dia (publicação do
// BCB), então cachear por (série, dia) elimina a redundância dentro do mesmo
// run do cron sem arriscar dado desatualizado entre execuções diárias.
const _sgsCache = new Map<number, { dia: string; valor: number }>();

export async function sgsUltimo(serie: number, fallback: number): Promise<number> {
  const hoje = hojeISO();
  const cached = _sgsCache.get(serie);
  if (cached && cached.dia === hoje) return cached.valor;
  try {
    const arr = await fetchJson(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`,
    ) as { valor?: string }[];
    const v = Number(arr?.[0]?.valor);
    const valor = Number.isFinite(v) && v > 0 ? v / 100 : fallback;
    _sgsCache.set(serie, { dia: hoje, valor });
    return valor;
  } catch { return fallback; }
}

// Primeira taxa percentual de um texto ("13,5% a.a." → 0.135)
export function primeiraTaxa(txt: string): number {
  const m = String(txt ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) / 100 : 0;
}

export const DIA_MS = 86_400_000;
// Valor acumulado de uma posição de renda fixa, do aporte até dataRef.
// `datasReset` (opcional, ISO YYYY-MM-DD): datas de cupom semestral pago
// dentro da janela — o juros-sobre-juros reinicia no cupom mais recente
// (o que já acumulou até ali saiu em dinheiro, não continua compondo). Usado
// só por Tesouro Prefixado "com Juros Semestrais"; todo outro chamador (CDB/
// LCI/LCA prefixado, sem cupom periódico) não passa nada e mantém o
// comportamento de sempre.
export function valorRF(
  custo: number, dataCompra: string, dataRef: Date, taxaAa: number, datasReset?: string[],
): number {
  let ini = new Date(`${String(dataCompra).slice(0, 10)}T12:00:00Z`).getTime();
  const fim = dataRef.getTime();
  if (datasReset) {
    for (const d of datasReset) {
      const t = new Date(`${d}T12:00:00Z`).getTime();
      if (Number.isFinite(t) && t > ini && t <= fim) ini = t;
    }
  }
  const dias = Math.max(0, (fim - ini) / DIA_MS);
  if (taxaAa <= 0 || dias === 0) return custo;
  return custo * Math.pow(1 + taxaAa, dias / 365);
}

// Tickers que mudaram de código (fusão, reorganização) → símbolo atual usado
// para BUSCAR a cotação. O ticker cadastrado/exibido continua o original.
// Adicione novos casos aqui conforme aparecerem.
export const ALIAS_TICKER: Record<string, string> = {
  BIDI11: "INBR32",  // Banco Inter → Inter & Co (BDR na B3)
  CPFF11: "CPTS11",  // FII Capitânia — migrou para CPTS11
};
// Símbolos a tentar para um ticker: ele e o alias (renomeado), cada um nas
// formas B3 (.SA) e pura (EUA). Tenta TODOS até achar série/cotação — assim
// um alias errado/desnecessário não quebra a busca do ticker original.
export function candidatosTicker(ticker: string): string[] {
  const orig = (ticker ?? "").toUpperCase();
  if (!orig) return [];
  const bases = ALIAS_TICKER[orig] ? [orig, ALIAS_TICKER[orig]] : [orig];
  const out: string[] = [];
  for (const b of bases) {
    for (const c of (/\d/.test(b) ? [`${b}.SA`, b] : [b, `${b}.SA`])) {
      if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}
export function basesTicker(ticker: string): string[] {
  const orig = (ticker ?? "").toUpperCase();
  return ALIAS_TICKER[orig] ? [orig, ALIAS_TICKER[orig]] : [orig];
}

// Cotação atual (brapi) p/ tickers da B3 / BDR / STOCKS → mapa ticker→{preco,moeda}
export async function precosBrapi(tickers: string[]): Promise<Map<string, { preco: number; moeda: string }>> {
  const out = new Map<string, { preco: number; moeda: string }>();
  if (tickers.length === 0) return out;
  try {
    const data = await fetchJson(
      brapiUrl(`quote/${encodeURIComponent(tickers.join(","))}?range=1d&interval=1d`),
    ) as { results?: { symbol?: string; regularMarketPrice?: number; currency?: string }[] };
    for (const r of data.results ?? []) {
      const sym = String(r.symbol ?? "").toUpperCase();
      if (sym && r.regularMarketPrice != null) {
        out.set(sym, { preco: Number(r.regularMarketPrice), moeda: String(r.currency ?? "BRL").toUpperCase() });
      }
    }
  } catch (e) { logError("brapi quote", e); }
  return out;
}

// Nome "oficial" de tickers da B3/BDR/STOCKS (brapi → longName/shortName)
export async function nomesBrapi(tickers: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (tickers.length === 0) return out;
  try {
    const data = await fetchJson(
      brapiUrl(`quote/${encodeURIComponent(tickers.join(","))}?range=1d&interval=1d`),
    ) as { results?: { symbol?: string; longName?: string; shortName?: string }[] };
    for (const r of data.results ?? []) {
      const sym  = String(r.symbol ?? "").toUpperCase();
      const nome = String(r.longName ?? r.shortName ?? "").trim();
      if (sym && nome) out.set(sym, nome.slice(0, 120));
    }
  } catch (e) { logError("brapi nomes", e); }
  return out;
}

// Nome de criptomoedas (CoinGecko → name)
export async function nomesCripto(tickers: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const meta = await metaCripto(tickers);
  for (const [sym, v] of meta) if (v.nome) out.set(sym, v.nome);
  return out;
}

// Resolve o nome oficial de uma lista de ativos pela fonte externa.
// Tesouro Direto e renda fixa privada não têm fonte → ficam de fora
// (mantém o que veio). Mapa: TICKER (upper) → nome.
export async function resolverNomes(itens: { ticker: string; tipo_ativo: string }[]): Promise<Map<string, string>> {
  const cripto: string[] = [];
  const cotados: string[] = [];
  for (const it of itens) {
    const tk = String(it.ticker).toUpperCase();
    if (!tk) continue;
    if (it.tipo_ativo === "CRIPTOMOEDAS") cripto.push(tk);
    else if (it.tipo_ativo !== "TESOURO_DIRETO") cotados.push(tk);
  }
  const out = new Map<string, string>();
  const [a, b] = await Promise.all([nomesBrapi(cotados), nomesCripto(cripto)]);
  for (const [k, v] of a) out.set(k, v);
  for (const [k, v] of b) out.set(k, v);
  return out;
}

// Resolve nome + moeda oficiais de uma lista de ativos (brapi quote já
// devolve longName/shortName + currency). Usado pela atualização em lote.
// Mapa: TICKER (upper) → { nome?, moeda? }.
//
// IMPORTANTE: o plano GRATUITO da brapi aceita só 1 ativo por requisição
// (erro QUOTES_PER_REQUEST_EXCEEDED com vírgula) → busca um ticker por vez,
// em pequenos lotes paralelos para respeitar o limite de taxa do plano.
export async function resolverMeta(
  itens: { ticker: string; tipo_ativo: string }[],
): Promise<Map<string, { nome?: string; moeda?: string; logo?: string; setor?: string }>> {
  const cripto: string[] = [];
  const cotados: string[] = [];
  for (const it of itens) {
    const tk = String(it.ticker).toUpperCase();
    if (!tk) continue;
    if (it.tipo_ativo === "CRIPTOMOEDAS") cripto.push(tk);
    else if (it.tipo_ativo !== "TESOURO_DIRETO") cotados.push(tk);
  }
  const out = new Map<string, { nome?: string; moeda?: string; logo?: string; setor?: string }>();

  // Setor vem só do endpoint quote/list (?search=) — o quote padrão não traz.
  async function setorDe(tk: string): Promise<string | undefined> {
    try {
      const data = await fetchJson(
        brapiUrl(`quote/list?search=${encodeURIComponent(tk)}`),
      ) as { stocks?: { stock?: string; sector?: string }[] };
      const m = (data.stocks ?? []).find((s) => String(s.stock).toUpperCase() === tk);
      const setor = String(m?.sector ?? "").trim();
      return setor ? setor.slice(0, 80) : undefined;
    } catch (e) { logError(`brapi setor ${tk}`, e); return undefined; }
  }

  async function umCotado(tk: string): Promise<void> {
    try {
      const [data, setor] = await Promise.all([
        fetchJson(
          brapiUrl(`quote/${encodeURIComponent(tk)}?range=1d&interval=1d`),
        ) as Promise<{ results?: { longName?: string; shortName?: string; currency?: string; logourl?: string }[] }>,
        setorDe(tk),
      ]);
      const r = data.results?.[0];
      if (!r && !setor) return;
      const nome  = String(r?.longName ?? r?.shortName ?? "").trim();
      const moeda = String(r?.currency ?? "").trim().toUpperCase();
      const logo  = String(r?.logourl ?? "").trim();
      out.set(tk, {
        nome: nome ? nome.slice(0, 120) : undefined,
        moeda: moeda || undefined,
        logo: logo && logo.startsWith("http") ? logo.slice(0, 300) : undefined,
        setor,
      });
    } catch (e) { logError(`brapi meta ${tk}`, e); }
  }

  const LOTE = 3;
  for (let i = 0; i < cotados.length; i += LOTE) {
    await Promise.all(cotados.slice(i, i + LOTE).map(umCotado));
  }
  // Cripto: nome + logo + moeda (BRL) numa única chamada à CoinGecko.
  const metaCr = await metaCripto(cripto);
  for (const [sym, v] of metaCr) out.set(sym, { nome: v.nome, moeda: "BRL", logo: v.logo });
  return out;
}

// Preço ATUAL de criptomoedas via CoinGecko (grátis, sem chave) — mesma fonte
// do histórico. A brapi /v2/crypto passou a exigir token (MISSING_TOKEN), o que
// deixava o preço atual de cripto congelado no cache.
export async function precosCripto(tickers: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tickers.length === 0) return out;
  // símbolo (UPPER) → id da CoinGecko
  const idPorSimbolo = new Map<string, string>();
  for (const tk of tickers) {
    const id = await coingeckoId(tk);
    if (id) idPorSimbolo.set(tk.toUpperCase(), id);
  }
  const ids = [...new Set(idPorSimbolo.values())];
  if (ids.length === 0) return out;
  try {
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=brl`,
    ) as Record<string, { brl?: number }>;
    for (const [sym, id] of idPorSimbolo) {
      const px = data[id]?.brl;
      if (px != null) out.set(sym, Number(px));
    }
  } catch (e) { logError("coingecko preço atual", e); }
  return out;
}

// Metadados de criptomoedas via CoinGecko /coins/markets (nome, logo e preço
// em BRL numa única chamada). Mapa: símbolo (UPPER) → { nome, logo, preco }.
export async function metaCripto(tickers: string[]): Promise<Map<string, { nome?: string; logo?: string; preco?: number }>> {
  const out = new Map<string, { nome?: string; logo?: string; preco?: number }>();
  if (tickers.length === 0) return out;
  const idPorSimbolo = new Map<string, string>();
  for (const tk of tickers) { const id = await coingeckoId(tk); if (id) idPorSimbolo.set(tk.toUpperCase(), id); }
  const ids = [...new Set(idPorSimbolo.values())];
  if (ids.length === 0) return out;
  try {
    const arr = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=brl&ids=${encodeURIComponent(ids.join(","))}`,
    ) as { id?: string; name?: string; image?: string; current_price?: number }[];
    const porId = new Map<string, { nome?: string; logo?: string; preco?: number }>();
    for (const m of arr ?? []) {
      if (!m.id) continue;
      const logo = String(m.image ?? "");
      porId.set(m.id, {
        nome:  m.name ? String(m.name).slice(0, 120) : undefined,
        logo:  logo.startsWith("http") ? logo.split("?")[0].slice(0, 300) : undefined,
        preco: m.current_price != null ? Number(m.current_price) : undefined,
      });
    }
    for (const [sym, id] of idPorSimbolo) { const v = porId.get(id); if (v) out.set(sym, v); }
  } catch (e) { logError("coingecko markets", e); }
  return out;
}

// Última PTAX (venda) — converte ativos em moeda estrangeira para BRL
export async function ptaxAtual(c: Db): Promise<number> {
  const { data } = await c.from("cotacoes_ptax")
    .select("cotacao_venda").order("data", { ascending: false }).limit(1).maybeSingle();
  const v = Number((data as { cotacao_venda?: number } | null)?.cotacao_venda);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// ── Conversor de custo → BRL (posições de ativos em moeda estrangeira) ───────
// inv_posicoes.valor_custo fica na MOEDA DO ATIVO (ex.: USD), mas os snapshots
// de valor_mercado são gravados EM BRL (cotação × PTAX) — comparar os dois sem
// converter o custo infla a rentabilidade (US$ tratado como R$). Converte pela
// PTAX (venda) da DATA DA COMPRA (mesma convenção da página de detalhe do
// ativo), com fallback na PTAX mais recente; sem PTAX na tabela, devolve o
// valor cru (comportamento antigo, degradação visível mas não silenciosa nos
// logs do snapshot, que também depende da PTAX).
export type PosicaoCusto = { valor_custo?: unknown; data_compra?: unknown; inv_ativos?: unknown };
export async function conversorCustoBRL(c: Db, posicoes: PosicaoCusto[]): Promise<(p: PosicaoCusto) => number> {
  const moedaDe = (p: PosicaoCusto) =>
    String((p.inv_ativos as { moeda?: string } | null)?.moeda ?? "BRL").toUpperCase();
  const datas = [...new Set(
    posicoes.filter((p) => moedaDe(p) !== "BRL")
      .map((p) => String(p.data_compra ?? "").slice(0, 10))
      .filter((d) => RE_DATA.test(d)),
  )].sort();

  const porData = new Map<string, number>();
  let atual = 0;
  if (datas.length > 0) {
    // Uma query só: da compra mais antiga (−15 dias p/ cobrir fds/feriado) até
    // hoje; cada data resolve para a última cotação <= data (como na rotaPtax).
    const { data } = await c.from("cotacoes_ptax")
      .select("data, cotacao_venda")
      .gte("data", recuarDias(datas[0], 15)).lte("data", hojeISO())
      .order("data", { ascending: true });
    const rows = (data ?? []) as { data: string; cotacao_venda: number }[];
    for (const d of datas) {
      let aplicavel = 0;
      for (const r of rows) { if (r.data <= d) aplicavel = Number(r.cotacao_venda); else break; }
      if (aplicavel > 0) porData.set(d, aplicavel);
    }
    atual = rows.length ? Number(rows[rows.length - 1].cotacao_venda) : 0;
  }

  return (p: PosicaoCusto): number => {
    const v = Number(p.valor_custo) || 0;
    if (moedaDe(p) === "BRL") return v;
    const taxa = porData.get(String(p.data_compra ?? "").slice(0, 10)) || atual;
    return taxa > 0 ? v * taxa : v;
  };
}

// ── Cache COMPARTILHADO de cotações (arqvalor.cotacoes_ativos) ───
// O preço de um ticker é igual para todos os usuários, então é cacheado
// numa tabela sem user_id. Leitura via JWT (RLS libera SELECT); escrita
// via service_role. Evita refetch externo por usuário e mantém o valor
// consistente entre contas.
export const COTACAO_STALE_MS = 6 * 60 * 60 * 1000; // revalida o mês corrente a cada 6h

export interface CacheCotacao { preco: number; moeda: string; atualizadoEm: string }

// Cotações cacheadas de vários tickers num mês específico
export async function lerCacheMes(c: Db, tickers: string[], mesAno: string): Promise<Map<string, CacheCotacao>> {
  const out = new Map<string, CacheCotacao>();
  if (tickers.length === 0) return out;
  const { data } = await c.from("cotacoes_ativos")
    .select("ticker, preco, moeda, atualizado_em").in("ticker", tickers).eq("mes_ano", mesAno);
  for (const r of data ?? []) {
    out.set(String(r.ticker).toUpperCase(), {
      preco: Number(r.preco), moeda: String(r.moeda), atualizadoEm: String(r.atualizado_em),
    });
  }
  return out;
}

// Toda a série mensal cacheada de um ticker (mes_ano → preço) + a moeda
export async function lerCacheTicker(c: Db, ticker: string): Promise<{ precos: Map<string, number>; moeda: string }> {
  const precos = new Map<string, number>();
  let moeda = "";
  const { data } = await c.from("cotacoes_ativos")
    .select("mes_ano, preco, moeda").eq("ticker", ticker.toUpperCase());
  for (const r of data ?? []) { precos.set(String(r.mes_ano), Number(r.preco)); if (!moeda) moeda = String(r.moeda); }
  return { precos, moeda };
}

// Grava/atualiza o cache (service_role — ignora RLS)
export async function gravarCache(rows: { ticker: string; mes_ano: string; preco: number; moeda: string }[]) {
  if (rows.length === 0) return;
  const admin = dbAdmin();
  const linhas = rows
    .filter((r) => r.ticker && Number.isFinite(r.preco) && r.preco >= 0)
    .map((r) => ({ ticker: r.ticker.toUpperCase(), mes_ano: r.mes_ano, preco: r.preco, moeda: r.moeda, atualizado_em: new Date().toISOString() }));
  if (linhas.length === 0) return;
  const { error } = await admin.from("cotacoes_ativos").upsert(linhas, { onConflict: "ticker,mes_ano" });
  if (error) logError("Upsert cotacoes_ativos", error);
}

// ── Cache DIÁRIO (arqvalor.cotacoes_ativos_diarias) ───────────
// Mesma natureza do cache mensal acima, granularidade de dia — usado só
// pelo filtro "Semana" do ranking de destaques (Mês/Semestre/Ano usam o
// snapshot MENSAL já existente, inv_historico_mensal — ver ranking() em
// dashboard.ts). Semana precisa de um ponto no tempo real, dia a dia, que a
// granularidade de mês não representa.

export async function gravarCacheDiario(rows: { ticker: string; data: string; preco: number; moeda: string }[]) {
  if (rows.length === 0) return;
  const admin = dbAdmin();
  const linhas = rows
    .filter((r) => r.ticker && RE_DATA.test(r.data) && Number.isFinite(r.preco) && r.preco >= 0)
    .map((r) => ({ ticker: r.ticker.toUpperCase(), data: r.data, preco: r.preco, moeda: r.moeda, atualizado_em: new Date().toISOString() }));
  if (linhas.length === 0) return;
  const { error } = await admin.from("cotacoes_ativos_diarias").upsert(linhas, { onConflict: "ticker,data" });
  if (error) logError("Upsert cotacoes_ativos_diarias", error);
}

// Última cotação com `data <= dataAlvo`, por ticker (mesmo padrão "última
// cotação até a data" já usado em conversorCustoBRL/PTAX).
export async function lerCacheDiario(
  c: Db, tickers: string[], dataAlvo: string,
): Promise<Map<string, { preco: number; moeda: string; data: string }>> {
  const out = new Map<string, { preco: number; moeda: string; data: string }>();
  await Promise.all(tickers.map(async (tk) => {
    const { data } = await c.from("cotacoes_ativos_diarias")
      .select("preco, moeda, data").eq("ticker", tk.toUpperCase()).lte("data", dataAlvo)
      .order("data", { ascending: false }).limit(1).maybeSingle();
    if (data) out.set(tk.toUpperCase(), { preco: Number(data.preco), moeda: String(data.moeda), data: String(data.data) });
  }));
  return out;
}

// Janela (period1/period2, em segundos Unix) ao REDOR de `dataAlvo` — não a
// série inteira. Buscar `range=10y`/`days=365` baixa e faz o parse de
// milhares de pontos por ativo à toa: numa carteira com várias dezenas de
// ativos isso empilha JSON grande + laço de milhares de itens por ticker,
// CPU/memória suficiente pra estourar o limite da Edge Function numa única
// requisição interativa (achado real: WORKER_RESOURCE_LIMIT / "Erro 546").
// 21 dias pra trás cobre folgado qualquer feriado/fim de semana prolongado
// até achar o último pregão ≤ dataAlvo; 2 pra frente é só margem.
function janelaDiaria(dataAlvo: string): { de: number; ate: number } {
  const alvoMs = new Date(`${dataAlvo}T12:00:00Z`).getTime();
  return { de: Math.floor((alvoMs - 21 * DIA_MS) / 1000), ate: Math.floor((alvoMs + 2 * DIA_MS) / 1000) };
}

// Busca 1 candidato de ticker no Yahoo, só na janela em torno de `dataAlvo`.
// Prazo curto (6s) — chamada em PARALELO pra cada candidato por
// historicoDiarioCotado, não em série, pra não empilhar timeout de vários
// candidatos numa carteira com vários ativos faltando cache.
async function umCandidatoDiario(sym: string, de: number, ate: number): Promise<{ precos: Map<string, number>; moeda: string } | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${de}&period2=${ate}&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      chart?: { result?: { meta?: { currency?: string }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const r  = data.chart?.result?.[0];
    const moeda = String(r?.meta?.currency ?? "").toUpperCase() || (sym.endsWith(".SA") ? "BRL" : "USD");
    const ts = r?.timestamp ?? [];
    const cl = r?.indicators?.quote?.[0]?.close ?? [];
    const precos = new Map<string, number>();
    for (let i = 0; i < ts.length; i++) {
      const px = cl[i];
      if (px == null) continue;
      precos.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), Number(px));
    }
    return precos.size > 0 ? { precos, moeda } : null;
  } catch (e) { logError("yahoo hist diário", e); return null; }
}

// Série diária (só a janela em torno de `dataAlvo`, ver `janelaDiaria`) —
// variante de historicoYahoo/historicoCotado usada só pelo backfill do cache
// diário. Mesma fonte/URL; só a chave do mapa muda (dia em vez de mês) e o
// range pedido é estreito em vez da série inteira.
export async function historicoDiarioCotado(ticker: string, dataAlvo: string): Promise<{ precos: Map<string, number>; moeda: string }> {
  const candidatos = candidatosTicker(ticker);
  if (candidatos.length > 0) {
    const { de, ate } = janelaDiaria(dataAlvo);
    // Todos os candidatos em paralelo (não em série) — o primeiro que trouxer
    // dado vence; timeout de UM candidato não empurra o próximo.
    const resultados = await Promise.all(candidatos.map((s) => umCandidatoDiario(s, de, ate)));
    const achado = resultados.find((r) => r != null);
    if (achado) return achado;
  }
  // brapi (B3) como fallback — só devolve o dia mais recente, mas cobre o
  // caso raro de o Yahoo não responder pra nenhum candidato.
  for (const b of basesTicker(ticker)) {
    const cot = await precosBrapi([b]);
    const v = cot.get(b.toUpperCase());
    if (v) return { precos: new Map([[hojeISO(), v.preco]]), moeda: v.moeda };
  }
  return { precos: new Map<string, number>(), moeda: "BRL" };
}

// Série diária de criptomoeda, só a janela em torno de `dataAlvo` (mesma
// razão da versão cotada acima). CoinGecko free ainda assim não cobre
// janelas com mais de ~365 dias no passado — mesma ressalva de sempre.
export async function historicoCriptoDiario(ticker: string, dataAlvo: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const id = await coingeckoId(ticker);
  if (!id) return out;
  const { de, ate } = janelaDiaria(dataAlvo);
  try {
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=brl&from=${de}&to=${ate}`,
    ) as { prices?: [number, number][] };
    for (const [ts, px] of data.prices ?? []) {
      out.set(new Date(ts).toISOString().slice(0, 10), Number(px)); // asc → último ponto do dia prevalece
    }
  } catch (e) { logError("coingecko hist diário", e); }
  return out;
}

// Processa itens em lotes de tamanho `concorrencia`, sem enfileirar lote
// NOVO depois de `ateMs` (epoch ms) — itens restantes simplesmente não são
// processados (o chamador já cai no fallback de "faltou"). Existe pra
// limitar CONCORRÊNCIA, não só tempo total: numa carteira com muitos ativos,
// disparar dezenas de fetches simultâneos pode estourar o limite de MEMÓRIA
// da Edge Function bem antes do timeout de cada fetch individual vencer.
async function executarEmLotes<T>(
  itens: T[], concorrencia: number, ateMs: number, tarefa: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < itens.length; i += concorrencia) {
    if (Date.now() >= ateMs) break;
    await Promise.all(itens.slice(i, i + concorrencia).map(tarefa));
  }
}

// Preço de cada ticker NUMA DATA do passado: tenta o cache diário; se faltar
// cobertura até `dataAlvo`, faz o backfill da série completa (Yahoo/CoinGecko)
// de uma vez, grava no cache e tenta de novo. Tickers cuja fonte não cobre a
// data (cripto > 365 dias, ativo listado depois da data) voltam ausentes do
// mapa — o chamador cai no fallback de "desde a compra". `prazoMs` limita
// tanto o tempo quanto (via `executarEmLotes`) a concorrência do backfill —
// numa carteira grande, o que não coube fica pra próxima consulta (o cache
// é permanente, então a carteira "esquenta" aos poucos, sem nunca travar
// uma única requisição interativa).
export async function resolverValorDiarioCotado(
  c: Db, cotados: string[], cripto: string[], dataAlvo: string, prazoMs = 8_000,
): Promise<Map<string, { preco: number; moeda: string }>> {
  const todos = [...new Set([...cotados, ...cripto].map((t) => t.toUpperCase()))];
  if (todos.length === 0) return new Map();

  let cache = await lerCacheDiario(c, todos, dataAlvo);
  const faltamCot = cotados.filter((t) => !cache.has(t.toUpperCase()));
  const faltamCr  = cripto.filter((t) => !cache.has(t.toUpperCase()));

  if (faltamCot.length > 0 || faltamCr.length > 0) {
    const ateMs = Date.now() + prazoMs;
    const novas: { ticker: string; data: string; preco: number; moeda: string }[] = [];
    // 3 tickers por vez (≤ 6 fetches concorrentes, já que cada ticker tenta
    // até 2 candidatos em paralelo) — cabe folgado no limite de memória da
    // isolate mesmo numa carteira grande.
    await executarEmLotes(faltamCot, 3, ateMs, async (tk) => {
      const { precos, moeda } = await historicoDiarioCotado(tk, dataAlvo);
      for (const [dia, preco] of precos) novas.push({ ticker: tk, data: dia, preco, moeda: moeda || "BRL" });
    });
    await executarEmLotes(faltamCr, 3, ateMs, async (tk) => {
      const precos = await historicoCriptoDiario(tk, dataAlvo);
      for (const [dia, preco] of precos) novas.push({ ticker: tk, data: dia, preco, moeda: "BRL" });
    });
    if (novas.length > 0) {
      await gravarCacheDiario(novas);
      cache = await lerCacheDiario(c, todos, dataAlvo);
    }
  }
  const out = new Map<string, { preco: number; moeda: string }>();
  for (const [tk, v] of cache) out.set(tk, { preco: v.preco, moeda: v.moeda });
  return out;
}

// Cotação ATUAL via Yahoo (fallback p/ ativos que a brapi não cobre, ex.: EUA).
// Tenta o símbolo puro (EUA) e o .SA (B3); devolve preço + moeda detectada.
export async function precoAtualYahoo(ticker: string): Promise<{ preco: number; moeda: string } | null> {
  for (const sym of candidatosTicker(ticker)) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) continue;
      const data = await res.json() as { chart?: { result?: { meta?: { regularMarketPrice?: number; currency?: string } }[] } };
      const meta = data.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice != null) {
        return { preco: Number(meta.regularMarketPrice), moeda: String(meta.currency ?? "").toUpperCase() || (sym.endsWith(".SA") ? "BRL" : "USD") };
      }
    } catch (e) { logError("yahoo quote", e); }
  }
  return null;
}

// Preço ATUAL (snapshot do mês): usa o cache; busca externamente só o que
// falta ou está vencido e regrava no cache. Devolve mapas por fonte.
export async function resolverPrecosAtuais(
  c: Db, mesAno: string, ehAtual: boolean, cotados: string[], cripto: string[],
): Promise<{ precos: Map<string, { preco: number; moeda: string }>; cripto: Map<string, number> }> {
  const precos = new Map<string, { preco: number; moeda: string }>();
  const criptoMap = new Map<string, number>();
  const [cacheCot, cacheCr] = await Promise.all([lerCacheMes(c, cotados, mesAno), lerCacheMes(c, cripto, mesAno)]);

  const agora = Date.now();
  const vencido = (a?: CacheCotacao) => !a || (ehAtual && agora - new Date(a.atualizadoEm).getTime() > COTACAO_STALE_MS);

  // cache válido entra direto
  for (const t of cotados) { const a = cacheCot.get(t); if (a && !vencido(a)) precos.set(t, { preco: a.preco, moeda: a.moeda }); }
  for (const t of cripto)  { const a = cacheCr.get(t);  if (a && !vencido(a)) criptoMap.set(t, a.preco); }

  // busca externa só do que falta/venceu e regrava
  const faltamCot = cotados.filter((t) => vencido(cacheCot.get(t)));
  const faltamCr  = cripto.filter((t) => vencido(cacheCr.get(t)));
  const [extCot, extCr] = await Promise.all([precosBrapi(faltamCot), precosCripto(faltamCr)]);
  const novas: { ticker: string; mes_ano: string; preco: number; moeda: string }[] = [];
  for (const [t, v] of extCot) { precos.set(t, v); novas.push({ ticker: t, mes_ano: mesAno, preco: v.preco, moeda: v.moeda }); }
  for (const [t, p] of extCr)  { criptoMap.set(t, p); novas.push({ ticker: t, mes_ano: mesAno, preco: p, moeda: "BRL" }); }

  // Fallback Yahoo p/ cotados que a brapi não cobriu (tipicamente ativos dos EUA)
  for (const t of faltamCot) {
    if (extCot.has(t)) continue;
    const y = await precoAtualYahoo(t);
    if (y) { precos.set(t, y); novas.push({ ticker: t, mes_ano: mesAno, preco: y.preco, moeda: y.moeda }); }
  }
  await gravarCache(novas);

  // fallback: fonte externa falhou mas há cache (mesmo vencido) → usa o cache
  for (const t of cotados) if (!precos.has(t))    { const a = cacheCot.get(t); if (a) precos.set(t, { preco: a.preco, moeda: a.moeda }); }
  for (const t of cripto)  if (!criptoMap.has(t)) { const a = cacheCr.get(t);  if (a) criptoMap.set(t, a.preco); }

  return { precos, cripto: criptoMap };
}

// Upsert do snapshot de um (ativo, conta, mês) reusando a lógica de
// desempenho e o recálculo do mês seguinte de historico-mensal.
export const B3_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Referer": "https://sistemaswebb3-listados.b3.com.br/",
  "Origin": "https://sistemaswebb3-listados.b3.com.br",
};

// GET JSON na B3 com timeout, headers de navegador e 1 retry. Distingue os
// desfechos: T = resposta ok; null = resposta VAZIA legítima (ativo sem
// dados); "falha" = a B3 não respondeu (HTTP != 2xx, timeout, corpo inválido).
export async function fetchB3<T>(url: string, ref: string): Promise<T | null | "falha"> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(url, { headers: B3_HEADERS, signal: AbortSignal.timeout(8000) });
      if (!res.ok) { logError("B3 proventos", `${ref}: HTTP ${res.status} (tentativa ${tentativa})`); continue; }
      const txt = await res.text();
      if (!txt || txt === '""' || txt === "null") return null;
      return JSON.parse(txt) as T;
    } catch (e) { logError("B3 proventos", `${ref}: ${e} (tentativa ${tentativa})`); }
    // pequena espera antes do retry
    await new Promise((r) => setTimeout(r, 600));
  }
  return "falha";
}
// Parsing de data/numero no formato BR ("dd/mm/yyyy", "1.234,56") está
// centralizado em brDataISO/brNumero (definidos junto do bloco do Tesouro).

// ============================================================
// /investimentos/snapshot-backfill — preenche o histórico de meses
// PASSADOS (itens importados que o usuário tem há anos). Para cada
// (ativo, conta), varre de data_compra até o mês informado e grava só
// os meses que ainda NÃO têm snapshot (não sobrescreve):
//   • cotados (B3/BDR/STOCKS) → Yahoo Finance (range mensal) c/ brapi de
//     fallback; STOCKS em USD convertidos pela PTAX histórica do mês
//   • CRIPTOMOEDAS            → CoinGecko (market_chart, série longa)
//   • Renda Fixa / Tesouro    → acúmulo pelo indexador desde o aporte
//
// Aproximações (v1): quantidade/custo de cada mês = posições ATIVAS já
// compradas até aquele mês (vendas/encerramentos não são reconstruídos);
// RF usa a taxa anual atual constante. Refinável depois com séries
// históricas de índice (BCB/SGS) e Tesouro Transparente.
// ============================================================

export function fimSerieRF(venc: string | null, mesFim: string): string {
  if (!venc) return mesFim;
  const vencMes = venc.slice(0, 7);
  return vencMes < mesFim ? vencMes : mesFim;
}

// Histórico mensal de cotação no Yahoo Finance. Devolve a série (mês→preço)
// e a MOEDA detectada (meta.currency) — B3 usa sufixo .SA (BRL); papéis dos
// EUA usam o ticker puro (USD). Yahoo bloqueia sem User-Agent.
export async function historicoYahoo(symbol: string): Promise<{ precos: Map<string, number>; moeda: string }> {
  const precos = new Map<string, number>();
  let moeda = "";
  try {
    // interval=1d agregado por mês (último fechamento de cada mês). O endpoint
    // MENSAL do Yahoo omite os meses iniciais de tickers novos/ilíquidos (ex.:
    // ETFs recém-listados como AUVP11, que no mensal só começam meses depois do
    // 1º pregão). O diário traz esses meses. Como ts é crescente, o último set
    // de cada mês fica com o fechamento do mês.
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) },
    );
    if (!res.ok) return { precos, moeda };
    const data = await res.json() as {
      chart?: { result?: { meta?: { currency?: string }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const r  = data.chart?.result?.[0];
    moeda = String(r?.meta?.currency ?? "").toUpperCase();
    const ts = r?.timestamp ?? [];
    const cl = r?.indicators?.quote?.[0]?.close ?? [];
    for (let i = 0; i < ts.length; i++) {
      const px = cl[i];
      if (px == null) continue;
      precos.set(new Date(ts[i] * 1000).toISOString().slice(0, 7), Number(px));
    }
  } catch (e) { logError("yahoo hist", e); }
  return { precos, moeda };
}

export async function historicoBrapiHist(ticker: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const data = await fetchJson(
      brapiUrl(`quote/${encodeURIComponent(ticker)}?range=10y&interval=1mo`),
    ) as { results?: { historicalDataPrice?: { date?: number; close?: number }[] }[] };
    for (const h of data.results?.[0]?.historicalDataPrice ?? []) {
      if (h.date == null || h.close == null) continue;
      out.set(new Date(h.date * 1000).toISOString().slice(0, 7), Number(h.close));
    }
  } catch (e) { logError("brapi hist", e); }
  return out;
}

// Cotação histórica (mês→preço + moeda). Tenta os dois símbolos no Yahoo —
// .SA (B3) e puro (EUA) — independentemente da moeda cadastrada, pois ativos
// importados podem vir com a moeda errada. brapi (B3) como último fallback.
export async function historicoCotado(ticker: string, moedaHint: string): Promise<{ precos: Map<string, number>; moeda: string }> {
  for (const sym of candidatosTicker(ticker)) {
    const y = await historicoYahoo(sym);
    if (y.precos.size > 0) {
      return { precos: y.precos, moeda: y.moeda || (sym.endsWith(".SA") ? "BRL" : (moedaHint || "USD")) };
    }
  }
  // brapi (B3) como fallback — tenta o ticker e seu alias
  for (const b of basesTicker(ticker)) {
    const precos = await historicoBrapiHist(b);
    if (precos.size > 0) return { precos, moeda: "BRL" };
  }
  return { precos: new Map<string, number>(), moeda: "BRL" };
}

// CoinGecko: mapeia símbolo→id (cache por instância).
//
// IMPORTANTE: NÃO usar /coins/list — várias moedas compartilham o mesmo símbolo
// e o 1º match costuma ser um token impostor de baixo valor (btc→"batcat",
// sol→"allbridge-bridged-sol", eth→"bifrost-bridged-eth", usdc→"beam-bridged-usdc").
// O /search já vem ordenado por relevância/market cap → pega o match exato de
// símbolo com o melhor (menor) market_cap_rank.
//
// Overrides: símbolo (UPPER) → id oficial da CoinGecko, p/ casos em que o
// /search ainda assim erra o token (ex.: USDC casa com bridged/impostores).
export const COINGECKO_ID_OVERRIDES: Record<string, string> = {
  USDC: "usd-coin",
};
export const _cgIdCache = new Map<string, string | null>();
export async function coingeckoId(symbol: string): Promise<string | null> {
  const key = symbol.toLowerCase();
  if (_cgIdCache.has(key)) return _cgIdCache.get(key) ?? null;
  const ovr = COINGECKO_ID_OVERRIDES[key.toUpperCase()];
  if (ovr) { _cgIdCache.set(key, ovr); return ovr; }
  let id: string | null = null;
  try {
    const sr = await fetchJson(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`,
    ) as { coins?: { id?: string; symbol?: string; market_cap_rank?: number | null }[] };
    const exatos = (sr.coins ?? []).filter((c) => String(c.symbol ?? "").toLowerCase() === key && c.id);
    exatos.sort((a, b) => (a.market_cap_rank ?? Number.MAX_SAFE_INTEGER) - (b.market_cap_rank ?? Number.MAX_SAFE_INTEGER));
    id = exatos[0]?.id ?? null;
  } catch (e) { logError(`coingecko id ${symbol}`, e); }
  _cgIdCache.set(key, id);
  return id;
}

export async function historicoCripto(ticker: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const id = await coingeckoId(ticker);
  if (!id) return out;
  try {
    // CoinGecko free limita o histórico aos últimos 365 dias (erro 10012 com
    // days=max) e o parâmetro interval virou pago — sem ele, days=365 já
    // devolve pontos diários. Meses anteriores a ~1 ano não ficam disponíveis.
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=brl&days=365`,
    ) as { prices?: [number, number][] };
    for (const [ts, px] of data.prices ?? []) {
      out.set(new Date(ts).toISOString().slice(0, 7), Number(px)); // ordem asc → último do mês prevalece
    }
  } catch (e) { logError("coingecko hist", e); }
  return out;
}

// Histórico mensal de cotação com cache COMPARTILHADO: usa o cache se ele
// já cobre desde 'inicio'; senão busca a série externa, grava no cache e
// devolve a série mesclada. (cotados → Yahoo/brapi; cripto → CoinGecko)
export async function resolverHistoricoCotado(c: Db, ticker: string, moedaHint: string, inicio: string): Promise<{ precos: Map<string, number>; moeda: string }> {
  const cache = await lerCacheTicker(c, ticker);
  const maisAntigo = [...cache.precos.keys()].sort()[0];
  if (cache.precos.size > 0 && maisAntigo && maisAntigo <= inicio) {
    return { precos: cache.precos, moeda: cache.moeda || moedaHint };
  }
  const ext = await historicoCotado(ticker, moedaHint);
  if (ext.precos.size > 0) {
    await gravarCache([...ext.precos].map(([mes, preco]) => ({ ticker, mes_ano: mes, preco, moeda: ext.moeda || "BRL" })));
    for (const [mes, preco] of ext.precos) cache.precos.set(mes, preco);
    return { precos: cache.precos, moeda: ext.moeda || cache.moeda || moedaHint };
  }
  return { precos: cache.precos, moeda: cache.moeda || moedaHint };
}

export async function resolverHistoricoCripto(c: Db, ticker: string, inicio: string): Promise<Map<string, number>> {
  const cache = await lerCacheTicker(c, ticker);
  const maisAntigo = [...cache.precos.keys()].sort()[0];
  if (cache.precos.size > 0 && maisAntigo && maisAntigo <= inicio) return cache.precos;
  const ext = await historicoCripto(ticker);
  if (ext.size > 0) {
    await gravarCache([...ext].map(([mes, preco]) => ({ ticker, mes_ano: mes, preco, moeda: "BRL" })));
    for (const [mes, preco] of ext) cache.precos.set(mes, preco);
  }
  return cache.precos;
}

// PTAX (venda) por mês (último dia útil do mês), a partir de desdeISO
export async function ptaxPorMesMap(c: Db, desdeISO: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data } = await c.from("cotacoes_ptax")
    .select("data, cotacao_venda").gte("data", desdeISO).order("data", { ascending: true });
  for (const r of data ?? []) out.set(String(r.data).slice(0, 7), Number(r.cotacao_venda));
  return out;
}

// Reconstrói o histórico mensal de UM ativo de renda fixa / Tesouro, do 1º
// aporte até o mês corrente, recalculando cada mês pela fórmula do indexador
// (e MtM, no Tesouro). Chamado quando a forma de rentabilidade do ativo muda:
// como o valor é derivado (não cotado), apagar e recalcular é seguro e
// determinístico. Pressupõe que o histórico antigo já foi removido — grava em
// ordem crescente para que a variação % de cada mês saia contra o anterior.
export async function rebuildHistoricoRF(c: Db, userId: string, ativoId: string): Promise<number> {
  const { data: ativo } = await c.from("inv_ativos")
    .select("tipo_ativo, nome, rf_indexador, rf_taxa, rf_vencimento")
    .eq("id", ativoId).maybeSingle();
  if (!ativo) return 0;
  const tipo = String(ativo.tipo_ativo ?? "");
  if (tipo !== "RENDA_FIXA" && tipo !== "TESOURO_DIRETO") return 0;

  const { data: posicoes } = await c.from("inv_posicoes")
    .select("conta_id, quantidade, valor_custo, data_compra")
    .eq("ativo_id", ativoId).eq("status", "ATIVA");
  if (!posicoes || posicoes.length === 0) return 0;

  // Cada conta tem sua própria série de snapshot (ativo pode estar em mais de uma)
  const porConta = new Map<string, { quantidade: number; valor_custo: number; data_compra: string }[]>();
  for (const p of posicoes) {
    const k = String(p.conta_id);
    if (!porConta.has(k)) porConta.set(k, []);
    porConta.get(k)!.push({
      quantidade: Number(p.quantidade) || 0, valor_custo: Number(p.valor_custo) || 0,
      data_compra: String(p.data_compra),
    });
  }

  const mesCorrente = mesCorrenteBR();
  const indexador = (ativo.rf_indexador as string | null) ?? null;
  const taxa      = (ativo.rf_taxa as string | null) ?? null;
  const venc      = (ativo.rf_vencimento as string | null) ?? null;
  const nome      = String(ativo.nome ?? "");
  const cdi  = await sgsUltimo(432, CDI_FALLBACK);
  const ipca = await sgsUltimo(13522, IPCA_FALLBACK);
  const { cdi: cdiSerie, ipca: ipcaSerie } = await carregarIndicesMensais(c, INDICES_DATA_CORTE);

  const vencs = tipo === "TESOURO_DIRETO" && venc ? [venc] : [];
  if (vencs.length) { try { await garantirTesouroMesCorrente(c, vencs, mesCorrente); } catch (e) { logError("rebuild RF tesouro mes", e); } }
  const mtm = await carregarTesouroMtM(c, vencs);

  let gravados = 0;
  for (const [contaId, posic] of porConta) {
    const inicio = posic.reduce((min, p) => {
      const me = p.data_compra.slice(0, 7);
      return me < min ? me : min;
    }, mesCorrente);
    for (const me of mesesEntre(inicio, fimSerieRF(venc, mesCorrente))) {
      const posMes = posic.filter((p) => p.data_compra.slice(0, 7) <= me);
      if (posMes.length === 0) continue;
      const qtd   = posMes.reduce((s, p) => s + p.quantidade, 0);
      const custo = posMes.reduce((s, p) => s + p.valor_custo, 0);
      if (qtd <= 0) continue;
      const precoMedio = custo / qtd;
      // Mês corrente acumula até HOJE; meses fechados, até o último dia do mês.
      const dataRef = me === mesCorrente
        ? new Date()
        : new Date(Date.UTC(Number(me.slice(0, 4)), Number(me.slice(5, 7)), 0, 12));
      const valor = valorRFPosicoes(posMes, tipo, indexador, venc, nome, me, dataRef, taxa, cdiSerie, ipcaSerie, cdi, ipca, mtm);
      if (!(valor > 0)) continue;
      await gravarSnapshot(c, userId, ativoId, contaId, me, valor, qtd, precoMedio);
      gravados++;
    }
  }
  return gravados;
}

export interface ResultadoBusca {
  ticker:      string;
  nome:        string;
  preco:       number | null;
  moeda:       string;
  // Extras preenchidos só pelo Tesouro Direto
  emissor?:    string;
  taxa?:       string;
  vencimento?: string;       // YYYY-MM-DD
  indexador?:  string;       // PREFIXADO | POS_FIXADO | HIBRIDO
}

export function brapiToken(): string {
  const t = Deno.env.get("BRAPI_TOKEN") ?? "";
  return t ? `&token=${encodeURIComponent(t)}` : "";
}

// Monta uma URL da brapi anexando o token. `path` já inclui a query (todas
// as chamadas têm `?...`), então o token entra como `&token=...`.
export function brapiUrl(path: string): string {
  return `https://brapi.dev/api/${path}${brapiToken()}`;
}

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`fonte externa respondeu ${res.status}`);
  return await res.json();
}

export function indexadorDoTesouro(nome: string): string {
  if (/selic/i.test(nome)) return "POS_FIXADO";
  if (/prefixado/i.test(nome)) return "PREFIXADO";
  return "HIBRIDO"; // IPCA+, Renda+, Educa+
}

// Código curto da família p/ compor o ticker legível do Tesouro.
export const TESOURO_COD: Record<string, string> = { PREFIXADO: "PRE", POS_FIXADO: "SELIC", HIBRIDO: "IPCA" };
// Ticker determinístico e legível: TD-IPCA-2040, TD-IPCA-JS-2060, TD-PRE-2027,
// TD-SELIC-2029. Mantém o MESMO código entre busca, cadastro manual (frontend
// lib/tesouro.ts) e importação — evita duplicar o ativo. "" se faltar dado.
export function tickerTesouro(indexador: string, vencimento: string, semestral: boolean): string {
  const ano = String(vencimento ?? "").slice(0, 4);
  const cod = TESOURO_COD[indexador];
  if (!cod || !/^\d{4}$/.test(ano)) return "";
  const js = semestral && indexador !== "POS_FIXADO" ? "-JS" : "";
  return `TD-${cod}${js}-${ano}`;
}
// Nome amigável do título (espelha FrontEnd/src/lib/tesouro.ts).
export const TESOURO_NOME_FAMILIA: Record<string, string> = { PREFIXADO: "Prefixado", POS_FIXADO: "Selic", HIBRIDO: "IPCA+" };
export function nomeTesouro(indexador: string, vencimento: string, semestral: boolean): string {
  const fam = TESOURO_NOME_FAMILIA[indexador];
  if (!fam) return "";
  const ano = String(vencimento ?? "").slice(0, 4);
  const js = semestral && indexador !== "POS_FIXADO" ? " com Juros Semestrais" : "";
  return `Tesouro ${fam}${js}${/^\d{4}$/.test(ano) ? ` ${ano}` : ""}`;
}
// Heurística "com juros semestrais" pelo nome (espelha puTesouro/lib tesouro).
export function tesouroSemestral(nome: string): boolean {
  const s = String(nome ?? "");
  return /semestr|ntn-?f/i.test(s) || (/ntn-?b/i.test(s) && !/princ/i.test(s));
}

// "Tipo Titulo" no formato oficial do STN, SEM o ano (o CSV de cupons abaixo
// traz o ano numa coluna própria — Vencimento do Titulo) — espelha
// FrontEnd/src/lib/tesouro.ts::tipoTituloTesouro. Só Prefixado e IPCA+ têm
// variação "com Juros Semestrais"; Selic (POS_FIXADO) nunca paga cupom.
export function tipoTituloTesouro(indexador: string | null, semestral: boolean): string | null {
  if (indexador !== "PREFIXADO" && indexador !== "HIBRIDO") return null;
  const base = indexador === "PREFIXADO" ? "Tesouro Prefixado" : "Tesouro IPCA+";
  return semestral ? `${base} com Juros Semestrais` : base;
}

// ============================================================
// Cupom de juros semestrais do Tesouro Direto — Tesouro Transparente/STN
// (mesma proveniência do CSV de PU já usado pra marcação a mercado; dataset
// "Resgates do Tesouro Direto", recurso "Pagamento de Cupom de Juros").
// ============================================================
export const CUPOM_TESOURO_CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/f30db6e4-6123-416c-b094-be8dfc823601/" +
  "resource/de2af5cf-9dbd-4566-b933-da6871cce030/download/cupomjurostesourodireto.csv";

export interface CupomTesouro {
  tipoTitulo: string; vencimento: string; dataResgate: string; puCupom: number;
}

// Baixa e parseia o CSV oficial de pagamento de cupons semestrais. Colunas:
// Tipo Titulo;Vencimento do Titulo;Data Resgate;PU;Quantidade;Valor — "PU"
// aqui é o valor do CUPOM por unidade/cota (não o preço do título; Valor ≈
// PU × Quantidade confere linha a linha), o equivalente do "rate" usado pros
// proventos de ações. Arquivo pequeno (algumas centenas de linhas, não passa
// de dezenas de KB) — sem necessidade de streaming como o CSV de PU.
export async function baixarCupomTesouro(): Promise<CupomTesouro[]> {
  const res = await fetch(CUPOM_TESOURO_CSV_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Tesouro Transparente (cupons) respondeu ${res.status}`);
  const texto = await res.text();
  const out: CupomTesouro[] = [];
  for (const linha of texto.split("\n").slice(1)) { // pula cabeçalho
    const cols = linha.split(";");
    if (cols.length < 4) continue;
    const vencimento  = brDataISO(cols[1]);
    const dataResgate = brDataISO(cols[2]);
    const pu = brNumero(cols[3]);
    if (!cols[0]?.trim() || !vencimento || !dataResgate || !Number.isFinite(pu) || pu <= 0) continue;
    out.push({ tipoTitulo: cols[0].trim(), vencimento, dataResgate, puCupom: pu });
  }
  return out;
}

// Datas de cupom (ISO, ordenadas) já pagas pra um título específico do
// usuário, dentro de [desde, ate] — usadas pra "resetar" o juros-sobre-juros
// da acumulação de fallback (valorRFAcumulado) quando o PU de marcação a
// mercado não está disponível pro título. Casa por tipoTitulo (derivado do
// indexador/semestral do ativo) + vencimento exato.
export function datasCupomParaAtivo(
  cupons: CupomTesouro[], indexador: string | null, semestral: boolean, vencimento: string | null,
  desde: string, ate: string,
): string[] {
  const tipoTitulo = tipoTituloTesouro(indexador, semestral);
  if (!tipoTitulo || !vencimento) return [];
  return cupons
    .filter((c) => c.tipoTitulo === tipoTitulo && c.vencimento === vencimento
      && c.dataResgate >= desde && c.dataResgate <= ate)
    .map((c) => c.dataResgate)
    .sort();
}

export function taxaDoTesouro(nome: string, rate: number): string {
  const pct = `${String(rate).replace(".", ",")}%`;
  if (/selic/i.test(nome)) return `SELIC + ${pct}`;
  if (/prefixado/i.test(nome)) return `${pct} a.a.`;
  return `IPCA + ${pct}`;
}

export interface TituloTesouro { tipo: string; venc: string; base: string; puVenda: number; taxaVenda: number }

// Cache em memória do módulo (instância da Edge Function): o CSV do Tesouro
// Transparente tem ~14MB — baixar tudo de novo a cada busca (uma por termo
// digitado, mesmo com debounce/staleTime no front) desperdiça banda para
// extrair ~50 linhas do dia mais recente. Reusa por até COTACAO_STALE_MS
// (6h — as taxas do Tesouro só são republicadas ~2×/dia), igual ao cache de
// cotações de ações. Sobrevive só enquanto a instância ficar "quente"; num
// cold start, refaz o download normalmente (sem quebrar nada).
let tesouroCache: { titulos: TituloTesouro[]; maxBase: string; baixadoEm: number } | null = null;

export async function titulosTesouroAtual(): Promise<{ titulos: TituloTesouro[]; maxBase: string }> {
  if (tesouroCache && Date.now() - tesouroCache.baixadoEm < COTACAO_STALE_MS) {
    return tesouroCache;
  }

  const res = await fetch(TESOURO_CSV_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok || !res.body) throw new Error(`Tesouro Transparente respondeu ${res.status}`);

  const reader = res.body.pipeThrough(new TextDecoderStream("latin1")).getReader();
  const porTitulo = new Map<string, TituloTesouro>();
  let maxBase = "";
  let buf = "";
  let cabecalho = true;

  const processar = (linha: string) => {
    if (!linha) return;
    if (cabecalho) { cabecalho = false; return; }        // pula o header
    const col = linha.split(";");
    if (col.length < 7) return;
    const tipo = col[0].trim();
    const venc = brDataISO(col[1]);
    const base = brDataISO(col[2]);
    if (!venc || !base) return;
    if (base > maxBase) maxBase = base;
    const puVenda = brNumero(col[6]);                     // PU Venda Manha
    if (!Number.isFinite(puVenda) || puVenda <= 0) return; // só títulos com preço de compra
    const taxaVenda = brNumero(col[4]);                   // Taxa Venda Manha
    const chave = `${tipo}|${venc}`;
    const atual = porTitulo.get(chave);
    if (!atual || base > atual.base) {
      porTitulo.set(chave, { tipo, venc, base, puVenda, taxaVenda: Number.isFinite(taxaVenda) ? taxaVenda : 0 });
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      processar(buf.slice(0, nl).replace(/\r$/, ""));
      buf = buf.slice(nl + 1);
    }
  }
  processar(buf.replace(/\r$/, ""));

  // Só os títulos negociados no ÚLTIMO dia disponível no CSV — é o proxy
  // de "disponível para compra hoje" (título encerrado para de aparecer).
  const titulos = [...porTitulo.values()].filter((t) => t.base === maxBase);
  tesouroCache = { titulos, maxBase, baixadoEm: Date.now() };
  return tesouroCache;
}

// A antiga API JSON do Tesouro Direto (tesourodireto.com.br/.../
// treasurybondsinfo.json) foi desativada (HTTP 410) — o novo canal da B3
// (developers.b3.com.br) é B2B, sem acesso gratuito para pessoa física. Por
// isso a busca reusa o CSV público do Tesouro Transparente (mesma fonte já
// usada no backfill de marcação a mercado, TESOURO_CSV_URL — grátis, sem
// chave), pegando a linha mais recente (Data Base) de cada título.
export async function buscaTesouro(q: string): Promise<ResultadoBusca[]> {
  const { titulos } = await titulosTesouroAtual();
  // Normaliza: minúsculo e sem símbolos (o nome da B3 usa "+" no IPCA+/IGPM+,
  // o ticker usa "-"). Cada PALAVRA do termo digitado precisa aparecer em
  // ALGUM LUGAR do texto-alvo — não como uma substring contínua única. Isso
  // importa porque o ano do vencimento só existe dentro do ticker
  // ("TD-IPCA-2032"), colado sem espaço; se o usuário digita "Tesouro IPCA+
  // 2032" (o nome amigável, igual ao cadastro manual), a frase INTEIRA nunca
  // seria uma substring contígua de "tesouroipca+ tdipca2032" — cada palavra
  // batendo separadamente resolve isso.
  const normaliza = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const termos = q.toLowerCase().split(/\s+/).map(normaliza).filter(Boolean);
  const todos: ResultadoBusca[] = [];
  for (const item of titulos) {
    const indexador = indexadorDoTesouro(item.tipo);
    const semestral = /semestr/i.test(item.tipo);
    const legivel   = tickerTesouro(indexador, item.venc, semestral);
    const ticker    = legivel ||
      item.tipo.replace(/tesouro\s*/i, "").replace(/[^A-Za-z0-9+]/g, "").toUpperCase().slice(0, 20);
    // Busca no nome oficial (B3) + ticker legível (TD-IPCA-2040) + nome
    // amigável com ano ("Tesouro IPCA+ 2032", igual ao cadastro manual) —
    // cobre "ipca", "ipca-", "ipca+", "juros", "selic", "2040", frases
    // combinando nome e ano em qualquer ordem…
    const alvo = normaliza(`${item.tipo} ${ticker} ${nomeTesouro(indexador, item.venc, semestral)}`);
    if (!termos.every((t) => alvo.includes(t))) continue;
    // Nome amigável COM o ano do vencimento (igual ao cadastro manual e ao
    // que "Padronizar Tesouro" normaliza) — o "Tipo Titulo" cru do STN
    // (item.tipo) não carrega o ano, ele vem numa coluna separada do CSV.
    // Usar item.tipo aqui deixava o ativo cadastrado como só "Tesouro IPCA+"
    // sem vencimento, e normalizar-tesouro depois não corrigia porque só
    // renomeia nomes vazios/iguais ao ticker antigo (nunca sobrescreve um
    // nome não-vazio, pra não apagar edição manual do usuário).
    const nomeAmigavel = nomeTesouro(indexador, item.venc, semestral) || item.tipo;
    todos.push({
      ticker, nome: nomeAmigavel, preco: item.puVenda, moeda: "BRL",
      emissor: "Governo Federal", taxa: taxaDoTesouro(item.tipo, item.taxaVenda),
      vencimento: item.venc, indexador,
    });
  }
  // Ordena por ticker ANTES de cortar em 10 — sem isso, buscas amplas (ex.:
  // "ipca") podiam nunca mostrar a variante sem juros semestrais, porque há
  // mais de 10 vencimentos "com Juros Semestrais" antes dela na ordem do CSV.
  // Ticker ordenado também deixa "-2032" antes de "-JS-2032" (dígito < letra).
  todos.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return todos.slice(0, 10);
}

// Busca de criptomoedas via CoinGecko (grátis, sem chave). /search devolve as
// moedas ordenadas por relevância (market cap); /coins/markets enriquece com o
// preço atual em BRL numa única chamada.
export async function buscaCripto(q: string): Promise<ResultadoBusca[]> {
  const sr = await fetchJson(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
  ) as { coins?: { id?: string; name?: string; symbol?: string }[] };
  const top = (sr.coins ?? []).slice(0, 8);
  if (top.length === 0) return [];
  const ids = top.map((c) => c.id).filter(Boolean) as string[];
  const precoPorId = new Map<string, number>();
  try {
    const arr = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=brl&ids=${encodeURIComponent(ids.join(","))}`,
    ) as { id?: string; current_price?: number }[];
    for (const m of arr ?? []) if (m.id && m.current_price != null) precoPorId.set(m.id, Number(m.current_price));
  } catch (e) { logError("coingecko busca preço", e); }
  return top.map((c) => ({
    ticker: String(c.symbol ?? "").toUpperCase().slice(0, 20),
    nome:   String(c.name ?? c.symbol ?? ""),
    preco:  c.id && precoPorId.has(c.id) ? precoPorId.get(c.id)! : null,
    moeda:  "BRL",
  }));
}

export async function buscaB3(q: string): Promise<ResultadoBusca[]> {
  const data = await fetchJson(
    brapiUrl(`quote/list?search=${encodeURIComponent(q)}&limit=10`),
  ) as { stocks?: { stock?: string; name?: string; close?: number }[] };
  return (data.stocks ?? []).map((s) => ({
    ticker: String(s.stock ?? "").toUpperCase().slice(0, 20),
    nome:   String(s.name ?? s.stock ?? ""),
    preco:  s.close != null ? Number(s.close) : null,
    moeda:  "BRL",
  }));
}

export async function buscaExterna(params: URLSearchParams) {
  const tipo = params.get("tipo") ?? "";
  const q    = (params.get("q") ?? "").trim();
  logRequest("GET", "/investimentos/busca-externa", { tipo, q });

  if (!TIPOS_ATIVO.includes(tipo)) return erro(`tipo inválido: ${TIPOS_ATIVO.join(" | ")}`);
  if (q.length < 2) return erro("q deve ter pelo menos 2 caracteres");

  try {
    // RENDA_FIXA usa a busca da B3 também — cobre papéis listados
    // (debêntures etc.); CDB/LCI/LCA são emissões privadas e podem não
    // aparecer, por isso o frontend mantém o cadastro manual como saída.
    let resultados: ResultadoBusca[];
    if (tipo === "TESOURO_DIRETO")    resultados = await buscaTesouro(q);
    else if (tipo === "CRIPTOMOEDAS") resultados = await buscaCripto(q);
    else                              resultados = await buscaB3(q);
    logSuccess("Busca externa", { tipo, q, encontrados: resultados.length });
    return json({ dados: resultados });
  } catch (e) {
    logError("Busca externa", e);
    return erro(`Não foi possível consultar a fonte externa: ${(e as Error).message}`, 502);
  }
}

// ============================================================
// /investimentos/ptax — cotação PTAX do dólar (USD/BRL)
//
// Tabela COMPARTILHADA (arqvalor.cotacoes_ptax) sincronizada com o PTAX
// do Banco Central (Olinda/BCB), com data de corte 2021-01-01.
//
//   GET  /investimentos/ptax?datas=2024-01-05,...  → cotações por data
//   POST /investimentos/ptax                        → força sincronização
//                                                     (uso por agendador/cron)
//
// Sincronização automática: a cada GET, se a tabela estiver vazia faz o
// backfill desde a data de corte; senão re-busca uma janela recente até
// hoje. Com isso:
//   • lançamento com data de HOJE: o PTAX do dia ainda não saiu (publica
//     ~13h) → o front usa a cotação "atual" (último dia útil disponível);
//   • nos dias seguintes: o re-fetch traz o PTAX oficial daquela data e a
//     conversão exibida passa a usar o valor correto (upsert sobrescreve).
//
// Leitura via JWT do usuário; gravação via service_role.
// ============================================================

export const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
export const PTAX_DATA_CORTE = "2021-01-01"; // histórico a partir desta data

// Data de pagamento de provento plausível. A B3 devolve datas-sentinela
// (ex.: 31/12/9999) para proventos cujo pagamento ainda é "a definir";
// sem este filtro elas viravam projeções lançadas no ano 9999. Aceita só
// datas ISO válidas numa janela sã (ano 2000 até 3 anos à frente).
export async function buscarPtaxBCB(
  ini: string, fim: string,
): Promise<{ data: string; cotacao_compra: number; cotacao_venda: number }[]> {
  const fmt = (d: string) => { const [a, m, dd] = d.split("-"); return `${m}-${dd}-${a}`; }; // MM-dd-yyyy
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@dataInicial='${fmt(ini)}'&@dataFinalCotacao='${fmt(fim)}'&$top=100&$format=json`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`BCB respondeu ${res.status}`);
  const data = await res.json() as {
    value?: { cotacaoCompra: number; cotacaoVenda: number; dataHoraCotacao: string }[];
  };
  const porData = new Map<string, { compra: number; venda: number }>();
  for (const v of data.value ?? []) {
    const d = String(v.dataHoraCotacao).slice(0, 10);
    if (!RE_DATA.test(d)) continue;
    porData.set(d, { compra: Number(v.cotacaoCompra), venda: Number(v.cotacaoVenda) });
  }
  return [...porData.entries()].map(([data, v]) => ({
    data, cotacao_compra: v.compra, cotacao_venda: v.venda,
  }));
}

// Sincroniza [desde..ate] em janelas (≤ ~65 dias úteis cada, compatível
// com $top=100). Idempotente (upsert por data). Devolve o total inserido.
export async function sincronizarPtax(desde: string, ate: string): Promise<number> {
  if (desde > ate) return 0;
  const admin = dbAdmin();
  let inicio = desde;
  let total = 0;
  for (let i = 0; i < 60 && inicio <= ate; i++) {          // trava de segurança
    const fim = menorData(deslocarDias(inicio, 95), ate);  // ~65 dias úteis < 100
    let linhas: { data: string; cotacao_compra: number; cotacao_venda: number }[];
    try {
      linhas = await buscarPtaxBCB(inicio, fim);
    } catch (e) { logError("PTAX BCB janela", e); break; }
    if (linhas.length > 0) {
      // grava só datas novas ou com cotação revisada (e conta só essas),
      // evitando recontar a janela de reconfirmação a cada sync.
      const { data: ex } = await admin.from("cotacoes_ptax")
        .select("data, cotacao_compra, cotacao_venda").gte("data", inicio).lte("data", fim);
      const existentes = new Map<string, { c: number; v: number }>();
      for (const r of (ex ?? []) as { data: string; cotacao_compra: number; cotacao_venda: number }[]) {
        existentes.set(r.data, { c: Number(r.cotacao_compra), v: Number(r.cotacao_venda) });
      }
      const novas = linhas.filter((l) => {
        const e = existentes.get(l.data);
        return !e || Math.abs(e.c - l.cotacao_compra) > 5e-5 || Math.abs(e.v - l.cotacao_venda) > 5e-5;
      });
      if (novas.length > 0) {
        const { error } = await admin.from("cotacoes_ptax").upsert(novas, { onConflict: "data" });
        if (error) { logError("Upsert cotacoes_ptax", error); break; }
        total += novas.length;
      }
    }
    inicio = deslocarDias(fim, 1);
  }
  return total;
}

export async function ultimaCotacaoPtax(c: Db): Promise<string | null> {
  const { data } = await c.from("cotacoes_ptax")
    .select("data").order("data", { ascending: false }).limit(1).maybeSingle();
  return (data as { data?: string } | null)?.data ?? null;
}

// Garante a tabela sincronizada: backfill desde o corte quando vazia;
// senão re-busca uma janela recente (trailing 3 dias) até hoje — assim a
// cotação de um lançamento feito "hoje" é atualizada quando o PTAX oficial
// daquele dia é publicado.
export async function garantirSincronizado(c: Db): Promise<void> {
  const hoje = hojeISO();
  const ultima = await ultimaCotacaoPtax(c);
  if (!ultima) { await sincronizarPtax(PTAX_DATA_CORTE, hoje); return; }
  if (ultima < hoje) {
    await sincronizarPtax(maiorData(PTAX_DATA_CORTE, recuarDias(ultima, 3)), hoje);
  }
}

export async function rotaPtax(c: Db, params: URLSearchParams) {
  try { await garantirSincronizado(c); } catch (e) { logError("Sincronizar PTAX", e); }

  const hoje = hojeISO();
  const pedidas = new Set<string>([hoje]);
  for (const d of (params.get("datas") ?? "").split(",")) {
    const t = d.trim();
    if (RE_DATA.test(t)) pedidas.add(t);
  }
  const lista = [...pedidas].sort();
  // `desde` (YYYY-MM-DD) + `serie=1` → devolve também a série diária para o
  // gráfico de evolução. A janela engloba `desde` e a base de 15 dias.
  const desdeSerie = (params.get("desde") ?? "").trim();
  const querSerie  = params.get("serie") === "1" || RE_DATA.test(desdeSerie);
  const baseIni    = recuarDias(lista[0], 15);
  const janelaIni  = RE_DATA.test(desdeSerie) ? menorData(desdeSerie, baseIni) : baseIni;

  const { data } = await c.from("cotacoes_ptax")
    .select("data, cotacao_venda")
    .gte("data", janelaIni).lte("data", hoje)
    .order("data", { ascending: true });
  const rows = (data ?? []) as { data: string; cotacao_venda: number }[];

  const byDate: Record<string, number> = {};
  for (const d of lista) {
    let aplicavel: number | null = null;
    for (const r of rows) { if (r.data <= d) aplicavel = Number(r.cotacao_venda); else break; }
    if (aplicavel != null) byDate[d] = aplicavel;
  }
  const atualRow = rows.length ? rows[rows.length - 1] : null;
  const dados: Record<string, unknown> = {
    byDate,
    atual:      atualRow ? Number(atualRow.cotacao_venda) : null,
    atual_data: atualRow?.data ?? null,
  };
  if (querSerie) {
    const ini = RE_DATA.test(desdeSerie) ? desdeSerie : janelaIni;
    dados.serie = rows.filter((r) => r.data >= ini)
      .map((r) => ({ data: r.data, valor: Number(r.cotacao_venda) }));
  }
  return json({ dados });
}

// POST /investimentos/ptax — sincronização explícita (agendador/cron).
export async function sincronizarPtaxResposta(c: Db) {
  logRequest("POST", "/investimentos/ptax");
  const hoje = hojeISO();
  const ultima = await ultimaCotacaoPtax(c);
  const desde = ultima ? maiorData(PTAX_DATA_CORTE, recuarDias(ultima, 3)) : PTAX_DATA_CORTE;
  const inseridos = await sincronizarPtax(desde, hoje);
  logSuccess("PTAX sincronizado", { desde, ate: hoje, inseridos });
  return json({ dados: { inseridos, desde, ate: hoje } });
}

// ============================================================
// /investimentos/indices — IPCA e SELIC (séries do Banco Central)
//
// Tabela COMPARTILHADA (arqvalor.indices_economicos) sincronizada com o
// SGS/BCB, com data de corte 2020-01. Mesma mecânica do PTAX:
//
//   GET  /investimentos/indices?indices=IPCA,SELIC,CDI&desde=2020-01
//        → { series: { IPCA: [{competencia,valor}], SELIC: [...], CDI: [...] }, ultimo }
//   POST /investimentos/indices  → força sincronização (agendador/cron)
//
// Séries SGS: 433 = IPCA variação mensal (%); 4390 = Selic acum. no mês (%);
// 4391 = CDI acum. no mês (%).
// A cada GET, se vazia faz backfill desde o corte; senão re-busca os últimos
// meses (o BCB pode revisar valores recentes) até o mês corrente.
//
// Leitura via JWT do usuário; gravação via service_role.
// ============================================================

export const INDICES_DATA_CORTE = "2020-01"; // competência mínima (YYYY-MM)
export const RE_COMP = /^\d{4}-(0[1-9]|1[0-2])$/;
export const SGS_SERIES = { IPCA: 433, SELIC: 4390, CDI: 4391 } as const;
export type IndiceNome = keyof typeof SGS_SERIES;
export const INDICES_NOMES = Object.keys(SGS_SERIES) as IndiceNome[];

export const maiorComp = (a: string, b: string) => (a > b ? a : b);
export function recuarMeses(comp: string, n: number): string {
  let [y, m] = comp.split("-").map(Number);
  m -= n;
  while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Busca uma série mensal do SGS na janela [desdeComp .. ateISO]. O SGS
// devolve [{ data: "DD/MM/YYYY", valor: "0,21" }] com data no 1º do mês.
export async function buscarSgsMensal(
  serie: number, desdeComp: string, ateISO: string,
): Promise<{ competencia: string; valor: number }[]> {
  const [ay, am]       = desdeComp.split("-");
  const [fy, fm, fd]   = ateISO.split("-");
  const dataInicial    = `01/${am}/${ay}`;
  const dataFinal      = `${fd}/${fm}/${fy}`;
  const url =
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados` +
    `?formato=json&dataInicial=${dataInicial}&dataFinal=${dataFinal}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`BCB SGS ${serie} respondeu ${res.status}`);
  const arr = await res.json() as { data?: string; valor?: string }[];
  const out: { competencia: string; valor: number }[] = [];
  for (const it of arr ?? []) {
    const mm = String(it.data ?? "").match(/^\d{2}\/(\d{2})\/(\d{4})$/); // DD/MM/YYYY
    if (!mm) continue;
    const valor = Number(String(it.valor ?? "").replace(",", "."));
    if (Number.isFinite(valor)) out.push({ competencia: `${mm[2]}-${mm[1]}`, valor });
  }
  return out;
}

// Sincroniza uma série [desdeComp..ateISO]. Idempotente (upsert pela PK
// composta indice+competencia). Devolve o nº de linhas gravadas.
export async function sincronizarIndice(indice: IndiceNome, desdeComp: string, ateISO: string): Promise<number> {
  let linhas: { competencia: string; valor: number }[];
  try {
    linhas = await buscarSgsMensal(SGS_SERIES[indice], desdeComp, ateISO);
  } catch (e) { logError(`SGS ${indice}`, e); return 0; }
  if (linhas.length === 0) return 0;
  const admin = dbAdmin();
  // O que já está gravado na janela → grava só meses novos ou revisados pelo
  // BCB (e conta só esses), evitando reescrever a série toda a cada sync.
  const { data: existentesData } = await admin.from("indices_economicos")
    .select("competencia, valor").eq("indice", indice).gte("competencia", desdeComp);
  const existentes = new Map<string, number>();
  for (const r of (existentesData ?? []) as { competencia: string; valor: number }[]) {
    existentes.set(r.competencia, Number(r.valor));
  }
  const novas = linhas.filter((l) => {
    const v = existentes.get(l.competencia);
    return v === undefined || Math.abs(v - l.valor) > 5e-7; // novo ou revisado
  });
  if (novas.length === 0) return 0;
  const agora = new Date().toISOString();
  const rows = novas.map((l) => ({ indice, competencia: l.competencia, valor: l.valor, atualizado_em: agora }));
  const { error } = await admin.from("indices_economicos").upsert(rows, { onConflict: "indice,competencia" });
  if (error) { logError(`Upsert indices ${indice}`, error); return 0; }
  return rows.length;
}

export async function ultimaCompetencia(c: Db, indice: IndiceNome): Promise<string | null> {
  const { data } = await c.from("indices_economicos")
    .select("competencia").eq("indice", indice)
    .order("competencia", { ascending: false }).limit(1).maybeSingle();
  return (data as { competencia?: string } | null)?.competencia ?? null;
}

// Backfill desde o corte quando vazia; senão re-busca os 2 últimos meses
// (o BCB revisa valores recentes) até o mês corrente, para cada índice.
export async function garantirIndicesSincronizados(c: Db): Promise<void> {
  const hoje      = hojeISO();
  const compAtual = hoje.slice(0, 7);
  for (const indice of INDICES_NOMES) {
    const ultima = await ultimaCompetencia(c, indice);
    if (!ultima) { await sincronizarIndice(indice, INDICES_DATA_CORTE, hoje); continue; }
    if (ultima < compAtual) {
      await sincronizarIndice(indice, maiorComp(INDICES_DATA_CORTE, recuarMeses(ultima, 1)), hoje);
    }
  }
}

export async function rotaIndices(c: Db, params: URLSearchParams) {
  try { await garantirIndicesSincronizados(c); } catch (e) { logError("Sincronizar índices", e); }

  const pedidos = (params.get("indices") ?? "").split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is IndiceNome => (INDICES_NOMES as string[]).includes(s));
  const nomes = pedidos.length ? [...new Set(pedidos)] : INDICES_NOMES;

  const dParam = (params.get("desde") ?? "").trim();
  const desde  = RE_COMP.test(dParam) ? maiorComp(dParam, INDICES_DATA_CORTE) : INDICES_DATA_CORTE;

  const { data } = await c.from("indices_economicos")
    .select("indice, competencia, valor")
    .in("indice", nomes)
    .gte("competencia", desde)
    .order("competencia", { ascending: true });
  const rows = (data ?? []) as { indice: IndiceNome; competencia: string; valor: number }[];

  const series: Record<string, { competencia: string; valor: number }[]> = {};
  const ultimo: Record<string, { competencia: string; valor: number } | null> = {};
  for (const n of nomes) { series[n] = []; ultimo[n] = null; }
  for (const r of rows) {
    const item = { competencia: r.competencia, valor: Number(r.valor) };
    series[r.indice].push(item);
    ultimo[r.indice] = item; // ordenado asc → último vence
  }
  return json({ dados: { series, ultimo, desde } });
}

// POST /investimentos/indices — sincronização explícita (agendador/cron).
export async function sincronizarIndicesResposta(c: Db) {
  logRequest("POST", "/investimentos/indices");
  const hoje = hojeISO();
  const detalhe: Record<string, number> = {};
  let total = 0;
  // POST explícito sempre rebaixa do corte (série mensal pequena, upsert
  // idempotente) — garante a história completa e fecha eventuais buracos.
  for (const indice of INDICES_NOMES) {
    const n = await sincronizarIndice(indice, INDICES_DATA_CORTE, hoje);
    detalhe[indice] = n; total += n;
  }
  logSuccess("Índices sincronizados", detalhe);
  return json({ dados: { inseridos: total, detalhe } });
}

// ============================================================
// /investimentos/tesouro — marcação a mercado do Tesouro Direto
//
// Tabela COMPARTILHADA (arqvalor.cotacoes_tesouro) com o PU de resgate
// (venda) MENSAL dos títulos prefixados e IPCA+, da fonte oficial Tesouro
// Transparente (dados abertos do STN), com data de corte 2020-01.
//
//   GET  /investimentos/tesouro?desde=2020-01[&tipo=...][&vencimento=YYYY-MM-DD]
//        → { cotacoes: [{ tipo_titulo, vencimento, mes_ano, data_base, pu_venda, taxa_venda }] }
//   POST /investimentos/tesouro  → baixa o CSV do STN e popula o cache mensal
//                                   (operação pesada — só por ação/cron)
//
// O GET é só leitura (não dispara o download); a sincronização é explícita
// via POST. Leitura via JWT; gravação via service_role.
// ============================================================

export const TESOURO_DATA_CORTE = "2020-01"; // competência mínima (YYYY-MM)
// CSV oficial de preços e taxas (todos os títulos, desde 2002).
export const TESOURO_CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/" +
  "resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";
// Famílias com marcação a mercado relevante (prefixado e IPCA+); inclui as
// variações "com Juros Semestrais". Tesouro Selic fica de fora (pós-fixado).
export const TESOURO_FAMILIAS = ["Tesouro Prefixado", "Tesouro IPCA+"];

// "DD/MM/YYYY" → "YYYY-MM-DD" (ou "" se inválido)
export function brDataISO(d: string): string {
  const mm = d.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return mm ? `${mm[3]}-${mm[2]}-${mm[1]}` : "";
}
// "1.234,56" → 1234.56
export function brNumero(s: string): number {
  return Number(String(s ?? "").trim().replace(/\./g, "").replace(",", "."));
}

export interface CotacaoTesouro {
  tipo_titulo: string; vencimento: string; mes_ano: string;
  data_base: string; pu_venda: number; taxa_venda: number | null;
}

// Baixa e processa o CSV em streaming, guardando por (tipo, vencimento, mês)
// a linha do ÚLTIMO dia útil disponível no mês (fechamento). Filtra pelas
// famílias prefixado/IPCA+ e por Data Base >= corte. Mantém um mapa pequeno.
export async function baixarTesouroMensal(desdeComp: string): Promise<CotacaoTesouro[]> {
  const res = await fetch(TESOURO_CSV_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok || !res.body) throw new Error(`Tesouro Transparente respondeu ${res.status}`);

  const reader = res.body.pipeThrough(new TextDecoderStream("latin1")).getReader();
  const mapa = new Map<string, CotacaoTesouro>(); // chave: tipo|venc|mes_ano
  let buf = "";
  let cabecalho = true;

  const processar = (linha: string) => {
    if (!linha) return;
    if (cabecalho) { cabecalho = false; return; }     // pula o header
    const col = linha.split(";");
    if (col.length < 7) return;
    const tipo = col[0].trim();
    if (!TESOURO_FAMILIAS.some((f) => tipo.startsWith(f))) return;
    const venc = brDataISO(col[1]);
    const base = brDataISO(col[2]);
    if (!venc || !base) return;
    const ym = base.slice(0, 7);
    if (ym < desdeComp) return;
    const puVenda = brNumero(col[6]); // PU Venda Manha
    if (!Number.isFinite(puVenda) || puVenda <= 0) return;
    const taxaVenda = brNumero(col[4]);
    const chave = `${tipo}|${venc}|${ym}`;
    const atual = mapa.get(chave);
    if (!atual || base > atual.data_base) {
      mapa.set(chave, {
        tipo_titulo: tipo, vencimento: venc, mes_ano: ym, data_base: base,
        pu_venda: puVenda, taxa_venda: Number.isFinite(taxaVenda) ? taxaVenda : null,
      });
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      processar(buf.slice(0, nl).replace(/\r$/, ""));
      buf = buf.slice(nl + 1);
    }
  }
  processar(buf.replace(/\r$/, ""));
  return [...mapa.values()];
}

// Sincroniza o cache mensal (upsert pela PK tipo_titulo+vencimento+mes_ano).
export async function sincronizarTesouro(desdeComp: string): Promise<number> {
  const linhas = await baixarTesouroMensal(desdeComp);
  if (linhas.length === 0) return 0;
  const admin = dbAdmin();
  const agora = new Date().toISOString();
  let total = 0;
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500).map((l) => ({ ...l, atualizado_em: agora }));
    const { error } = await admin.from("cotacoes_tesouro")
      .upsert(lote, { onConflict: "tipo_titulo,vencimento,mes_ano" });
    if (error) { logError("Upsert cotacoes_tesouro", error); break; }
    total += lote.length;
  }
  return total;
}

export async function rotaTesouro(c: Db, params: URLSearchParams) {
  const dParam = (params.get("desde") ?? "").trim();
  const desde  = RE_COMP.test(dParam) ? maiorComp(dParam, TESOURO_DATA_CORTE) : TESOURO_DATA_CORTE;

  let q = c.from("cotacoes_tesouro")
    .select("tipo_titulo, vencimento, mes_ano, data_base, pu_venda, taxa_venda")
    .gte("mes_ano", desde)
    .order("mes_ano", { ascending: true });
  const tipo = params.get("tipo");
  const venc = params.get("vencimento");
  if (tipo) q = q.eq("tipo_titulo", tipo);
  if (venc && RE_DATA.test(venc)) q = q.eq("vencimento", venc);

  const { data } = await q;
  return json({ dados: { cotacoes: data ?? [] } });
}

// POST /investimentos/tesouro — baixa o CSV do STN e popula (pesado).
export async function sincronizarTesouroResposta() {
  logRequest("POST", "/investimentos/tesouro");
  try {
    const inseridos = await sincronizarTesouro(TESOURO_DATA_CORTE);
    logSuccess("Tesouro sincronizado", { inseridos });
    return json({ dados: { inseridos } });
  } catch (e) {
    logError("Sincronizar Tesouro", e);
    return erro("Falha ao sincronizar Tesouro Direto", 502);
  }
}

// Feed de preços ATUAIS do Tesouro Direto p/ o mês corrente. A antiga API JSON
// da B3 (tesourodireto.com.br/.../treasurybondsinfo.json) foi desativada
// (HTTP 410, mesmo problema já corrigido em buscaTesouro) — reusa o cache em
// memória do CSV do Tesouro Transparente (titulosTesouroAtual, já filtrado
// pela Data Base mais recente), evitando um novo download.
export async function buscarTesouroAtualB3(mesCorrente: string): Promise<CotacaoTesouro[]> {
  const { titulos, maxBase } = await titulosTesouroAtual();
  const out: CotacaoTesouro[] = [];
  for (const t of titulos) {
    if (!TESOURO_FAMILIAS.some((f) => t.tipo.startsWith(f))) continue;
    out.push({
      tipo_titulo: t.tipo, vencimento: t.venc, mes_ano: mesCorrente,
      data_base: maxBase, pu_venda: t.puVenda,
      taxa_venda: Number.isFinite(t.taxaVenda) ? t.taxaVenda : null,
    });
  }
  return out;
}

// Garante o PU do MÊS CORRENTE para os vencimentos informados, revalidando a
// cada COTACAO_STALE_MS (igual ao cache de cotações de ações). Demand-driven:
// só busca o feed da B3 quando algum vencimento está faltando/stale.
export async function garantirTesouroMesCorrente(c: Db, vencimentos: string[], mesCorrente: string): Promise<void> {
  const vencs = [...new Set(vencimentos.filter(Boolean))];
  if (vencs.length === 0) return;
  const limite = new Date(Date.now() - COTACAO_STALE_MS).toISOString();
  const { data } = await c.from("cotacoes_tesouro")
    .select("vencimento").in("vencimento", vencs).eq("mes_ano", mesCorrente).gte("atualizado_em", limite);
  const frescos = new Set((data ?? []).map((r) => String((r as { vencimento: string }).vencimento)));
  if (vencs.every((v) => frescos.has(v))) return; // tudo fresco → nada a fazer
  try {
    const linhas = await buscarTesouroAtualB3(mesCorrente);
    if (linhas.length) {
      const agora = new Date().toISOString();
      const { error } = await dbAdmin().from("cotacoes_tesouro")
        .upsert(linhas.map((l) => ({ ...l, atualizado_em: agora })), { onConflict: "tipo_titulo,vencimento,mes_ano" });
      if (error) logError("Upsert tesouro atual", error);
    }
  } catch (e) { logError("Tesouro B3 atual", e); }
}

// ── Marcação a mercado do Tesouro na valoração de renda fixa ─────
// Família do título (rótulo do STN) conforme o indexador. Só prefixado e
// IPCA+ têm marcação a mercado relevante; demais → null (acúmulo).
export function familiaTesouro(indexador: string | null): string | null {
  if (indexador === "PREFIXADO") return "Tesouro Prefixado";
  if (indexador === "HIBRIDO")   return "Tesouro IPCA+";
  return null;
}

// Carrega o PU (venda) dos vencimentos informados → mapa
// `tipo_titulo|venc` → [{ mes, pu }] ordenado por mês asc.
export type SerieMtM = Map<string, { mes: string; pu: number }[]>;
export async function carregarTesouroMtM(c: Db, vencimentos: string[]): Promise<SerieMtM> {
  const out: SerieMtM = new Map();
  const vencs = [...new Set(vencimentos.filter(Boolean))];
  if (vencs.length === 0) return out;
  const { data } = await c.from("cotacoes_tesouro")
    .select("tipo_titulo, vencimento, mes_ano, pu_venda")
    .in("vencimento", vencs)
    .order("mes_ano", { ascending: true });
  for (const r of (data ?? []) as { tipo_titulo: string; vencimento: string; mes_ano: string; pu_venda: number }[]) {
    const k = `${r.tipo_titulo}|${r.vencimento}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ mes: r.mes_ano, pu: Number(r.pu_venda) });
  }
  return out;
}

// PU de resgate (marcação a mercado) de um título num mês, com fallback para
// o último mês disponível <= alvo. Escolhe entre principal e "com Juros
// Semestrais" pelo nome/ticker do ativo. null → sem MtM (cai p/ acúmulo).
export function puTesouro(
  mtm: SerieMtM, indexador: string | null, venc: string | null, nome: string, mes: string,
): number | null {
  const familia = familiaTesouro(indexador);
  if (!familia || !venc) return null;
  const s = nome.toLowerCase();
  const semestral = /semestr|ntn-?f/.test(s) || (/ntn-?b/.test(s) && !/princ/.test(s));
  const chaves = [...mtm.keys()].filter((k) => {
    const [tt, v] = k.split("|");
    return v === venc && tt.startsWith(familia);
  });
  if (chaves.length === 0) return null;
  const escolha = (semestral
    ? chaves.find((k) => /semestrais/i.test(k))
    : chaves.find((k) => !/semestrais/i.test(k))) ?? chaves[0];
  let pu: number | null = null;
  for (const p of mtm.get(escolha)!) { if (p.mes <= mes) pu = p.pu; else break; }
  return pu;
}

// Série mensal de um índice: 'YYYY-MM' → taxa do mês em decimal (ex.: 0.0107).
export type SerieIndice = Map<string, number>;

// Carrega as séries mensais reais de CDI e IPCA (arqvalor.indices_economicos,
// SGS 4391/433) a partir de `desde`. Garante a sincronização com o BCB antes
// de ler (idempotente). Usadas para acumular a rentabilidade de RF mês a mês
// com a taxa que de fato vigorou — em vez de uma única taxa atual.
export async function carregarIndicesMensais(c: Db, desde: string): Promise<{ cdi: SerieIndice; ipca: SerieIndice }> {
  try { await garantirIndicesSincronizados(c); } catch (e) { logError("Sincronizar índices (RF)", e); }
  const cdi: SerieIndice = new Map();
  const ipca: SerieIndice = new Map();
  const { data } = await c.from("indices_economicos")
    .select("indice, competencia, valor")
    .in("indice", ["CDI", "IPCA"])
    .gte("competencia", desde);
  for (const r of (data ?? []) as { indice: string; competencia: string; valor: number }[]) {
    const v = Number(r.valor) / 100;
    if (!Number.isFinite(v)) continue;
    if (r.indice === "CDI") cdi.set(String(r.competencia), v);
    else if (r.indice === "IPCA") ipca.set(String(r.competencia), v);
  }
  return { cdi, ipca };
}

// Valor acumulado de uma aplicação de RF do aporte até `dataRef`, usando a
// série MENSAL real do indexador (CDI/IPCA de cada mês), com proração por dias
// corridos no 1º e no último mês. Prefixado não depende de série (taxa fixa).
// Mês sem dado (ex.: corrente ainda não publicado) → carry-forward do último
// conhecido; sem série alguma → cai na taxa anual atual (comportamento antigo).
// `datasReset` (opcional, ISO YYYY-MM-DD): datas de cupom semestral pago
// dentro da janela compra→referência — ver comentário de `valorRF` acima.
// Só se aplica de fato à família HIBRIDO (Tesouro IPCA+ com Juros
// Semestrais); passado adiante pro PREFIXADO via `valorRF`; POS_FIXADO
// (Selic) não tem variação com cupom, nunca chega com datasReset preenchido.
export function valorRFAcumulado(
  custo: number, dataCompra: string, dataRef: Date,
  indexador: string | null, taxa: string | null,
  cdiSerie: SerieIndice, ipcaSerie: SerieIndice,
  cdiAtualAa: number, ipcaAtualAa: number,
  datasReset?: string[],
): number {
  const t = String(taxa ?? "");
  // Prefixado / sem indexador: taxa fixa composta nos dias corridos.
  if (indexador === "PREFIXADO" || !indexador) {
    return valorRF(custo, dataCompra, dataRef, primeiraTaxa(t), datasReset);
  }

  let ini = new Date(`${String(dataCompra).slice(0, 10)}T00:00:00Z`).getTime();
  const fim = dataRef.getTime();
  if (!Number.isFinite(ini) || fim <= ini) return custo;
  if (datasReset) {
    for (const d of datasReset) {
      const dt = new Date(`${d}T00:00:00Z`).getTime();
      if (Number.isFinite(dt) && dt > ini && dt <= fim) ini = dt;
    }
  }

  const usaIPCA   = indexador === "HIBRIDO";
  const aditivo   = usaIPCA || (indexador === "POS_FIXADO" && /\+/.test(t));
  const pct       = (indexador === "POS_FIXADO" && !aditivo) ? (primeiraTaxa(t) || 1) : 1;
  const spreadAa  = aditivo ? primeiraTaxa(t.replace(/.*\+/, "")) : 0;
  const spreadMes = spreadAa > 0 ? Math.pow(1 + spreadAa, 1 / 12) - 1 : 0;
  const serie     = usaIPCA ? ipcaSerie : cdiSerie;
  const fallbackMes = Math.pow(1 + Math.max(0, usaIPCA ? ipcaAtualAa : cdiAtualAa), 1 / 12) - 1;

  const chavesOrd = [...serie.keys()].sort();
  const taxaMes = (mesStr: string): number => {
    if (serie.has(mesStr)) return serie.get(mesStr)!;
    let v: number | undefined;
    for (const k of chavesOrd) { if (k <= mesStr) v = serie.get(k); else break; }
    return v ?? fallbackMes;
  };

  let acc = 1;
  let y = new Date(ini).getUTCFullYear();
  let mo = new Date(ini).getUTCMonth(); // 0-based
  const fimY = new Date(fim).getUTCFullYear();
  const fimMo = new Date(fim).getUTCMonth();
  let guard = 0;
  while ((y < fimY || (y === fimY && mo <= fimMo)) && guard++ < 1200) {
    const inicioMes = Date.UTC(y, mo, 1);
    const proxMes   = Date.UTC(y, mo + 1, 1);
    const de  = Math.max(ini, inicioMes);
    const ate = Math.min(fim, proxMes);
    const fracao = Math.max(0, Math.min(1, (ate - de) / (proxMes - inicioMes)));
    if (fracao > 0) {
      const mesStr = `${y}-${String(mo + 1).padStart(2, "0")}`;
      const r = taxaMes(mesStr);
      const fatorMes = aditivo ? (1 + r) * (1 + spreadMes) : (1 + r * pct);
      acc *= Math.pow(fatorMes, fracao);
    }
    mo++; if (mo > 11) { mo = 0; y++; }
  }
  return custo * acc;
}

// Valor de um conjunto de posições de renda fixa num mês: para Tesouro
// prefixado/IPCA+ usa a marcação a mercado escalando o custo pela razão
// PU_alvo / PU_compra (robusto a como a quantidade foi cadastrada); sem PU
// disponível, cai para a acumulação pela série do indexador (valorRFAcumulado).
// `datasResetCupom` (opcional): só entra em jogo nesse fallback — quando o PU
// de marcação a mercado está disponível (caso normal), ele já reflete o preço
// "limpo" pós-cupom sozinho (é cotação real), então o reset é redundante ali.
export function valorRFPosicoes(
  posicoes: { valor_custo: number; data_compra: string }[],
  tipo: string, indexador: string | null, venc: string | null, nome: string,
  mes: string, dataRef: Date,
  taxa: string | null, cdiSerie: SerieIndice, ipcaSerie: SerieIndice,
  cdiAtualAa: number, ipcaAtualAa: number, mtm: SerieMtM,
  datasResetCupom?: string[],
): number {
  // Após o vencimento o título não rende mais (o resgate ocorre ali). Congela
  // a acumulação na data de vencimento — sem isso o valor de um CDB/LCI/LCA
  // cresceria indefinidamente, ignorando o vencimento.
  let ref = dataRef;
  if (venc) {
    const vencMs = new Date(`${venc.slice(0, 10)}T12:00:00Z`).getTime();
    if (Number.isFinite(vencMs) && vencMs < ref.getTime()) ref = new Date(vencMs);
  }
  return posicoes.reduce((soma, p) => {
    if (tipo === "TESOURO_DIRETO") {
      const puAlvo   = puTesouro(mtm, indexador, venc, nome, mes);
      const puCompra = puAlvo != null ? puTesouro(mtm, indexador, venc, nome, p.data_compra.slice(0, 7)) : null;
      if (puAlvo != null && puCompra != null && puCompra > 0) {
        return soma + p.valor_custo * (puAlvo / puCompra);
      }
    }
    return soma + valorRFAcumulado(
      p.valor_custo, p.data_compra, ref, indexador, taxa, cdiSerie, ipcaSerie, cdiAtualAa, ipcaAtualAa, datasResetCupom,
    );
  }, 0);
}
