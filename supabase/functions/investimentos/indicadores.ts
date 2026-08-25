// supabase/functions/investimentos/indicadores.ts
// /investimentos/indicadores — lista pessoal de benchmarks (ETF nacional,
// ETF internacional ou ÍNDICE B3 puro) que o usuário escolhe acompanhar
// na página "Gerenciar dados", ao lado dos indicadores econômicos fixos
// (PTAX/IPCA/SELIC/CDI — ver rotaPtax/rotaIndices em mercado.ts).
//
// Só a LISTA de tickers acompanhados é por usuário (arqvalor.
// inv_indicadores); a cotação em si reaproveita o cache COMPARTILHADO
// (arqvalor.cotacoes_ativos) já usado pelos ativos da carteira — mesma
// fonte (Yahoo/brapi), sem duplicar infraestrutura de busca externa.
//
// ETF/ETF_INTERNACIONAL são negociáveis → descobertos pela MESMA busca
// externa usada ao cadastrar um ativo (GET /investimentos/busca-externa,
// brapi). Um ÍNDICE B3 puro (ex.: SMLL/Small Cap, IBOV/Ibovespa, IFIX) NÃO
// é negociável — não aparece nessa busca (a brapi só lista o que se pode
// comprar) — por isso a lista de índices suportados é CURADA aqui
// (INDICES_B3) em vez de descoberta dinamicamente, e a cotação vem direto
// do símbolo Yahoo mapeado (não do palpite ticker→ticker.SA que
// candidatosTicker faz para ativos — ambíguo demais para índice: "SMLL"
// sozinho já é o ticker de um ETF real nos EUA, então precisa forçar o
// símbolo certo em vez de deixar o resolver de ativo "adivinhar").
//
//   GET    /investimentos/indicadores[?desde=YYYY-MM]
//          → { indicadores: [...], series: { TICKER: [{competencia,valor}] }, ultimo, desde, opcoesIndice }
//   POST   /investimentos/indicadores   { ticker, tipo, nome?, moeda? }
//   DELETE /investimentos/indicadores/:id
import { json, erro, extrairId } from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import { Db, hojeISO } from "./shared.ts";
import { resolverHistoricoCotado, resolverMeta, lerCacheTicker, gravarCache, historicoYahoo } from "./mercado.ts";

export const TIPOS_INDICADOR = ["ETF", "ETF_INTERNACIONAL", "INDICE"];
const CORES_INDICADOR = ["#f97316", "#06b6d4", "#a855f7", "#ec4899", "#84cc16", "#eab308"];
const RE_COMP = /^\d{4}-(0[1-9]|1[0-2])$/;

// Índices B3 suportados: ticker exibido (como o usuário conhece) → símbolo
// Yahoo real usado pra buscar a cotação + nome de exibição. Curada à mão
// (não há busca externa confiável de índice puro — ver comentário acima)
// — ADICIONAR UM NOVO: confirme no Yahoo Finance que "<TICKER>.SA" (ou o
// símbolo certo, se fugir do padrão) resolve pra instrumentType "INDEX" com
// regularMarketPrice, aí acrescente uma linha aqui. Ex.: `curl -A
// "Mozilla/5.0" "https://query1.finance.yahoo.com/v8/finance/chart/
// XXXX.SA?range=5d&interval=1d"`. Índices B3 "oficiais" seguem
// "<CÓDIGO>.SA"; Ibovespa foge disso (usa "^BVSP", convenção Yahoo de
// índice global); índices proprietários de casas (ex.: BTG/TEVA) também
// costumam ter símbolo próprio em ".SA" — vale testar antes de assumir que
// não existe.
export const INDICES_B3: { ticker: string; nome: string; yahoo: string }[] = [
  { ticker: "IBOV", nome: "Ibovespa",                       yahoo: "^BVSP" },
  { ticker: "IBRA", nome: "Índice Brasil Amplo (IBrA)",     yahoo: "IBRA.SA" },
  { ticker: "SMLL", nome: "Índice Small Cap",               yahoo: "SMLL.SA" },
  { ticker: "MLCX", nome: "Índice Mid-Large Cap",           yahoo: "MLCX.SA" },
  { ticker: "IFIX",  nome: "Índice de Fundos Imobiliários", yahoo: "IFIX.SA" },
  { ticker: "IDIV", nome: "Índice Dividendos",              yahoo: "IDIV.SA" },
  { ticker: "ICON", nome: "Índice de Consumo",              yahoo: "ICON.SA" },
  // Índice proprietário BTG Pactual/Teva de fundamentos — seguido pelo ETF AUVP11.
  { ticker: "AUVP", nome: "Índice BTG Pactual Teva Fundamentos (AUVP)", yahoo: "AUVP.SA" },
];
const INDICES_B3_MAP = new Map(INDICES_B3.map((i) => [i.ticker, i]));

// Série mensal de um ÍNDICE B3 (cache compartilhado + Yahoo direto pelo
// símbolo mapeado — sem o palpite multi-candidato de resolverHistoricoCotado,
// que resolveria "SMLL" pro ETF americano homônimo antes de tentar ".SA").
async function resolverHistoricoIndiceB3(
  c: Db, ticker: string, yahooSymbol: string, inicio: string,
): Promise<{ precos: Map<string, number>; moeda: string }> {
  const cache = await lerCacheTicker(c, ticker);
  const maisAntigo = [...cache.precos.keys()].sort()[0];
  if (cache.precos.size > 0 && maisAntigo && maisAntigo <= inicio) {
    return { precos: cache.precos, moeda: cache.moeda || "BRL" };
  }
  const ext = await historicoYahoo(yahooSymbol);
  if (ext.precos.size > 0) {
    await gravarCache([...ext.precos].map(([mes, preco]) => ({ ticker, mes_ano: mes, preco, moeda: "BRL" })));
    for (const [mes, preco] of ext.precos) cache.precos.set(mes, preco);
  }
  return { precos: cache.precos, moeda: cache.moeda || "BRL" };
}

