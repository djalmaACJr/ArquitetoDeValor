// supabase/functions/investimentos/resultadosEmpresas.ts
//
// Análise de resultados de empresas — Ações BR e Stocks/REITs dos EUA (v7.8.0).
// Generaliza `relatoriosFii.ts` (FIIs) para os outros tipos de ativo que têm
// divulgação periódica gratuita e estruturada:
//
//   • STOCKS / REIT → EDGAR (SEC): 10-Q e 10-K. `company_tickers.json` mapeia
//     ticker→CIK; `submissions/CIK….json` lista os envios; o HTML do documento
//     vira texto e só a seção MD&A (Management's Discussion and Analysis) vai
//     para a IA. A SEC exige contato no User-Agent → secret `SEC_CONTACT_EMAIL`
//     (sem ele a fonte EDGAR fica desligada, sem erro).
//   • ACOES → CVM (dados abertos): ITR/DFP. O PDF do release de resultados NÃO é
//     baixável sem sessão de navegador, então o "documento" é um resumo numérico
//     (DRE + balanço, trimestre/acumulado × ano anterior) montado dos CSVs.
//   • ETF e renda fixa/cripto: sem relatório periódico que valha analisar.
//
// Cache compartilhado em `inv_documentos_resultado`; análises por usuário em
// `inv_analises_relatorio` (coluna `documento_id`). A análise gasta a chave de IA
// DO USUÁRIO — modo automático é opt-in (`usuarios.inv_relatorios_auto`).
import { dbAdmin } from "../_shared/utils.ts";
import { logError } from "../_shared/logger.ts";
import { chamarProvedorIA, lerConfigIAAtiva, ErroIA, type ConfigIAAtiva } from "../_shared/ia.ts";
import { Db, hojeISO, recuarDias } from "./shared.ts";
import { parsearAnaliseIA } from "./relatoriosFii.ts";
import { extrairMdna, htmlParaTexto, resumirDemonstracoes, rotuloPeriodoCvm } from "./textoResultados.ts";
import { carregarDadosEmpresas, mapasBase, raizDoTicker } from "./cvmAcoes.ts";
import { ehUnit } from "./fundamentosAcao.ts";

export const TIPOS_COM_RESULTADO = ["ACOES", "STOCKS", "REIT"] as const;
const JANELA_EDGAR_DIAS = 100;       // 10-Q/10-K enviados nos últimos ~3 meses
const JANELA_CVM_DIAS = 200;         // data-base do ITR/DFP dentro de ~6 meses
const MAX_TEXTO = 45_000;
const MAX_HTML_BYTES = 25 * 1024 * 1024;
const URL_ITR = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS";

export interface AtivoEmpresa {
  id: string; user_id: string; ticker: string; nome: string | null; tipo_ativo: string; acoes_subtipo?: string | null;
}
export interface DocumentoResultado {
  id: string; fonte: "EDGAR" | "CVM"; ticker_ref: string; emissor_chave: string; emissor_nome: string;
  tipo_doc: string; data_referencia: string | null; data_entrega: string; url_documento: string | null;
  texto: string | null; texto_status: string;
}

export const fonteDoTipo = (tipo: string): "EDGAR" | "CVM" | null =>
  tipo === "ACOES" ? "CVM" : tipo === "STOCKS" || tipo === "REIT" ? "EDGAR" : null;

// Ticker como a SEC grava ("BRK.B" → "BRK-B").
const tickerSec = (t: string) => t.trim().toUpperCase().replace(/\./g, "-");
// Chave de casamento ativo ↔ documento.
export const refDoAtivo = (a: { ticker: string; tipo_ativo: string }) =>
  a.tipo_ativo === "ACOES" ? raizDoTicker(a.ticker) : tickerSec(a.ticker);

// ── EDGAR ──────────────────────────────────────────────────────────────

const uaSec = (): string | null => {
  const c = Deno.env.get("SEC_CONTACT_EMAIL")?.trim();
  return c ? `ArquitetoDeValor/7.8 (${c})` : null;
};
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchSec(url: string, ua: string, ms = 40_000): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua, "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(ms) });
    return res.ok ? res : null;
  } catch (e) { logError("SEC fetch", `${url}: ${e}`); return null; }
}

