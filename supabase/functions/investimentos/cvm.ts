// supabase/functions/investimentos/cvm.ts
// Integração com os Informes Mensais de FII e FIAGRO da CVM (dados.cvm.gov.br)
// — única fonte gratuita/sem-chave para o Valor Patrimonial por cota (VP),
// usado no indicador P/VP exibido no quadro de FIIs e na página do ativo.
// Aproveita a mesma passada de download/parse para trazer alguns indicadores
// extras (segmento oficial, mandato, nº de cotistas, DY mensal declarado
// pelo fundo).
//
// Por que não brapi/Yahoo: nenhum dos dois traz fundamentos de FII brasileiro
// (book value por cota não é um campo que existe pra esse tipo de ativo
// nesses provedores). A CVM é o único dado público e OFICIAL disponível.
//
// Por que DUAS fontes (FII + FIAGRO): o app não distingue FIAGRO de FII no
// schema (`tipo_ativo` só tem `FII`), mas a CVM trata como categorias
// SEPARADAS, com datasets, formatos e escalas DIFERENTES — um ticker como
// SNAG11 (fundo agro) não aparece no dataset FII, só no FIAGRO. Descoberto
// ao vivo (set/2026): 12 de 58 FIIs do usuário ficaram "sem_dado" na 1ª
// rodada — pelo menos parte é FIAGRO, não fundo ausente da CVM de verdade.
//
// ── Formato FII (confirmado ao vivo, testando a partir de uma Edge Function
//    — o ambiente de dev local não alcança dados.cvm.gov.br) ──
//   https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_<ANO>.zip
//   ZIP ANUAL, 3 CSVs (";" separador, Latin-1 — NÃO UTF-8):
//     inf_mensal_fii_geral_<ANO>.csv       — CNPJ_Fundo_Classe, Data_Referencia,
//       Versao, Codigo_ISIN, Segmento_Atuacao, Mandato
//     inf_mensal_fii_complemento_<ANO>.csv — CNPJ_Fundo_Classe, Data_Referencia,
//       Versao, Valor_Patrimonial_Cotas, Total_Numero_Cotistas,
//       Percentual_Dividend_Yield_Mes (⚠️ em FRAÇÃO, ex. 0.0084 = 0,84% — ×100 no parse)
//
// ── Formato FIAGRO (idem, confirmado ao vivo) ──
//   https://dados.cvm.gov.br/dados/FIAGRO/DOC/INF_MENSAL/DADOS/inf_mensal_fiagro_<ANOMES>.zip
//   ZIP MENSAL (não anual!) — 1 CSV combinado por mês (geral+complemento
//   juntos, sem split): CNPJ_Classe (⚠️ não "CNPJ_Fundo_Classe"), Data_Referencia,
//   Versao, Codigo_ISIN, Classificacao_Autorregulada (mandato, texto livre —
//   sem equivalente a Segmento_Atuacao), Valor_Patrimonial_Cotas,
//   Numero_Cotistas, Dividend_Yield_Mes (⚠️ JÁ em %, ex. 1.18 = 1,18% — SEM
//   ×100, escala diferente do FII!). Fundos atrasam a entrega ~1 mês — busca
//   os últimos meses disponíveis e funde, pegando o mais recente por fundo.
//
// Ticker → CNPJ (ambas as fontes): a CVM identifica fundos por CNPJ, não pelo
// código de negociação B3. A ponte é o Código ISIN (formato BR<4 letras>CTF
// <dígitos>) — as 4 letras centrais SÃO a raiz do ticker B3 (confirmado:
// BRMXRFCTF008 → MXRF11, BRSNAGCTF000 → SNAG11). Convenção estável,
// coordenada entre B3/CVM/CBLC na emissão do ISIN.
import { json, erro, dbAdmin, autenticarCron } from "../_shared/utils.ts";
import { logRequest, logSuccess, logError } from "../_shared/logger.ts";
import { Db } from "./shared.ts";
// deno-lint-ignore no-external-import
import JSZip from "npm:jszip@3.10.1";

const CVM_FII_BASE    = "https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS";
const CVM_FIAGRO_BASE = "https://dados.cvm.gov.br/dados/FIAGRO/DOC/INF_MENSAL/DADOS";
const DECODER = new TextDecoder("iso-8859-1"); // CSVs da CVM NÃO são UTF-8