// Competência (YYYY-MM) de N anos atrás — janela padrão da série (mesmo
// horizonte máximo do seletor de período dos cards de indicador no front).
function competenciaHaAnos(anos: number): string {
  const [y, m] = hojeISO().slice(0, 7).split("-").map(Number);
  const total = y * 12 + (m - 1) - anos * 12;
  const yy = Math.floor(total / 12), mm = (total % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

interface Indicador {
  id: string; ticker: string; tipo: string; nome: string; moeda: string;
  cor: string | null; criado_em: string;
}

export async function rotaIndicadores(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "indicadores");

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/indicadores");
    const { data, error } = await c.from("inv_indicadores").select("*").order("criado_em", { ascending: true });
    if (error) { logError("Listar indicadores", error); return erro(error.message); }
    const indicadores = (data ?? []) as Indicador[];

    const dParam = (params.get("desde") ?? "").trim();
    const desde = RE_COMP.test(dParam) ? dParam : competenciaHaAnos(5);

    const series: Record<string, { competencia: string; valor: number }[]> = {};
    const ultimo: Record<string, { competencia: string; valor: number } | null> = {};
    await Promise.all(indicadores.map(async (ind) => {
      // Índice fora da lista curada (não deveria acontecer — POST valida
      // contra INDICES_B3_MAP — mas pode surgir via restore de backup
      // antigo/editado à mão): NÃO cai no resolver de ativo comum, que
      // adivinharia candidatos ambíguos (ex.: "SMLL" resolveria pro ETF
      // americano homônimo) — fica sem série em vez de mostrar preço errado.
      let precos = new Map<string, number>();
      if (ind.tipo === "INDICE") {
        const indiceB3 = INDICES_B3_MAP.get(ind.ticker);
        if (indiceB3) precos = (await resolverHistoricoIndiceB3(c, ind.ticker, indiceB3.yahoo, desde)).precos;
      } else {
        precos = (await resolverHistoricoCotado(c, ind.ticker, ind.moeda, desde)).precos;
      }
      const pontos = [...precos.entries()]
        .filter(([comp]) => comp >= desde)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([competencia, valor]) => ({ competencia, valor }));
      series[ind.ticker] = pontos;
      ultimo[ind.ticker] = pontos.length ? pontos[pontos.length - 1] : null;
    }));

    return json({ dados: { indicadores, series, ultimo, desde, opcoesIndice: INDICES_B3 } });
  }

  if (m === "POST" && !id) {
    const body = await req.json().catch(() => ({}));
    const ticker = String(body?.ticker ?? "").trim().toUpperCase();
    const tipo   = String(body?.tipo ?? "");
    logRequest("POST", "/investimentos/indicadores", { ticker, tipo });
    if (!ticker) return erro("Campo obrigatório: ticker");
    if (!TIPOS_INDICADOR.includes(tipo)) return erro(`tipo inválido: ${TIPOS_INDICADOR.join(" | ")}`);

    let nome  = String(body?.nome ?? "").trim().slice(0, 120);
    let moeda = String(body?.moeda ?? "").trim().toUpperCase().slice(0, 3);

    if (tipo === "INDICE") {
      // Lista fechada — ao contrário de ETF, não há busca externa pra
      // validar um ticker de índice arbitrário (ver comentário no topo).
      const conhecido = INDICES_B3_MAP.get(ticker);
      if (!conhecido) return erro(`Índice não suportado: ${ticker}. Disponíveis: ${INDICES_B3.map((i) => i.ticker).join(", ")}`);
      nome = conhecido.nome; moeda = "BRL"; // nome/moeda vêm da lista curada, não do body
    } else if (!nome || !moeda) {
      const meta = await resolverMeta([{ ticker, tipo_ativo: "ETF" }]);
      const achado = meta.get(ticker);
      if (!nome)  nome  = achado?.nome ?? ticker;
      if (!moeda) moeda = achado?.moeda ?? (tipo === "ETF_INTERNACIONAL" ? "USD" : "BRL");
    }

    const { count } = await c.from("inv_indicadores").select("id", { count: "exact", head: true });
    const cor = CORES_INDICADOR[(count ?? 0) % CORES_INDICADOR.length];

    const { data, error } = await c.from("inv_indicadores")
      .insert({ user_id: userId, ticker, tipo, nome, moeda: moeda || "BRL", cor })
      .select("*").single();
    if (error) {
      if (error.code === "23505") return erro("Esse indicador já está na sua lista.", 409);
      logError("Criar indicador", error); return erro(error.message);
    }
    logSuccess("Indicador criado", { ticker, tipo });
    return json({ dados: data }, 201);
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/indicadores/${id}`);
    const { error, count } = await c.from("inv_indicadores").delete({ count: "exact" }).eq("id", id);
    if (error) { logError("Excluir indicador", error); return erro(error.message); }
    if (!count) return erro("Indicador não encontrado", 404);
    logSuccess("Indicador excluído", { id });
    return json({ dados: { ok: true } });
  }

  return erro("Rota não encontrada", 404);
}