let cacheCik: { mapa: Map<string, { cik: number; nome: string }>; em: number } | null = null;
async function mapaTickersSec(ua: string) {
  if (cacheCik && Date.now() - cacheCik.em < 6 * 3_600_000) return cacheCik.mapa;
  const res = await fetchSec("https://www.sec.gov/files/company_tickers.json", ua);
  if (!res) return null;
  const j = await res.json() as Record<string, { cik_str: number; ticker: string; title: string }>;
  const mapa = new Map<string, { cik: number; nome: string }>();
  for (const v of Object.values(j)) mapa.set(String(v.ticker).toUpperCase(), { cik: v.cik_str, nome: v.title });
  cacheCik = { mapa, em: Date.now() };
  return mapa;
}

export async function sincronizarEdgar(
  tickers: string[], dias = JANELA_EDGAR_DIAS,
): Promise<{ tickers: number; inseridos: number; falhas: number; desligado: boolean }> {
  const ua = uaSec();
  if (!ua || tickers.length === 0) return { tickers: 0, inseridos: 0, falhas: 0, desligado: !ua };
  const mapa = await mapaTickersSec(ua);
  if (!mapa) return { tickers: tickers.length, inseridos: 0, falhas: 1, desligado: false };
  const desde = recuarDias(hojeISO(), dias);
  const linhas: Record<string, unknown>[] = [];
  let falhas = 0;
  for (const tk of new Set(tickers.map(tickerSec))) {
    const emp = mapa.get(tk);
    if (!emp) continue; // ticker fora da SEC (ETF, BDR…)
    await dormir(150); // política de uso justo da SEC: ≤ 10 req/s
    const res = await fetchSec(`https://data.sec.gov/submissions/CIK${String(emp.cik).padStart(10, "0")}.json`, ua);
    if (!res) { falhas++; continue; }
    const r = ((await res.json()) as { filings?: { recent?: Record<string, string[]> } }).filings?.recent;
    if (!r?.form) continue;
    for (let i = 0; i < r.form.length; i++) {
      const form = r.form[i];
      if (form !== "10-Q" && form !== "10-K") continue;
      if ((r.filingDate[i] ?? "") < desde) continue;
      const acc = r.accessionNumber[i], doc = r.primaryDocument[i];
      if (!acc || !doc) continue;
      linhas.push({
        id: `EDGAR:${acc}`, fonte: "EDGAR", ticker_ref: tk, emissor_chave: String(emp.cik), emissor_nome: emp.nome,
        tipo_doc: form, data_referencia: r.reportDate[i] || null, data_entrega: `${r.filingDate[i]}T00:00:00Z`,
        url_documento: `https://www.sec.gov/Archives/edgar/data/${emp.cik}/${acc.replace(/-/g, "")}/${doc}`,
      });
    }
  }
  let inseridos = 0;
  if (linhas.length > 0) {
    const { error, count } = await dbAdmin().from("inv_documentos_resultado")
      .upsert(linhas, { onConflict: "id", ignoreDuplicates: true, count: "exact" });
    if (error) { logError("Upsert docs EDGAR", error); falhas++; } else inseridos = count ?? 0;
  }
  return { tickers: tickers.length, inseridos, falhas, desligado: false };
}

async function textoEdgar(doc: DocumentoResultado): Promise<string | null> {
  const ua = uaSec();
  if (!ua || !doc.url_documento) return null;
  const res = await fetchSec(doc.url_documento, ua, 60_000);
  if (!res) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_HTML_BYTES) return null;
  const mdna = extrairMdna(htmlParaTexto(new TextDecoder("utf-8").decode(buf)), doc.tipo_doc, MAX_TEXTO);
  return mdna.length >= 1000 ? mdna : null;
}

// ── CVM ────────────────────────────────────────────────────────────────