interface DadosCvmFii {
  vp:            number;
  mesReferencia: string;       // Data_Referencia, sempre "AAAA-MM-01"
  segmento:      string | null;
  mandato:       string | null;
  numCotistas:   number | null;
  dyMesPct:      number | null; // já convertido pra %, ex.: 0.84
  // De qual dataset da CVM o fundo veio — o app não distingue FIAGRO de FII
  // no schema (tipo_ativo só tem "FII"), mas achado via FIAGRO define a
  // categoria como AGRO com certeza (é a própria definição do dataset),
  // diferente de segmento/mandato, que não têm equivalente confiável lá.
  fonte: 'FII' | 'FIAGRO';
}

export type LinhaCsv = Record<string, string>;

export function parseCsv(texto: string): LinhaCsv[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length < 2) return [];
  const cab = linhas[0].split(";");
  return linhas.slice(1).map((l) => {
    const campos = l.split(";");
    const obj: LinhaCsv = {};
    cab.forEach((c, i) => { obj[c] = campos[i] ?? ""; });
    return obj;
  });
}

// Por chave (campo indicado em `campoChave` — CNPJ para FII/FIAGRO, mas
// serve para qualquer chave de agrupamento — ver uso com Codigo_Negociacao
// em cvmAcoes.ts), mantém só a linha de referência mais recente (maior
// Data_Referencia; empatada, maior Versao — retificação do mesmo mês).
export function maisRecentePorChave(linhas: LinhaCsv[], campoChave: string): Map<string, LinhaCsv> {
  const porChave = new Map<string, LinhaCsv>();
  for (const l of linhas) {
    const chave = l[campoChave];
    if (!chave) continue;
    const atual = porChave.get(chave);
    if (
      !atual ||
      l.Data_Referencia > atual.Data_Referencia ||
      (l.Data_Referencia === atual.Data_Referencia && Number(l.Versao) > Number(atual.Versao))
    ) {
      porChave.set(chave, l);
    }
  }
  return porChave;
}

// Raiz do ticker (sem o sufixo "11") a partir do Código ISIN.
function raizDoIsin(isin: string): string | null {
  const m = /^BR([A-Z0-9]{4})CTF\d+$/.exec(isin ?? "");
  return m ? m[1] : null;
}

function raizDoTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/11$/, "");
}

export async function baixarZip(url: string): Promise<JSZip> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`CVM: HTTP ${res.status} em ${url}`);
  return JSZip.loadAsync(await res.arrayBuffer());
}

export async function lerCsvDoZip(zip: JSZip, nome: string, url: string): Promise<string> {
  const arq = zip.files[nome];
  if (!arq) throw new Error(`CVM: arquivo "${nome}" ausente no ZIP (${url})`);
  return DECODER.decode(await arq.async("uint8array"));
}

// ── FII: ZIP anual, 2 CSVs cruzados por CNPJ ──────────────────────────────
async function buscarDadosFii(ano: number): Promise<Map<string, DadosCvmFii>> {
  const url = `${CVM_FII_BASE}/inf_mensal_fii_${ano}.zip`;
  const zip = await baixarZip(url);
  const geralCsv       = await lerCsvDoZip(zip, `inf_mensal_fii_geral_${ano}.csv`, url);
  const complementoCsv = await lerCsvDoZip(zip, `inf_mensal_fii_complemento_${ano}.csv`, url);

  const geralPorCnpj = maisRecentePorChave(parseCsv(geralCsv), "CNPJ_Fundo_Classe");
  const complPorCnpj = maisRecentePorChave(parseCsv(complementoCsv), "CNPJ_Fundo_Classe");

  const out = new Map<string, DadosCvmFii>();
  for (const [cnpj, geral] of geralPorCnpj) {
    const raiz = raizDoIsin(geral.Codigo_ISIN);
    if (!raiz) continue;
    const compl = complPorCnpj.get(cnpj);
    const vp = Number(compl?.Valor_Patrimonial_Cotas);
    if (!compl || !(vp > 0)) continue; // sem VP não vale a pena guardar a linha
    const dyFracao = Number(compl.Percentual_Dividend_Yield_Mes);
    const cotistas = Number(compl.Total_Numero_Cotistas);
    out.set(raiz, {
      vp,
      mesReferencia: compl.Data_Referencia,
      segmento:    geral.Segmento_Atuacao?.trim() || null,
      mandato:     geral.Mandato?.trim() || null,
      numCotistas: Number.isFinite(cotistas) && cotistas > 0 ? Math.round(cotistas) : null,
      // FII entrega em FRAÇÃO (0.0084 = 0,84%) — converte pra % aqui.
      dyMesPct: Number.isFinite(dyFracao) ? Number((dyFracao * 100).toFixed(4)) : null,
      fonte: 'FII',
    });
  }
  return out;
}

