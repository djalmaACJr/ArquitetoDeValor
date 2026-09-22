// supabase/functions/investimentos/cvmAcoes.ts
// Fundamentos de companhias abertas (tipo_ativo = ACOES) da CVM
// (dados.cvm.gov.br) para calcular o Valor Justo (fórmula de Graham:
// raiz(22,5 × LPA × VPA)) — mesma fonte oficial/gratuita já usada em cvm.ts
// para o VP de FIIs, mas com datasets diferentes.
//
// ⚠️ Assim como em cvm.ts, o ambiente de dev local não alcança
// dados.cvm.gov.br — a estrutura abaixo segue o formato conhecido e estável
// destes datasets (usado por bibliotecas open-source de dados CVM), mas a
// primeira execução real do cron (só possível a partir de uma Edge Function
// no Supabase) deve ser tratada como verificação ao vivo antes de confiar
// no resultado em produção. Todo o módulo é best-effort: qualquer falha de
// rede/parse é engolida e loga, nunca quebra o cadastro do ativo.
//
// ── FCA (Formulário Cadastral) — ponte ticker → CNPJ ──────────────────────
//   https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_<ANO>.zip
//   ZIP ANUAL → fca_cia_aberta_valor_mobiliario_<ANO>.csv (";" separador,
//   Latin-1): CNPJ_Companhia, Data_Referencia, Versao, Codigo_Negociacao,
//   Mercado. Papel do "Código de Negociação" aqui é o mesmo do ISIN pra FII
//   (cvm.ts) — é a única ponte pública entre o ticker B3 e o CNPJ_CIA usado
//   nos demais datasets da CVM. FCA não traz o Nº TOTAL de ações — esse dado
//   vem do FRE (Formulário de Referência)/dados_cadastrais; como fallback
//   nesta 1ª versão, usamos a Quantidade_Total_Acoes já presente no próprio
//   FCA (seção "Capital Social", arquivo fca_cia_aberta_capital_social_<ANO>.csv,
//   colunas: CNPJ_Companhia, Data_Referencia, Versao, Quantidade_Total_Acoes).
//
// ── DFP (Demonstrações Financeiras Padronizadas) — fundamentos anuais ─────
//   https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_<ANO>.zip
//   ZIP ANUAL, vários CSVs — usamos só 2, sempre CONSOLIDADO (fallback pra
//   INDIVIDUAL se a companhia não publicar consolidado — holding sem
//   subsidiária, por exemplo):
//     dfp_cia_aberta_BPP_con_<ANO>.csv — Balanço Patrimonial Passivo:
//       CD_CONTA "2.03" = Patrimônio Líquido Consolidado
//     dfp_cia_aberta_DRE_con_<ANO>.csv — Demonstração do Resultado:
//       CD_CONTA "3.11" = Lucro/Prejuízo Consolidado do Período
//   Ambos filtrados por ORDEM_EXERC = "ÚLTIMO" (a CVM também reporta o
//   exercício anterior na mesma linha de comparação — "PENÚLTIMO" — que
//   descartamos). Chave de linha única: CNPJ_CIA + CD_CONTA (cada empresa
//   tem 1 linha por conta no mesmo CSV).
//
// Fundamentos ANUAIS (não trimestrais/ITR) deliberadamente: LPA/VPA mudam no
// máximo 1x/ano por empresa, e evita reconstruir período acumulado do ITR
// (risco de bug de escala — mesmo tipo que já aconteceu com o DY do FIAGRO
// em cvm.ts).
import { json, erro, dbAdmin, autenticarCron } from "../_shared/utils.ts";
import { logRequest, logSuccess, logError } from "../_shared/logger.ts";
import { Db } from "./shared.ts";
import { parseCsv, maisRecentePorChave, baixarZip, lerCsvDoZip, type LinhaCsv } from "./cvm.ts";

const CVM_FCA_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS";
const CVM_DFP_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS";