export async function sincronizarCvm(ativos: { ticker: string; nome: string | null; acoes_subtipo?: string | null }[]): Promise<{ empresas: number; gravados: number; falhas: number }> {
  const { tickerParaCnpj } = await mapasBase();
  const porCnpj = new Map<string, { raiz: string; nome: string }>();
  for (const a of ativos) {
    if (ehUnit(a.ticker, a.acoes_subtipo)) continue;
    const raiz = raizDoTicker(a.ticker), cnpj = tickerParaCnpj.get(raiz);
    if (cnpj && !porCnpj.has(cnpj)) porCnpj.set(cnpj, { raiz, nome: a.nome?.trim() || raiz });
  }
  if (porCnpj.size === 0) return { empresas: 0, gravados: 0, falhas: 0 };
  const dados = await carregarDadosEmpresas(new Set(porCnpj.keys()));
  const linhas: Record<string, unknown>[] = [];
  for (const [cnpj, info] of porCnpj) {
    const d = dados.get(cnpj);
    if (!d) continue;
    const r = resumirDemonstracoes({ nome: info.nome, ticker: info.raiz, dfpDre: d.dfpDre, itrDre: d.itrDre, bppItr: d.bppItr, bppDfp: d.bppDfp });
    if (!r) continue;
    linhas.push({
      id: `CVM:${cnpj}:${r.fim}`, fonte: "CVM", ticker_ref: info.raiz, emissor_chave: cnpj, emissor_nome: info.nome,
      tipo_doc: r.tipo, data_referencia: r.fim, data_entrega: `${r.fim}T00:00:00Z`,
      url_documento: `https://dados.cvm.gov.br/dataset/cia_aberta-doc-${r.tipo.toLowerCase()}`,
      texto: `Período: ${rotuloPeriodoCvm(r)}.\n${r.texto}`, texto_status: "OK", baixado_em: new Date().toISOString(),
    });
  }
  let falhas = 0;
  if (linhas.length > 0) {
    // upsert COM sobrescrita: reapresentações da CVM atualizam o resumo do mesmo período.
    const { error } = await dbAdmin().from("inv_documentos_resultado").upsert(linhas, { onConflict: "id" });
    if (error) { logError("Upsert docs CVM", error); falhas++; }
  }
  return { empresas: porCnpj.size, gravados: falhas ? 0 : linhas.length, falhas };
}