// Nomes dos arquivos .zip mensais disponíveis num diretório "Index of /" da
// CVM, mais recentes primeiro — usado só pra FIAGRO (ZIP é mensal, não anual;
// precisamos descobrir quais meses existem, já que fundos atrasam a entrega).
async function listarZipsMensais(baseUrl: string, prefixo: string): Promise<string[]> {
  const html = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(15000) }).then((r) => r.text());
  const re = new RegExp(`href="(${prefixo}(\\d{6})\\.zip)"`, "g");
  return [...html.matchAll(re)]
    .sort((a, b) => b[2].localeCompare(a[2]))
    .map((m) => m[1]);
}

// ── FIAGRO: ZIPs mensais, 1 CSV combinado por mês — funde os últimos N meses
// disponíveis (fundos atrasam a entrega ~1 mês; pegar só o mais recente
// deixaria de fora qualquer fundo que ainda não reportou aquele mês). ──
async function buscarDadosFiagro(): Promise<Map<string, DadosCvmFii>> {
  const arquivos = (await listarZipsMensais(CVM_FIAGRO_BASE, "inf_mensal_fiagro_")).slice(0, 4);
  const todasLinhas: LinhaCsv[] = [];
  for (const arquivo of arquivos) {
    const anoMes = /(\d{6})\.zip$/.exec(arquivo)?.[1];
    if (!anoMes) continue;
    const url = `${CVM_FIAGRO_BASE}/${arquivo}`;
    try {
      const zip = await baixarZip(url);
      const csv = await lerCsvDoZip(zip, `inf_mensal_fiagro_${anoMes}.csv`, url);
      todasLinhas.push(...parseCsv(csv));
    } catch (e) {
      // Um mês faltando/corrompido não pode derrubar os outros 3.
      logError(`CVM FIAGRO — baixar ${arquivo}`, e);
    }
  }

  const porCnpj = maisRecentePorChave(todasLinhas, "CNPJ_Classe");
  const out = new Map<string, DadosCvmFii>();
  for (const [, l] of porCnpj) {
    const raiz = raizDoIsin(l.Codigo_ISIN);
    if (!raiz) continue;
    const vp = Number(l.Valor_Patrimonial_Cotas);
    if (!(vp > 0)) continue;
    const dyPct = Number(l.Dividend_Yield_Mes);
    const cotistas = Number(l.Numero_Cotistas);
    out.set(raiz, {
      vp,
      mesReferencia: l.Data_Referencia,
      segmento: null, // sem campo equivalente no Informe Mensal de FIAGRO
      // `Classificacao_Autorregulada` NÃO é um "mandato" limpo tipo o do FII
      // (ex.: "Papel") — é uma etiqueta regulatória multi-eixo da ANBIMA
      // (ex.: "Tijolo, Híbrido, Gestão Ativa, Multicategoria" pro SNAG11, um
      // fundo agro — "Tijolo" aí engana), então fica de fora por enquanto.
      mandato: null,
      numCotistas: Number.isFinite(cotistas) && cotistas > 0 ? Math.round(cotistas) : null,
      // FIAGRO já entrega em % de verdade (1.18 = 1,18%) — NÃO multiplica
      // por 100 (escala diferente do FII, confirmado contra dado real).
      dyMesPct: Number.isFinite(dyPct) ? Number(dyPct.toFixed(4)) : null,
      fonte: 'FIAGRO',
    });
  }
  return out;
}

// Cache em memória do processo (instâncias de Edge Function costumam ser
// reaproveitadas entre invocações próximas) — evita rebaixar/parsear tudo a
// cada ativo FII cadastrado em sequência. TTL curto: o dado da CVM não muda
// dentro do mesmo dia, e uma instância fria começa sempre sem cache mesmo.
let cache: { ano: number; mapa: Map<string, DadosCvmFii>; buscadoEm: number } | null = null;

async function mapaCvmAtual(): Promise<Map<string, DadosCvmFii>> {
  const anoAtual = new Date().getUTCFullYear();
  if (cache && cache.ano === anoAtual && Date.now() - cache.buscadoEm < 3_600_000) {
    return cache.mapa;
  }
  const [mapaFii, mapaFiagro] = await Promise.all([
    buscarDadosFii(anoAtual),
    buscarDadosFiagro(),
  ]);
  // FII tem prioridade em caso de colisão de raiz (não deveria acontecer —
  // tickers B3 são únicos — mas não custa deixar determinístico).
  const mapa = new Map([...mapaFiagro, ...mapaFii]);
  cache = { ano: anoAtual, mapa, buscadoEm: Date.now() };
  return mapa;
}

