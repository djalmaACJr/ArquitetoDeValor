// supabase/functions/investimentos/cvmAcoes.ts
// Fundamentos de companhias abertas (tipo_ativo = ACOES) da CVM
// (dados.cvm.gov.br) para calcular LPA, VPA e o Valor Justo (fórmula de Graham:
// raiz(22,5 × LPA × VPA)). O CÁLCULO em si é puro e vive em `fundamentosAcao.ts`
// (testável sem rede); aqui ficam só os downloads e o cron.
//
// Módulo best-effort: qualquer falha de rede/parse é engolida e logada, nunca
// quebra o cadastro do ativo.
//
// 🔧 v7.8.0 — REVISÃO DO CÁLCULO (auditoria nov/2026 com dados reais): o Valor
// Justo saía ~1000× menor (PETR4 = R$ 0,08) porque `VL_CONTA` vem em MIL
// (coluna ESCALA_MOEDA) e não era escalado; além disso usava lucro/PL
// consolidados (com minoritários), código de conta fixo (bancos têm outro plano
// de contas), só o exercício anual e ações sem descontar tesouraria. Ver o
// topo de `fundamentosAcao.ts`. Units (ticker "…11") não são calculadas.
//
// ── FCA (Formulário Cadastral) — ponte ticker → CNPJ ──────────────────────
//   https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_<ANO>.zip
//   → fca_cia_aberta_valor_mobiliario_<ANO>.csv (";" separador, Latin-1):
//   CNPJ_Companhia, Data_Referencia, Versao, Codigo_Negociacao, Mercado. É a
//   única ponte pública entre o ticker B3 e o CNPJ_CIA dos demais datasets.
//
// ── FRE (Formulário de Referência) — nº total de ações ────────────────────
//   https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FRE/DADOS/fre_cia_aberta_<ANO>.zip
//   → fre_cia_aberta_capital_social_<ANO>.csv: filtramos Tipo_Capital =
//   "Capital Emitido" (o "Autorizado" é só um teto estatutário). Sempre em
//   unidades (confirmado contra o BB, ~5,73 bi). A seção "Capital Social" do
//   FCA foi removida pela CVM (out/2026), por isso vem do FRE.
//   O ZIP do FRE tem outros CSVs úteis ainda não usados (free float, posição
//   acionária, partes relacionadas) — avaliar com o usuário antes de expandir.
//
// ── DFP / ITR — demonstrações (CONSOLIDADO; fallback INDIVIDUAL) ───────────
//   .../DFP/DADOS/dfp_cia_aberta_<ANO>.zip (exercício anual, ano-1) e
//   .../ITR/DADOS/itr_cia_aberta_<ANO>.zip (trimestres do ano corrente), com
//   DRE_con/BPP_con (e _ind) e composicao_capital. CSVs grandes (ITR BPP ~56 MB):
//   lidos em blocos e filtrados pelos CNPJs que interessam, para caber na
//   memória da Edge Function.
import { json, erro, dbAdmin, autenticarCron } from "../_shared/utils.ts";
import { logRequest, logSuccess, logError } from "../_shared/logger.ts";
import { Db } from "./shared.ts";
import { parseCsv, maisRecentePorChave, baixarZip, lerCsvDoZip, type LinhaCsv } from "./cvm.ts";
import type JSZip from "npm:jszip@3.10.1";
import {
  acoesLiquidas, calcularFundamentos, calcularValorJustoGraham as graham, ehUnit,
} from "./fundamentosAcao.ts";

// Reexportado: ativos.ts calcula o Valor Justo do cadastro manual com a MESMA fórmula.
export const calcularValorJustoGraham = graham;

const CVM_FCA_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS";
const CVM_DFP_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS";
const CVM_ITR_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS";
const TIPO_CAPITAL_EMITIDO = "Capital Emitido";

interface FundamentosAcao {
  lpa:        number | null; // Lucro por Ação (últimos 12 meses, atribuído aos controladores)
  vpa:        number | null; // Valor Patrimonial por Ação (controladores)
  valorJusto: number | null; // raiz(22,5 × LPA × VPA) — null se LPA/VPA <= 0
  exercicio:  string;        // data-base (fim do último trimestre/exercício usado), "AAAA-MM-DD"
}

function raizDoTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\d+$/, "");
}