// O ITR muda poucas vezes ao ano: só reprocessa quando o arquivo da CVM é mais novo
// do que o último resumo gravado (Last-Modified do ZIP).
export async function cvmPrecisaAtualizar(): Promise<boolean> {
  const { data } = await dbAdmin().from("inv_documentos_resultado").select("baixado_em")
    .eq("fonte", "CVM").order("baixado_em", { ascending: false }).limit(1).maybeSingle();
  if (!data) return true;
  try {
    const res = await fetch(`${URL_ITR}/itr_cia_aberta_${new Date().getUTCFullYear()}.zip`, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
    const lm = res.headers.get("last-modified");
    return !lm || new Date(lm).getTime() > new Date(String(data.baixado_em)).getTime();
  } catch { return false; }
}

// ── Documentos de um ativo ─────────────────────────────────────────────

export async function documentosDoAtivo(c: Db, ativo: { ticker: string; tipo_ativo: string }, limite = 12): Promise<DocumentoResultado[]> {
  const fonte = fonteDoTipo(ativo.tipo_ativo);
  if (!fonte) return [];
  const { data, error } = await c.from("inv_documentos_resultado")
    .select("id, fonte, ticker_ref, emissor_chave, emissor_nome, tipo_doc, data_referencia, data_entrega, url_documento, texto_status")
    .eq("fonte", fonte).eq("ticker_ref", refDoAtivo(ativo))
    .order("data_referencia", { ascending: false, nullsFirst: false }).limit(limite);
  if (error) { logError("Docs do ativo", error); return []; }
  return (data ?? []) as DocumentoResultado[];
}

export async function sincronizarDocumentosAtivo(ativo: AtivoEmpresa): Promise<{ inseridos: number; falhas: number; aviso?: string }> {
  const fonte = fonteDoTipo(ativo.tipo_ativo);
  if (fonte === "EDGAR") {
    const r = await sincronizarEdgar([ativo.ticker], 200);
    return { inseridos: r.inseridos, falhas: r.falhas, ...(r.desligado ? { aviso: "Fonte da SEC não configurada (secret SEC_CONTACT_EMAIL)." } : {}) };
  }
  if (fonte === "CVM") {
    const r = await sincronizarCvm([ativo]);
    return { inseridos: r.gravados, falhas: r.falhas };
  }
  return { inseridos: 0, falhas: 0 };
}

async function garantirTextoDoc(doc: DocumentoResultado): Promise<string | null> {
  if (doc.texto_status === "OK" && doc.texto) return doc.texto;
  const admin = dbAdmin();
  const { data } = await admin.from("inv_documentos_resultado").select("texto, texto_status").eq("id", doc.id).maybeSingle();
  if (data?.texto_status === "OK" && data.texto) return String(data.texto);
  const texto = doc.fonte === "EDGAR" ? await textoEdgar(doc) : null;
  if (!texto) {
    await admin.from("inv_documentos_resultado").update({ texto_status: "ERRO" }).eq("id", doc.id);
    return null;
  }
  await admin.from("inv_documentos_resultado").update({ texto, texto_status: "OK" }).eq("id", doc.id);
  return texto;
}

// ── Análise por IA ─────────────────────────────────────────────────────

const REGRAS_COMUNS = `Regras:
- Baseie-se SOMENTE no texto fornecido (e na análise anterior, se houver). Não invente números.
- PROIBIDO jargão sem tradução. Nunca escreva só "EBITDA", "margem", "alavancagem", "dívida líquida", "guidance", "payout", "ROE", "capex", "free cash flow" etc. Troque por palavras do dia a dia: "o que sobra do que a empresa vende", "dívida da empresa", "o que a empresa espera para os próximos meses".
- Sempre que citar um número, diga o que ele significa na prática. Ex.: "lucro caiu 20%" → "para cada R$ 100 que ganhava antes, agora ganha R$ 80".
- Frases curtas (até 15 palavras), voz ativa, sem siglas. Escreva em português do Brasil, como se falasse com alguém de 14 anos.
- No "resumo", responda direto: a empresa vai bem, mais ou menos ou mal, e o que isso significa para quem tem as ações.
- Em "pontos_atencao" explique o RISCO em termos de consequência para o bolso.
- Em "inconsistencias" coloque só informações que não batem entre si ou que o documento deveria trazer e não trouxe. Se não houver, lista vazia.
- Compare com a análise anterior em UMA frase (melhorou, piorou ou ficou igual), ou use a comparação com o ano anterior se não houver análise anterior.
- Não dê recomendação de compra ou venda.
- Responda APENAS com um objeto JSON, sem texto fora dele, neste formato:
{"veredito":"POSITIVO|NEUTRO|ATENCAO|NEGATIVO","resumo":"1 a 2 frases simples","pontos_fortes":["..."],"pontos_atencao":["..."],"inconsistencias":["..."],"mudancas":"1 frase sobre o que mudou, ou null"}
- Cada lista tem NO MÁXIMO 3 itens, de até 18 palavras cada. Listas vazias são aceitáveis.`;

const PERSONA_CVM = `Você está conversando com uma pessoa comum, que NUNCA estudou finanças. Ela tem ações de uma empresa brasileira e só quer saber: "a empresa está indo bem? meu investimento está seguro?". Você recebe uma tabela com os números do resultado da empresa (vendas, custos, lucro, dívida), comparando o período atual com o mesmo período do ano passado. Explique como um amigo explicaria no WhatsApp.
${REGRAS_COMUNS}`;

const PERSONA_EDGAR = `Você está conversando com uma pessoa comum, que NUNCA estudou finanças. Ela tem ações de uma empresa americana e só quer saber: "a empresa está indo bem? meu investimento está seguro?". Você recebe, em inglês, a parte do relatório trimestral/anual em que a própria empresa explica seus resultados (vendas, lucro, custos, riscos). Traduza o essencial para português do Brasil e explique como um amigo explicaria no WhatsApp.
${REGRAS_COMUNS}`;

async function analisarComIA(
  cfg: ConfigIAAtiva, ativo: AtivoEmpresa, doc: DocumentoResultado, texto: string,
  anterior: { resumo: string; pontos_atencao: unknown } | null,
) {
  const blocoAnterior = anterior
    ? `\n\nAnálise do documento ANTERIOR (para comparar):\nResumo: ${anterior.resumo}\nPontos de atenção: ${JSON.stringify(anterior.pontos_atencao)}`
    : "";
  const tipoTxt = doc.fonte === "CVM" ? "Resultado (dados da CVM)" : `Relatório ${doc.tipo_doc} (SEC) — seção "Management's Discussion and Analysis"`;
  const pergunta = `Ativo: ${ativo.ticker}${ativo.nome ? ` — ${ativo.nome}` : ""}\nEmpresa: ${doc.emissor_nome}\n${tipoTxt}, data-base ${doc.data_referencia ?? "?"}${blocoAnterior}\n\n--- TEXTO ---\n${texto}`;
  const bruto = await chamarProvedorIA(cfg.provedor, {
    apiKey: cfg.apiKey, persona: doc.fonte === "CVM" ? PERSONA_CVM : PERSONA_EDGAR, modelo: cfg.modelo ?? undefined,
    mensagens: [{ role: "user", content: pergunta }], maxTokens: 900, buscaWeb: false,
  });
  const analise = parsearAnaliseIA(bruto);
  if (!analise) throw new ErroIA("A IA devolveu uma resposta fora do formato esperado. Tente novamente.", 502);
  return analise;
}

export async function analisarESalvarDocumento(
  cliente: Db, userId: string, cfg: ConfigIAAtiva, ativo: AtivoEmpresa, doc: DocumentoResultado, origem: "CRON" | "MANUAL",
): Promise<{ ok: true; analise: Record<string, unknown> } | { ok: false; erro: string; status: number }> {
  const texto = await garantirTextoDoc(doc);
  if (!texto) return { ok: false, erro: "Não foi possível obter o texto deste documento (indisponível ou sem a seção de resultados).", status: 422 };

  // Análise anterior do mesmo ativo (filtro em JS: o id do documento tem "." e ":",
  // que quebram a sintaxe de `.or()` do PostgREST).
  const { data: anteriores } = await cliente.from("inv_analises_relatorio")
    .select("resumo, pontos_atencao, documento_id").eq("user_id", userId).eq("ativo_id", ativo.id)
    .order("data_referencia", { ascending: false, nullsFirst: false }).limit(3);
  const ant = (anteriores ?? []).find((a) => a.documento_id !== doc.id) ?? null;

  let analise;
  try { analise = await analisarComIA(cfg, ativo, doc, texto, ant); }
  catch (e) {
    logError("Análise de resultado (IA)", e);
    return { ok: false, erro: e instanceof ErroIA ? e.message : "Falha ao consultar a IA.", status: e instanceof ErroIA ? e.statusResposta : 502 };
  }

  const { data, error } = await cliente.from("inv_analises_relatorio").upsert({
    user_id: userId, ativo_id: ativo.id, documento_id: doc.id, relatorio_id: null, data_referencia: doc.data_referencia,
    veredito: analise.veredito, resumo: analise.resumo, pontos_fortes: analise.pontos_fortes,
    pontos_atencao: analise.pontos_atencao, inconsistencias: analise.inconsistencias, mudancas: analise.mudancas,
    provedor: cfg.provedor, modelo: cfg.modelo, mentor_nome: cfg.nome ?? null, origem, visto_em: null,
  }, { onConflict: "user_id,ativo_id,documento_id" }).select().single();
  if (error) { logError("Salvar análise de resultado", error); return { ok: false, erro: error.message, status: 500 }; }
  return { ok: true, analise: data };
}

// ── Etapa de resultados dentro do cron diário ──────────────────────────
// Chamada por `rotaRelatoriosFiiCron` (mesmo job `relatorios-fii-diario`): sincroniza
// os documentos dos ativos de quem ligou a análise automática e analisa o mais recente
// de cada um. Respeita o orçamento de tempo/nº de análises do cron.
export async function processarResultadosCron(
  idsAuto: Set<string>, limites: { analisesRestantes: number; prazoMs: number },
): Promise<{ docs_edgar: number; docs_cvm: number; analisados: number; ignorados: number; falhas_analise: number; expurgados: number; desligado_sec: boolean }> {
  const admin = dbAdmin();
  const res = { docs_edgar: 0, docs_cvm: 0, analisados: 0, ignorados: 0, falhas_analise: 0, expurgados: 0, desligado_sec: false };
  if (idsAuto.size === 0) return res;

  const { data: pos } = await admin.from("inv_posicoes")
    .select("ativo_id, inv_ativos!inner(id, user_id, ticker, nome, tipo_ativo, acoes_subtipo)")
    .eq("status", "ATIVA").in("inv_ativos.tipo_ativo", [...TIPOS_COM_RESULTADO]);
  const vistos = new Set<string>();
  const ativos: AtivoEmpresa[] = [];
  for (const p of pos ?? []) {
    const a = p.inv_ativos as unknown as AtivoEmpresa | null;
    if (!a || !idsAuto.has(String(a.user_id)) || vistos.has(String(a.id))) continue;
    vistos.add(String(a.id));
    ativos.push({ id: String(a.id), user_id: String(a.user_id), ticker: a.ticker, nome: a.nome, tipo_ativo: a.tipo_ativo, acoes_subtipo: a.acoes_subtipo });
  }
  if (ativos.length === 0) return res;

  const edgar = await sincronizarEdgar(ativos.filter((a) => fonteDoTipo(a.tipo_ativo) === "EDGAR").map((a) => a.ticker));
  res.docs_edgar = edgar.inseridos; res.desligado_sec = edgar.desligado;
  const acoes = ativos.filter((a) => a.tipo_ativo === "ACOES");
  if (acoes.length > 0 && Date.now() < limites.prazoMs && await cvmPrecisaAtualizar()) {
    try { res.docs_cvm = (await sincronizarCvm(acoes)).gravados; } catch (e) { logError("Sync CVM (cron)", e); }
  }

  const cfgPorUsuario = new Map<string, ConfigIAAtiva | null>();
  const jaTratado = new Set<string>(); // (usuário, emissor): PETR3 e PETR4 compartilham a mesma análise
  let restantes = limites.analisesRestantes;
  for (const ativo of ativos) {
    if (restantes <= 0 || Date.now() > limites.prazoMs) break;
    const fonte = fonteDoTipo(ativo.tipo_ativo)!;
    const chave = `${ativo.user_id}|${fonte}|${refDoAtivo(ativo)}`;
    if (jaTratado.has(chave)) continue;
    jaTratado.add(chave);

    const [doc] = await documentosDoAtivo(admin, ativo, 1);
    const limiteData = recuarDias(hojeISO(), fonte === "CVM" ? JANELA_CVM_DIAS : JANELA_EDGAR_DIAS);
    if (!doc || (doc.data_referencia ?? doc.data_entrega.slice(0, 10)) < limiteData) continue;
    const { data: ja } = await admin.from("inv_analises_relatorio").select("id")
      .eq("user_id", ativo.user_id).eq("ativo_id", ativo.id).eq("documento_id", doc.id).maybeSingle();
    if (ja) { res.ignorados++; continue; }

    if (!cfgPorUsuario.has(ativo.user_id)) {
      const r = await lerConfigIAAtiva(admin, ativo.user_id);
      cfgPorUsuario.set(ativo.user_id, r.ok ? r.config : null);
    }
    const cfg = cfgPorUsuario.get(ativo.user_id);
    if (!cfg) { res.ignorados++; continue; }
    const r = await analisarESalvarDocumento(admin, ativo.user_id, cfg, ativo, doc, "CRON");
    if (r.ok) { res.analisados++; restantes--; } else res.falhas_analise++;
  }

  const { count } = await admin.from("inv_documentos_resultado").delete({ count: "exact" }).lt("data_entrega", `${recuarDias(hojeISO(), 400)}T00:00:00Z`);
  res.expurgados = count ?? 0;
  return res;
}

// Lista (para a UI) os documentos de um ativo + se já foram analisados pelo usuário.
export async function listarDisponiveis(c: Db, userId: string, ativo: { id: string; ticker: string; tipo_ativo: string }) {
  const docs = await documentosDoAtivo(c, ativo);
  const { data: feitas } = await c.from("inv_analises_relatorio").select("documento_id").eq("user_id", userId).eq("ativo_id", ativo.id).not("documento_id", "is", null);
  const analisados = new Set((feitas ?? []).map((f) => String(f.documento_id)));
  return docs.map((d) => ({
    id: d.id, fundo_nome: d.emissor_nome, fundo_pregao: d.ticker_ref, data_referencia: d.data_referencia,
    data_entrega: d.data_entrega, url_documento: d.url_documento, tipo_doc: d.tipo_doc, fonte: d.fonte,
    analisado: analisados.has(d.id),
  }));
}