// Busca os dados de 1 ticker — usado no cadastro de um FII novo (best-effort,
// síncrono, mas NUNCA deve travar/quebrar o cadastro do ativo: qualquer falha
// de rede/parse vira null silenciosamente, logada à parte).
export async function buscarDadosCvmPorTicker(ticker: string): Promise<DadosCvmFii | null> {
  try {
    const mapa = await mapaCvmAtual();
    return mapa.get(raizDoTicker(ticker)) ?? null;
  } catch (e) {
    logError("CVM buscarDadosCvmPorTicker", e);
    return null;
  }
}

// JOB semanal (todos os usuários) — protegido por x-cron-secret.
export async function rotaCvmFiiCron(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const naoAutorizado = autenticarCron(req);
  if (naoAutorizado) return naoAutorizado;
  logRequest("POST", "/investimentos/cvm-fii-cron", {});
  const resultado = await atualizarDadosCvmTodosFiis(dbAdmin());
  logSuccess("CVM FII cron", resultado);
  return json({ dados: resultado });
}

interface AtivoFiiLinha {
  id: string;
  ticker: string;
  fii_vp: number | null;
  fii_vp_origem: string | null;
  fii_vp_atualizado_em: string | null;
  fii_segmento: string | null;
  fii_mandato: string | null;
  fii_num_cotistas: number | null;
  fii_dy_mes_cvm: number | null;
  fii_categoria: string | null;
}

export async function atualizarDadosCvmTodosFiis(
  c: Db,
): Promise<{ processados: number; atualizados: number; sem_dado: number }> {
  const mapa = await mapaCvmAtual();
  const { data, error } = await c.from("inv_ativos")
    .select("id, ticker, fii_vp, fii_vp_origem, fii_vp_atualizado_em, fii_segmento, fii_mandato, fii_num_cotistas, fii_dy_mes_cvm, fii_categoria")
    .eq("tipo_ativo", "FII");
  if (error) { logError("CVM cron — listar FIIs", error); throw error; }

  const ativos = (data ?? []) as AtivoFiiLinha[];
  let atualizados = 0, semDado = 0;
  for (const a of ativos) {
    const achado = mapa.get(raizDoTicker(a.ticker));
    if (!achado) { semDado++; continue; }
    // Achado via FIAGRO: categoria É "AGRO" por definição do dataset (não é
    // uma inferência, é literalmente de onde o fundo veio) — sobrescreve
    // OUTRO/vazio. Achado via FII: não mexe na categoria (TIJOLO/PAPEL/FOF/
    // DESENVOLVIMENTO/OUTRO continuam sendo escolha do usuário).
    const categoriaFinal = achado.fonte === "FIAGRO" ? "AGRO" : a.fii_categoria;
    // Já está exatamente igual em TODOS os campos que este cron grava — nada
    // a fazer (idempotente, evita um UPDATE/"updated_at" novo por ativo a
    // cada execução). Compara os indicadores extras também, não só VP/mês/
    // origem — sem isso, uma correção no mapeamento (ex.: mandato errado do
    // FIAGRO) nunca se autocorrigia sozinha em execuções futuras do cron.
    if (
      a.fii_vp === achado.vp && a.fii_vp_atualizado_em === achado.mesReferencia && a.fii_vp_origem === "CVM" &&
      a.fii_segmento === achado.segmento && a.fii_mandato === achado.mandato &&
      a.fii_num_cotistas === achado.numCotistas && a.fii_dy_mes_cvm === achado.dyMesPct &&
      a.fii_categoria === categoriaFinal
    ) {
      continue;
    }
    const { error: errUpd } = await c.from("inv_ativos").update({
      fii_vp: achado.vp, fii_vp_origem: "CVM", fii_vp_atualizado_em: achado.mesReferencia,
      fii_segmento: achado.segmento, fii_mandato: achado.mandato,
      fii_num_cotistas: achado.numCotistas, fii_dy_mes_cvm: achado.dyMesPct,
      fii_categoria: categoriaFinal,
    }).eq("id", a.id);
    if (errUpd) { logError(`CVM cron — atualizar ${a.ticker}`, errUpd); continue; }
    atualizados++;
  }
  return { processados: ativos.length, atualizados, sem_dado: semDado };
}