interface FundamentosAcao {
  lpa:        number | null; // Lucro por Ação
  vpa:        number | null; // Valor Patrimonial por Ação
  valorJusto: number | null; // raiz(22,5 × LPA × VPA) — null se LPA/VPA <= 0
  exercicio:  string;        // "AAAA-12-31" (fim do exercício anual usado)
}

function raizDoTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\d+$/, "");
}

// Fórmula de Graham — reusada tanto pelo cron (fundamentos da CVM) quanto
// pelo cadastro/edição manual em ativos.ts, pra nunca haver 2 jeitos de
// calcular a mesma coisa divergindo. null se LPA/VPA <= 0 (não se aplica a
// empresa no prejuízo/patrimônio líquido negativo).
export function calcularValorJustoGraham(lpa: number | null | undefined, vpa: number | null | undefined): number | null {
  if (typeof lpa !== "number" || typeof vpa !== "number" || !(lpa > 0) || !(vpa > 0)) return null;
  return Math.sqrt(22.5 * lpa * vpa);
}

// ── FCA: ticker-raiz → CNPJ_CIA + nº total de ações ───────────────────────
async function buscarFcaDoAno(ano: number): Promise<{ tickerParaCnpj: Map<string, string>; acoesPorCnpj: Map<string, number> }> {
  const url = `${CVM_FCA_BASE}/fca_cia_aberta_${ano}.zip`;
  const zip = await baixarZip(url);
  const valorMobCsv = await lerCsvDoZip(zip, `fca_cia_aberta_valor_mobiliario_${ano}.csv`, url);
  const capitalCsv  = await lerCsvDoZip(zip, `fca_cia_aberta_capital_social_${ano}.csv`, url);

  // Só ações negociadas em bolsa (Mercado = "Bolsa") — dedup por Código de
  // Negociação, mantendo a linha mais recente (mesma retificação do FII).
  const valorMobPorTicker = maisRecentePorChave(
    parseCsv(valorMobCsv).filter((l) => (l.Mercado ?? "").trim().toUpperCase() === "BOLSA" && l.Codigo_Negociacao),
    "Codigo_Negociacao",
  );
  const tickerParaCnpj = new Map<string, string>();
  for (const [ticker, l] of valorMobPorTicker) {
    if (l.CNPJ_Companhia) tickerParaCnpj.set(raizDoTicker(ticker), l.CNPJ_Companhia);
  }

  const capitalPorCnpj = maisRecentePorChave(parseCsv(capitalCsv), "CNPJ_Companhia");
  const acoesPorCnpj = new Map<string, number>();
  for (const [cnpj, l] of capitalPorCnpj) {
    const qtd = Number(l.Quantidade_Total_Acoes);
    if (Number.isFinite(qtd) && qtd > 0) acoesPorCnpj.set(cnpj, qtd);
  }
  return { tickerParaCnpj, acoesPorCnpj };
}

// ── DFP: CNPJ_CIA → Patrimônio Líquido (2.03) + Lucro Líquido (3.11) ──────
function extrairContaPorCnpj(linhas: LinhaCsv[], codigoConta: string): Map<string, { valor: number; dtFimExercicio: string; versao: number }> {
  const out = new Map<string, { valor: number; dtFimExercicio: string; versao: number }>();
  for (const l of linhas) {
    if (l.CD_CONTA !== codigoConta || l.ORDEM_EXERC !== "ÚLTIMO") continue;
    const valor = Number(l.VL_CONTA);
    if (!l.CNPJ_CIA || !Number.isFinite(valor)) continue;
    const dtFimExercicio = l.DT_FIM_EXERC ?? "";
    const versao = Number(l.VERSAO) || 0;
    // Mantém o exercício mais recente; empatado, a maior VERSAO (retificação).
    const atual = out.get(l.CNPJ_CIA);
    if (atual && (atual.dtFimExercicio > dtFimExercicio || (atual.dtFimExercicio === dtFimExercicio && atual.versao >= versao))) continue;
    out.set(l.CNPJ_CIA, { valor, dtFimExercicio, versao });
  }
  return out;
}