// ── FCA: ticker-raiz → CNPJ_CIA ───────────────────────────────────────────
async function buscarFcaDoAno(ano: number): Promise<Map<string, string>> {
  const url = `${CVM_FCA_BASE}/fca_cia_aberta_${ano}.zip`;
  const zip = await baixarZip(url);
  const valorMobCsv = await lerCsvDoZip(zip, `fca_cia_aberta_valor_mobiliario_${ano}.csv`, url);
  // Só ações negociadas em bolsa; dedup por Código de Negociação (linha mais recente).
  const porTicker = maisRecentePorChave(
    parseCsv(valorMobCsv).filter((l) => (l.Mercado ?? "").trim().toUpperCase() === "BOLSA" && l.Codigo_Negociacao),
    "Codigo_Negociacao",
  );
  const tickerParaCnpj = new Map<string, string>();
  for (const [ticker, l] of porTicker) {
    if (l.CNPJ_Companhia) tickerParaCnpj.set(raizDoTicker(ticker), l.CNPJ_Companhia);
  }
  return tickerParaCnpj;
}

// ── FRE: CNPJ_CIA → nº total de ações emitidas ────────────────────────────
async function buscarCapitalSocialFre(ano: number): Promise<Map<string, number>> {
  const url = `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FRE/DADOS/fre_cia_aberta_${ano}.zip`;
  const zip = await baixarZip(url);
  const csv = await lerCsvDoZip(zip, `fre_cia_aberta_capital_social_${ano}.csv`, url);
  const linhasEmitido = parseCsv(csv).filter((l) => (l.Tipo_Capital ?? "").trim() === TIPO_CAPITAL_EMITIDO);
  const porCnpj = maisRecentePorChave(linhasEmitido, "CNPJ_Companhia");
  const acoesPorCnpj = new Map<string, number>();
  for (const [cnpj, l] of porCnpj) {
    const qtd = Number(l.Quantidade_Total_Acoes);
    if (Number.isFinite(qtd) && qtd > 0) acoesPorCnpj.set(cnpj, qtd);
  }
  return acoesPorCnpj;
}

// ── Leitura em blocos de CSV grande, só das linhas dos CNPJs de interesse ─
// A 1ª coluna dos CSVs de demonstrações/composição é sempre o CNPJ (18 chars).
const DECODER_LATIN1 = "iso-8859-1";
const BLOCO = 4 * 1024 * 1024;

async function lerLinhasDosCnpjs(zip: JSZip, nome: string, cnpjs: Set<string>): Promise<LinhaCsv[]> {
  const arq = zip.files[nome];
  if (!arq) return [];
  const bytes = await arq.async("uint8array");
  const dec = new TextDecoder(DECODER_LATIN1);
  let cab: string[] | null = null;
  let resto = "";
  const out: LinhaCsv[] = [];
  const processar = (linha: string) => {
    const l = linha.endsWith("\r") ? linha.slice(0, -1) : linha;
    if (!l) return;
    if (!cab) { cab = l.split(";"); return; }
    if (!cnpjs.has(l.slice(0, 18))) return;
    const campos = l.split(";");
    const o: LinhaCsv = {};
    cab.forEach((c, i) => { o[c] = campos[i] ?? ""; });
    out.push(o);
  };
  for (let i = 0; i < bytes.length; i += BLOCO) {
    const texto = resto + dec.decode(bytes.subarray(i, i + BLOCO), { stream: true });
    const linhas = texto.split("\n");
    resto = linhas.pop() ?? "";
    for (const l of linhas) processar(l);
  }
  processar(resto + dec.decode());
  return out;
}

// Consolidado primeiro; as empresas SEM nenhuma linha no consolidado (holding
// sem subsidiárias) caem para o individual.
async function lerDemonstracao(zip: JSZip, prefixo: string, ano: number, cnpjs: Set<string>): Promise<LinhaCsv[]> {
  const con = await lerLinhasDosCnpjs(zip, `${prefixo}_con_${ano}.csv`, cnpjs);
  const tem = new Set(con.map((l) => l.CNPJ_CIA));
  const faltam = new Set([...cnpjs].filter((c) => !tem.has(c)));
  if (faltam.size === 0) return con;
  return [...con, ...await lerLinhasDosCnpjs(zip, `${prefixo}_ind_${ano}.csv`, faltam)];
}