async function buscarDfpDoAno(ano: number): Promise<{ pl: Map<string, { valor: number; dtFimExercicio: string }>; lucro: Map<string, { valor: number; dtFimExercicio: string }> }> {
  const url = `${CVM_DFP_BASE}/dfp_cia_aberta_${ano}.zip`;
  const zip = await baixarZip(url);
  // Consolidado primeiro; fallback pra individual quando a empresa não tem
  // subsidiária (arquivo _ind_ sempre existe no ZIP, ainda que vazio pra
  // quem só publica consolidado).
  const [bppCon, breCon, bppInd, dreInd] = await Promise.all([
    lerCsvDoZip(zip, `dfp_cia_aberta_BPP_con_${ano}.csv`, url).then(parseCsv),
    lerCsvDoZip(zip, `dfp_cia_aberta_DRE_con_${ano}.csv`, url).then(parseCsv),
    lerCsvDoZip(zip, `dfp_cia_aberta_BPP_ind_${ano}.csv`, url).then(parseCsv),
    lerCsvDoZip(zip, `dfp_cia_aberta_DRE_ind_${ano}.csv`, url).then(parseCsv),
  ]);

  const plCon    = extrairContaPorCnpj(bppCon, "2.03");
  const lucroCon = extrairContaPorCnpj(breCon, "3.11");
  const plInd    = extrairContaPorCnpj(bppInd, "2.03");
  const lucroInd = extrairContaPorCnpj(dreInd, "3.11");

  // Funde: consolidado tem prioridade, individual só entra pra CNPJ ausente
  // no consolidado.
  const pl = new Map(plCon);
  for (const [cnpj, v] of plInd) if (!pl.has(cnpj)) pl.set(cnpj, v);
  const lucro = new Map(lucroCon);
  for (const [cnpj, v] of lucroInd) if (!lucro.has(cnpj)) lucro.set(cnpj, v);
  return { pl, lucro };
}

// Cache em memória do processo (mesmo TTL/motivo de cvm.ts) — datasets de
// TODAS as ~450 companhias abertas, não vale a pena rebaixar por ativo.
let cache: { ano: number; fca: Awaited<ReturnType<typeof buscarFcaDoAno>>; dfp: Awaited<ReturnType<typeof buscarDfpDoAno>>; buscadoEm: number } | null = null;

async function mapasCvmAtual() {
  const anoAtual = new Date().getUTCFullYear();
  // DFP do exercício ANTERIOR: o exercício corrente só fecha em 31/12 e a
  // empresa tem até ~3 meses (prazo CVM) pra publicar — o DFP do ano
  // corrente-1 é o mais recente sempre disponível o ano inteiro. FCA (dados
  // cadastrais) já é do ano corrente, atualizado continuamente.
  const anoDfp = anoAtual - 1;
  if (cache && cache.ano === anoAtual && Date.now() - cache.buscadoEm < 3_600_000) {
    return cache;
  }
  const [fca, dfp] = await Promise.all([
    buscarFcaDoAno(anoAtual).catch((e) => { logError("CVM FCA — buscar", e); return { tickerParaCnpj: new Map(), acoesPorCnpj: new Map() }; }),
    buscarDfpDoAno(anoDfp).catch((e) => { logError("CVM DFP — buscar", e); return { pl: new Map(), lucro: new Map() }; }),
  ]);
  cache = { ano: anoAtual, fca, dfp, buscadoEm: Date.now() };
  return cache;
}