interface DadosEmpresa {
  dfpDre: LinhaCsv[]; itrDre: LinhaCsv[]; bppItr: LinhaCsv[]; bppDfp: LinhaCsv[];
  comp: LinhaCsv | undefined;
}

const porCnpj = (linhas: LinhaCsv[]) => {
  const m = new Map<string, LinhaCsv[]>();
  for (const l of linhas) { const a = m.get(l.CNPJ_CIA); if (a) a.push(l); else m.set(l.CNPJ_CIA, [l]); }
  return m;
};

// composição: a mais recente por CNPJ (maior DT_REFER; empate, maior VERSAO).
function composicaoMaisRecente(linhas: LinhaCsv[]): Map<string, LinhaCsv> {
  const m = new Map<string, LinhaCsv>();
  for (const l of linhas) {
    const a = m.get(l.CNPJ_CIA);
    if (!a || l.DT_REFER > a.DT_REFER || (l.DT_REFER === a.DT_REFER && Number(l.VERSAO) > Number(a.VERSAO))) m.set(l.CNPJ_CIA, l);
  }
  return m;
}

// Baixa DFP (ano-1; ano-2 se ainda não publicado) e ITR (ano corrente; ausente
// em jan–abr) e devolve os dados só dos CNPJs pedidos. Sequencial (1 ZIP grande
// por vez) — ver nota do WORKER_RESOURCE_LIMIT em mapasBase().
async function carregarDadosEmpresas(cnpjs: Set<string>): Promise<Map<string, DadosEmpresa>> {
  const anoAtual = new Date().getUTCFullYear();
  const resultado = new Map<string, DadosEmpresa>();
  for (const c of cnpjs) resultado.set(c, { dfpDre: [], itrDre: [], bppItr: [], bppDfp: [], comp: undefined });

  let compDfp = new Map<string, LinhaCsv>();
  for (const anoDfp of [anoAtual - 1, anoAtual - 2]) {
    try {
      const urlDfp = `${CVM_DFP_BASE}/dfp_cia_aberta_${anoDfp}.zip`;
      const zip = await baixarZip(urlDfp);
      const dre = porCnpj(await lerDemonstracao(zip, `dfp_cia_aberta_DRE`, anoDfp, cnpjs));
      const bpp = porCnpj(await lerDemonstracao(zip, `dfp_cia_aberta_BPP`, anoDfp, cnpjs));
      compDfp = composicaoMaisRecente(await lerLinhasDosCnpjs(zip, `dfp_cia_aberta_composicao_capital_${anoDfp}.csv`, cnpjs));
      for (const [c, d] of resultado) { d.dfpDre = dre.get(c) ?? []; d.bppDfp = bpp.get(c) ?? []; }
      break;
    } catch (e) { logError(`CVM DFP ${anoDfp} — buscar`, e); }
  }

  let compItr = new Map<string, LinhaCsv>();
  try {
    const zip = await baixarZip(`${CVM_ITR_BASE}/itr_cia_aberta_${anoAtual}.zip`);
    const dre = porCnpj(await lerDemonstracao(zip, `itr_cia_aberta_DRE`, anoAtual, cnpjs));
    const bpp = porCnpj(await lerDemonstracao(zip, `itr_cia_aberta_BPP`, anoAtual, cnpjs));
    compItr = composicaoMaisRecente(await lerLinhasDosCnpjs(zip, `itr_cia_aberta_composicao_capital_${anoAtual}.csv`, cnpjs));
    for (const [c, d] of resultado) { d.itrDre = dre.get(c) ?? []; d.bppItr = bpp.get(c) ?? []; }
  } catch (e) { logError(`CVM ITR ${anoAtual} — buscar (normal em jan–abr)`, e); }

  for (const [c, d] of resultado) {
    const i = compItr.get(c), a = compDfp.get(c);
    d.comp = i && (!a || i.DT_REFER >= a.DT_REFER) ? i : a;
  }
  return resultado;
}

// Cache em memória do processo (TTL 1h) das tabelas pequenas ticker→CNPJ e
// CNPJ→ações; as demonstrações são lidas sob demanda por conjunto de CNPJs.
let cacheBase: { ano: number; tickerParaCnpj: Map<string, string>; acoesPorCnpj: Map<string, number>; buscadoEm: number } | null = null;

// Sequencial, não Promise.all — achado real (out/2026): baixar+descompactar
// os ZIPs da CVM AO MESMO TEMPO estourava o limite de memória/CPU da Edge
// Function (WORKER_RESOURCE_LIMIT).
async function mapasBase() {
  const anoAtual = new Date().getUTCFullYear();
  if (cacheBase && cacheBase.ano === anoAtual && Date.now() - cacheBase.buscadoEm < 3_600_000) return cacheBase;
  const tickerParaCnpj = await buscarFcaDoAno(anoAtual).catch((e) => { logError("CVM FCA — buscar", e); return new Map<string, string>(); });
  const acoesPorCnpj = await buscarCapitalSocialFre(anoAtual).catch((e) => { logError("CVM FRE capital social — buscar", e); return new Map<string, number>(); });
  cacheBase = { ano: anoAtual, tickerParaCnpj, acoesPorCnpj, buscadoEm: Date.now() };
  return cacheBase;
}

function fundamentosDe(d: DadosEmpresa, acoesFre: number | undefined): FundamentosAcao | null {
  const r = calcularFundamentos({
    dfpDre: d.dfpDre, itrDre: d.itrDre, bppItr: d.bppItr, bppDfp: d.bppDfp,
    acoes: acoesLiquidas(acoesFre, d.comp),
  });
  return r ? { lpa: r.lpa, vpa: r.vpa, valorJusto: r.valorJusto, exercicio: r.referencia } : null;
}

// Busca fundamentos de 1 ticker — usado no cadastro de uma ação nova
// (best-effort: qualquer falha vira null, logada à parte). Units → null.
export async function buscarFundamentosPorTicker(ticker: string): Promise<FundamentosAcao | null> {
  try {
    if (ehUnit(ticker)) return null;
    const { tickerParaCnpj, acoesPorCnpj } = await mapasBase();
    const cnpj = tickerParaCnpj.get(raizDoTicker(ticker));
    if (!cnpj) return null;
    const dados = (await carregarDadosEmpresas(new Set([cnpj]))).get(cnpj);
    return dados ? fundamentosDe(dados, acoesPorCnpj.get(cnpj)) : null;
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
  const { data, error } = await c.from("inv_ativos")
    .select("id, ticker, acao_lpa, acao_vpa, acao_valor_justo, acao_fundamentos_origem, acao_fundamentos_referencia")
    .eq("tipo_ativo", "ACOES");
  if (error) { logError("CVM cron — listar ações", error); throw error; }
  const ativos = (data ?? []) as AtivoAcaoLinha[];
  if (ativos.length === 0) return { processados: 0, atualizados: 0, sem_dado: 0 };

  const { tickerParaCnpj, acoesPorCnpj } = await mapasBase();
  const cnpjs = new Set<string>();
  for (const a of ativos) {
    const cnpj = ehUnit(a.ticker) ? undefined : tickerParaCnpj.get(raizDoTicker(a.ticker));
    if (cnpj) cnpjs.add(cnpj);
  }
  const dados = cnpjs.size > 0 ? await carregarDadosEmpresas(cnpjs) : new Map<string, DadosEmpresa>();

  let atualizados = 0, semDado = 0;
  for (const a of ativos) {
    const cnpj = ehUnit(a.ticker) ? undefined : tickerParaCnpj.get(raizDoTicker(a.ticker));
    const f = cnpj && dados.get(cnpj) ? fundamentosDe(dados.get(cnpj)!, acoesPorCnpj.get(cnpj)) : null;
    if (!f) { semDado++; continue; }

    // Idempotente: já está exatamente igual — nada a fazer.
    if (
      a.acao_lpa === f.lpa && a.acao_vpa === f.vpa && a.acao_valor_justo === f.valorJusto &&
      a.acao_fundamentos_origem === "CVM" && a.acao_fundamentos_referencia === f.exercicio
    ) continue;

    const { error: errUpd } = await c.from("inv_ativos").update({
      acao_lpa: f.lpa, acao_vpa: f.vpa, acao_valor_justo: f.valorJusto,
      acao_fundamentos_origem: "CVM", acao_fundamentos_referencia: f.exercicio,
    }).eq("id", a.id);
    if (errUpd) { logError(`CVM cron — atualizar ${a.ticker}`, errUpd); continue; }
    atualizados++;
  }
  return { processados: ativos.length, atualizados, sem_dado: semDado };
}