// Busca fundamentos de 1 ticker — usado no cadastro de uma ação nova
// (best-effort, síncrono, nunca deve travar/quebrar o cadastro: qualquer
// falha de rede/parse vira null silenciosamente, logada à parte).
export async function buscarFundamentosPorTicker(ticker: string): Promise<FundamentosAcao | null> {
  try {
    const { fca, dfp } = await mapasCvmAtual();
    const cnpj = fca.tickerParaCnpj.get(raizDoTicker(ticker));
    if (!cnpj) return null;
    const nAcoes = fca.acoesPorCnpj.get(cnpj);
    const pl    = dfp.pl.get(cnpj);
    const lucro = dfp.lucro.get(cnpj);
    if (!nAcoes || !(nAcoes > 0) || !pl || !lucro) return null;
    const lpa = lucro.valor / nAcoes;
    const vpa = pl.valor / nAcoes;
    return { lpa, vpa, valorJusto: calcularValorJustoGraham(lpa, vpa), exercicio: pl.dtFimExercicio || lucro.dtFimExercicio };
  } catch (e) {
    logError("CVM buscarFundamentosPorTicker", e);
    return null;
  }
}

// JOB mensal (todos os usuários) — protegido por x-cron-secret.
export async function rotaCvmAcoesCron(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const naoAutorizado = autenticarCron(req);
  if (naoAutorizado) return naoAutorizado;
  logRequest("POST", "/investimentos/cvm-acoes-cron", {});
  const resultado = await atualizarFundamentosTodasAcoes(dbAdmin());
  logSuccess("CVM Ações cron", resultado);
  return json({ dados: resultado });
}

interface AtivoAcaoLinha {
  id: string;
  ticker: string;
  acao_lpa: number | null;
  acao_vpa: number | null;
  acao_valor_justo: number | null;
  acao_fundamentos_origem: string | null;
  acao_fundamentos_referencia: string | null;
}

export async function atualizarFundamentosTodasAcoes(
  c: Db,
): Promise<{ processados: number; atualizados: number; sem_dado: number }> {
  const { fca, dfp } = await mapasCvmAtual();
  const { data, error } = await c.from("inv_ativos")
    .select("id, ticker, acao_lpa, acao_vpa, acao_valor_justo, acao_fundamentos_origem, acao_fundamentos_referencia")
    .eq("tipo_ativo", "ACOES");
  if (error) { logError("CVM cron — listar ações", error); throw error; }

  const ativos = (data ?? []) as AtivoAcaoLinha[];
  let atualizados = 0, semDado = 0;
  for (const a of ativos) {
    const cnpj = fca.tickerParaCnpj.get(raizDoTicker(a.ticker));
    const nAcoes = cnpj ? fca.acoesPorCnpj.get(cnpj) : undefined;
    const pl    = cnpj ? dfp.pl.get(cnpj)    : undefined;
    const lucro = cnpj ? dfp.lucro.get(cnpj) : undefined;
    if (!cnpj || !nAcoes || !(nAcoes > 0) || !pl || !lucro) { semDado++; continue; }

    const lpa = lucro.valor / nAcoes;
    const vpa = pl.valor / nAcoes;
    const valorJusto = calcularValorJustoGraham(lpa, vpa);
    const exercicio = pl.dtFimExercicio || lucro.dtFimExercicio || null;

    // Idempotente: já está exatamente igual — nada a fazer.
    if (
      a.acao_lpa === lpa && a.acao_vpa === vpa && a.acao_valor_justo === valorJusto &&
      a.acao_fundamentos_origem === "CVM" && a.acao_fundamentos_referencia === exercicio
    ) {
      continue;
    }
    const { error: errUpd } = await c.from("inv_ativos").update({
      acao_lpa: lpa, acao_vpa: vpa, acao_valor_justo: valorJusto,
      acao_fundamentos_origem: "CVM", acao_fundamentos_referencia: exercicio,
    }).eq("id", a.id);
    if (errUpd) { logError(`CVM cron — atualizar ${a.ticker}`, errUpd); continue; }
    atualizados++;
  }
  return { processados: ativos.length, atualizados, sem_dado: semDado };
}
