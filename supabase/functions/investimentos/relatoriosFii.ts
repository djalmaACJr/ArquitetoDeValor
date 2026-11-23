// supabase/functions/investimentos/relatoriosFii.ts
//
// Análise periódica de Relatórios Gerenciais de FIIs (v7.7.0).
//
// Fonte: Fundos.NET (B3), categoria "Relatórios" (id 7), tipo de documento
// "Relatório Gerencial" — PDF mensal publicado pela gestora (validado ao vivo
// nov/2026: `downloadDocumento?id=<id>` devolve application/pdf, sem login).
// Mesma infraestrutura/WAF de `fatosRelevantes.ts` (helpers reaproveitados).
//
// Fluxo:
//   1) cron `relatorios-fii-diario` → `sincronizarRelatorios()` cacheia os
//      metadados dos relatórios recentes em `inv_relatorios_fii` (compartilhada);
//   2) para cada FII em carteira de quem ligou `usuarios.inv_relatorios_auto`,
//      baixa o PDF (1x por relatório, texto fica em cache) e pede à IA ATIVA do
//      próprio usuário uma análise estruturada → `inv_analises_relatorio`;
//   3) o usuário também pode disparar na hora (`POST /relatorios-fii/analisar`).
//
// A análise gasta a chave de IA DO USUÁRIO — por isso o modo automático é
// opt-in e a rota manual nunca usa a config de outro usuário.
import { json, erro, dbAdmin, autenticarCron } from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import { chamarProvedorIA, lerConfigIAAtiva, ErroIA, type ConfigIAAtiva } from "../_shared/ia.ts";
import { extractText, getDocumentProxy } from "npm:unpdf@1.3.0";
import { Db, hojeISO, recuarDias } from "./shared.ts";
import { carregarContextoPessoal, gerarAnalisePessoal, personalizarAnaliseSalva } from "./analisePessoal.ts";
import {
  TIPOS_COM_RESULTADO, analisarESalvarDocumento, documentosDoAtivo, listarDisponiveis,
  processarResultadosCron, sincronizarDocumentosAtivo,
} from "./resultadosEmpresas.ts";
import {
  FNET_HEADERS, dataEntregaParaISO, fetchFnet, montarUrlBusca, normaliza, nucleoTicker,
  type LinhaFnet,
} from "./fatosRelevantes.ts";

const CATEGORIA_RELATORIOS = 7;
const TIPO_RELATORIO_GERENCIAL = "Relatório Gerencial";
const JANELA_DIAS = 12;
const PAGINAS = 6;
const TAMANHO_PAGINA = 40;
const MAX_TEXTO = 45_000;          // chars do PDF enviados à IA (~12k tokens)
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_ANALISES_POR_CRON = 12;
const DIAS_HISTORICO_ANALISES = 183; // ~6 meses: análises mais antigas são apagadas
const ORCAMENTO_CRON_MS = 110_000; // o edge function aguenta ~150s

type Veredito = "POSITIVO" | "NEUTRO" | "ATENCAO" | "NEGATIVO";
const VEREDITOS: Veredito[] = ["POSITIVO", "NEUTRO", "ATENCAO", "NEGATIVO"];

interface Relatorio {
  id: number; fundo_nome: string; fundo_pregao: string | null; data_referencia: string | null;
  data_entrega: string; url_documento: string; texto: string | null; texto_status: string;
}
interface AtivoFii { id: string; user_id: string; ticker: string; nome: string | null }
interface AnaliseIA {
  veredito: Veredito; resumo: string; pontos_fortes: string[]; pontos_atencao: string[];
  inconsistencias: string[]; mudancas: string | null;
}

// ── Utilidades ─────────────────────────────────────────────────────────

// "31/10/2026" → 2026-10-31 · "10/2026" → 2026-10-01
export function parseDataReferencia(s: string | undefined | null): string | null {
  if (!s) return null;
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{2})\/(\d{4})$/);
  return m ? `${m[2]}-${m[1]}-01` : null;
}

const PALAVRAS_GENERICAS = new Set([
  "fundo", "investimento", "imobiliario", "fii", "fiagro", "responsabilidade", "limitada", "classe",
  "cotas", "unica", "de", "do", "da", "dos", "das", "e", "em", "ltda", "sa",
]);
function tokensDistintivos(s: string): string[] {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !PALAVRAS_GENERICAS.has(t));
}

// Casamento ativo ↔ relatório por TEXTO (não há CNPJ em inv_ativos): (a) o núcleo
// do ticker aparece no pregão/nome do fundo, ou (b) ≥2 palavras distintivas do
// nome do ativo (ex.: "RBR", "Rendimento", "High", "Grade") aparecem TODAS no
// nome/pregão do relatório. O pregão da B3 raramente é o ticker ("FII RBRESID2"),
// por isso (b) existe. Pode errar para fundos com nomes parecidos — a UI mostra
// de qual relatório a análise veio (link do PDF) para o usuário conferir.
export function relatorioCasaComAtivo(ativo: { ticker: string; nome: string | null }, rel: { fundo_nome: string; fundo_pregao: string | null }): boolean {
  const nucleo = nucleoTicker(ativo.ticker);
  const alvo = normaliza(`${rel.fundo_pregao ?? ""} ${rel.fundo_nome}`);
  if (nucleo.length >= 3 && alvo.includes(nucleo)) return true;
  const toks = ativo.nome ? tokensDistintivos(ativo.nome) : [];
  if (toks.length < 2) return false;
  const alvoToks = new Set(tokensDistintivos(`${rel.fundo_pregao ?? ""} ${rel.fundo_nome}`));
  return toks.every((t) => alvoToks.has(t));
}

function arrTexto(v: unknown, max = 4): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, 220));
}

export function parsearAnaliseIA(bruto: string): AnaliseIA | null {
  const ini = bruto.indexOf("{"), fim = bruto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try {
    const o = JSON.parse(bruto.slice(ini, fim + 1)) as Record<string, unknown>;
    const veredito = String(o.veredito ?? "").toUpperCase().replace("Ç", "C").replace("Ã", "A") as Veredito;
    const resumo = String(o.resumo ?? "").trim();
    if (!VEREDITOS.includes(veredito) || !resumo) return null;
    const mud = String(o.mudancas ?? "").trim();
    return {
      veredito, resumo: resumo.slice(0, 500),
      pontos_fortes: arrTexto(o.pontos_fortes), pontos_atencao: arrTexto(o.pontos_atencao),
      inconsistencias: arrTexto(o.inconsistencias),
      mudancas: mud && !/^(null|nenhuma?|n\/a)$/i.test(mud) ? mud.slice(0, 300) : null,
    };
  } catch { return null; }
}

// ── Sincronização dos metadados (cache compartilhado) ──────────────────

// `opcoes` só é usado pelo backfill sob demanda (janela maior, mais páginas,
// com teto de tempo); o cron diário chama sem argumentos.
export async function sincronizarRelatorios(
  opcoes: { dias?: number; paginas?: number; orcamentoMs?: number } = {},
): Promise<{ consultados: number; gerenciais: number; inseridos: number; falhas: number }> {
  const hoje = hojeISO();
  const desde = recuarDias(hoje, opcoes.dias ?? JANELA_DIAS);
  const maxPaginas = opcoes.paginas ?? PAGINAS;
  const limiteTempo = Date.now() + (opcoes.orcamentoMs ?? Infinity);
  const linhas: LinhaFnet[] = [];
  let falhas = 0;
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    if (Date.now() > limiteTempo) break;
    const resp = await fetchFnet(montarUrlBusca(CATEGORIA_RELATORIOS, pagina * TAMANHO_PAGINA, TAMANHO_PAGINA, desde, hoje));
    if (!resp) { falhas++; break; }
    linhas.push(...resp.data);
    if (resp.data.length < TAMANHO_PAGINA || (pagina + 1) * TAMANHO_PAGINA >= resp.recordsTotal) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const gerenciais = linhas.filter((l) => l.tipoDocumento === TIPO_RELATORIO_GERENCIAL);
  const paraGravar = gerenciais.map((l) => {
    const dataISO = dataEntregaParaISO(l.dataEntrega);
    if (!dataISO || !Number.isFinite(l.id) || !(l.descricaoFundo ?? "").trim()) return null;
    return {
      id: l.id,
      fundo_nome: l.descricaoFundo.trim(),
      fundo_pregao: (l.nomePregao ?? "").trim() || null,
      data_referencia: parseDataReferencia(l.dataReferencia),
      data_entrega: dataISO,
      url_documento: `https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento?id=${l.id}`,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  let inseridos = 0;
  if (paraGravar.length > 0) {
    const admin = dbAdmin();
    const { error, count } = await admin.from("inv_relatorios_fii")
      .upsert(paraGravar, { onConflict: "id", ignoreDuplicates: true, count: "exact" });
    if (error) logError("Upsert inv_relatorios_fii", error); else inseridos = count ?? 0;
    await admin.from("inv_relatorios_fii").delete().lt("data_entrega", recuarDias(hoje, 400));
  }
  return { consultados: linhas.length, gerenciais: gerenciais.length, inseridos, falhas };
}

// ── PDF → texto (cacheado no relatório) ────────────────────────────────

export async function garantirTexto(rel: Relatorio): Promise<string | null> {
  if (rel.texto_status === "OK" && rel.texto) return rel.texto;
  const admin = dbAdmin();
  const marcarErro = async (motivo: string) => {
    logError("Relatório FII sem texto", `${rel.id}: ${motivo}`);
    await admin.from("inv_relatorios_fii").update({ texto_status: "ERRO" }).eq("id", rel.id);
    return null;
  };
  try {
    const res = await fetch(rel.url_documento, { headers: FNET_HEADERS, redirect: "manual", signal: AbortSignal.timeout(40_000) });
    if (res.status !== 200) return await marcarErro(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_PDF_BYTES) return await marcarErro("PDF grande demais");
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    const limpo = String(text ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (limpo.length < 500) return await marcarErro("PDF sem texto extraível (imagem?)");
    const texto = limpo.slice(0, MAX_TEXTO);
    await admin.from("inv_relatorios_fii").update({ texto, texto_status: "OK" }).eq("id", rel.id);
    return texto;
  } catch (e) {
    return await marcarErro(String(e));
  }
}

// ── Chamada de IA ──────────────────────────────────────────────────────

const PERSONA_ANALISTA = `Você está conversando com uma pessoa comum, que NUNCA estudou finanças e não sabe o que é um fundo imobiliário por dentro. Ela tem cotas de um FII e só quer saber: "está tudo bem com o meu fundo? meu dinheiro mensal está seguro?". Receba o texto do Relatório Gerencial e explique como um amigo explicaria no WhatsApp.
Regras:
- Baseie-se SOMENTE no texto do relatório (e na análise anterior, se fornecida). Não invente números.
- PROIBIDO usar jargão sem tradução. Nunca escreva só "vacância", "inadimplência", "alavancagem", "P/VP", "LTV", "CRI", "IPCA+", "duration", "spread", "cap rate", "yield", "marcação a mercado", "covenant" etc. Troque por palavras do dia a dia: "imóveis vazios", "inquilinos que não pagaram", "dívida do fundo", "o fundo está caro/barato em relação ao que possui".
- Sempre que citar um número, diga o que ele significa na prática. Ex.: "10% de vacância" → "1 de cada 10 salas está vazia".
- Frases curtas (até 15 palavras), voz ativa, sem siglas. Escreva como se falasse com alguém de 14 anos.
- No "resumo", responda direto: o fundo está bem, mais ou menos ou preocupante, e o que isso muda para quem recebe os rendimentos todo mês.
- Em "pontos_atencao" explique o RISCO em termos de consequência para o bolso (ex.: "se o inquilino sair, o rendimento mensal pode cair").
- Em "inconsistencias" coloque só informações que não batem entre si ou que o relatório deveria trazer e não trouxe. Se não houver, deixe a lista vazia.
- Compare com a análise anterior em UMA frase (melhorou, piorou ou ficou igual).
- Responda APENAS com um objeto JSON, sem texto fora dele, neste formato:
{"veredito":"POSITIVO|NEUTRO|ATENCAO|NEGATIVO","resumo":"1 a 2 frases simples","pontos_fortes":["..."],"pontos_atencao":["..."],"inconsistencias":["..."],"mudancas":"1 frase sobre o que mudou vs. relatório anterior, ou null"}
- Cada lista tem NO MÁXIMO 3 itens, de até 18 palavras cada. Listas vazias são aceitáveis.`;

async function analisarComIA(
  cfg: ConfigIAAtiva, ativo: { ticker: string; nome: string | null }, rel: Relatorio, texto: string,
  anterior: { resumo: string; pontos_atencao: unknown } | null,
): Promise<AnaliseIA> {
  const blocoAnterior = anterior
    ? `\n\nAnálise do relatório ANTERIOR (para comparar):\nResumo: ${anterior.resumo}\nPontos de atenção: ${JSON.stringify(anterior.pontos_atencao)}`
    : "";
  const pergunta = `FII: ${ativo.ticker}${ativo.nome ? ` — ${ativo.nome}` : ""}\nRelatório: ${rel.fundo_nome} (competência ${rel.data_referencia ?? "?"})${blocoAnterior}\n\n--- TEXTO DO RELATÓRIO GERENCIAL ---\n${texto}`;
  const bruto = await chamarProvedorIA(cfg.provedor, {
    apiKey: cfg.apiKey, persona: PERSONA_ANALISTA, modelo: cfg.modelo ?? undefined,
    mensagens: [{ role: "user", content: pergunta }], maxTokens: 900, buscaWeb: false,
  });
  const analise = parsearAnaliseIA(bruto);
  if (!analise) throw new ErroIA("A IA devolveu uma resposta fora do formato esperado. Tente novamente.", 502);
  return analise;
}

async function analisarESalvar(
  cliente: Db, userId: string, cfg: ConfigIAAtiva, ativo: AtivoFii, rel: Relatorio, origem: "CRON" | "MANUAL",
): Promise<{ ok: true; analise: Record<string, unknown> } | { ok: false; erro: string; status: number }> {
  const texto = await garantirTexto(rel);
  if (!texto) return { ok: false, erro: "Não foi possível ler o PDF deste relatório (sem texto ou indisponível).", status: 422 };

  const { data: ant } = await cliente.from("inv_analises_relatorio")
    .select("resumo, pontos_atencao").eq("user_id", userId).eq("ativo_id", ativo.id)
    .neq("relatorio_id", rel.id).order("data_referencia", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();

  let analise: AnaliseIA;
  try {
    analise = await analisarComIA(cfg, ativo, rel, texto, ant ?? null);
  } catch (e) {
    const status = e instanceof ErroIA ? e.statusResposta : 502;
    logError("Análise de relatório FII (IA)", e);
    return { ok: false, erro: e instanceof ErroIA ? e.message : "Falha ao consultar a IA.", status };
  }

  const { data, error } = await cliente.from("inv_analises_relatorio").upsert({
    user_id: userId, ativo_id: ativo.id, relatorio_id: rel.id, data_referencia: rel.data_referencia,
    veredito: analise.veredito, resumo: analise.resumo,
    pontos_fortes: analise.pontos_fortes, pontos_atencao: analise.pontos_atencao,
    inconsistencias: analise.inconsistencias, mudancas: analise.mudancas,
    provedor: cfg.provedor, modelo: cfg.modelo, mentor_nome: cfg.nome ?? null, origem, visto_em: null, analise_pessoal: null,
  }, { onConflict: "user_id,ativo_id,relatorio_id" }).select().single();
  if (error) { logError("Salvar análise de relatório FII", error); return { ok: false, erro: error.message, status: 500 }; }
  return { ok: true, analise: data };
}

// ============================================================
// POST /investimentos/relatorios-fii-cron — job diário (sem JWT, x-cron-secret)
// ============================================================
export async function rotaRelatoriosFiiCron(req: Request, m: string): Promise<Response> {
  if (m !== "POST") return erro("Método não permitido", 405);
  const naoAutorizado = autenticarCron(req);
  if (naoAutorizado) return naoAutorizado;
  logRequest("POST", "/investimentos/relatorios-fii-cron", {});
  const inicio = Date.now();
  const sync = await sincronizarRelatorios();
  const admin = dbAdmin();

  // FIIs com posição ativa de usuários que ligaram a análise automática.
  const { data: autos } = await admin.from("usuarios").select("id, inv_relatorios_pessoal_auto").eq("inv_relatorios_auto", true);
  const idsAuto = new Set((autos ?? []).map((u) => String(u.id)));
  // Subordinado à análise automática: só quem ligou as duas ganha a etapa 2 junto.
  const idsPessoal = new Set((autos ?? []).filter((u) => u.inv_relatorios_pessoal_auto === true).map((u) => String(u.id)));
  let analisados = 0, ignorados = 0, falhasIA = 0, personalizados = 0;

  if (idsAuto.size > 0) {
    const { data: pos } = await admin.from("inv_posicoes")
      .select("ativo_id, inv_ativos!inner(id, user_id, ticker, nome, tipo_ativo)")
      .eq("status", "ATIVA").eq("inv_ativos.tipo_ativo", "FII");
    const vistos = new Set<string>();
    const ativos: AtivoFii[] = [];
    for (const p of pos ?? []) {
      const a = p.inv_ativos as unknown as { id: string; user_id: string; ticker: string; nome: string | null } | null;
      if (!a || !idsAuto.has(String(a.user_id)) || vistos.has(String(a.id))) continue;
      vistos.add(String(a.id)); ativos.push({ id: String(a.id), user_id: String(a.user_id), ticker: a.ticker, nome: a.nome });
    }

    const { data: rels } = await admin.from("inv_relatorios_fii").select("*")
      .gte("data_entrega", recuarDias(hojeISO(), JANELA_DIAS)).order("data_entrega", { ascending: false });
    const relatorios = (rels ?? []) as Relatorio[];

    const cfgPorUsuario = new Map<string, ConfigIAAtiva | null>();
    externo: for (const ativo of ativos) {
      const candidatos = relatorios.filter((r) => relatorioCasaComAtivo(ativo, r));
      // só o relatório mais recente por ativo na janela (evita reanalisar reapresentações)
      const rel = candidatos[0];
      if (!rel) continue;
      const { data: ja } = await admin.from("inv_analises_relatorio").select("id")
        .eq("user_id", ativo.user_id).eq("ativo_id", ativo.id).eq("relatorio_id", rel.id).maybeSingle();
      if (ja) { ignorados++; continue; }

      if (!cfgPorUsuario.has(ativo.user_id)) {
        const r = await lerConfigIAAtiva(admin, ativo.user_id);
        cfgPorUsuario.set(ativo.user_id, r.ok ? r.config : null);
      }
      const cfg = cfgPorUsuario.get(ativo.user_id);
      if (!cfg) { ignorados++; continue; }

      if (analisados >= MAX_ANALISES_POR_CRON || Date.now() - inicio > ORCAMENTO_CRON_MS) break externo; // o resto fica pro próximo dia
      const r = await analisarESalvar(admin, ativo.user_id, cfg, ativo, rel, "CRON");
      if (r.ok) {
        analisados++;
        if (idsPessoal.has(ativo.user_id) && await personalizarAnaliseSalva(admin, ativo.user_id, cfg, String(r.analise.id)) === "ok") personalizados++;
      } else falhasIA++;
    }
  }

  // Ações BR (CVM) e Stocks/REITs (EDGAR): mesmo job, mesmo orçamento de tempo/IA.
  let resultados: Record<string, unknown> = {};
  try {
    resultados = await processarResultadosCron(idsAuto, idsPessoal, {
      analisesRestantes: Math.max(MAX_ANALISES_POR_CRON - analisados, 0), prazoMs: inicio + ORCAMENTO_CRON_MS,
    });
  } catch (e) { logError("Resultados de empresas (cron)", e); resultados = { erro: String(e) }; }

  // Histórico: mantém só ~6 meses de análises (por competência; sem competência, pela data de criação).
  const corte = recuarDias(hojeISO(), DIAS_HISTORICO_ANALISES);
  const { count: expA } = await admin.from("inv_analises_relatorio").delete({ count: "exact" }).lt("data_referencia", corte);
  const { count: expB } = await admin.from("inv_analises_relatorio").delete({ count: "exact" }).is("data_referencia", null).lt("created_at", `${corte}T00:00:00Z`);

  const resumo = { ...sync, analisados, personalizados: personalizados + Number((resultados as { personalizados?: number }).personalizados ?? 0), expurgadas: (expA ?? 0) + (expB ?? 0), ignorados, falhas_analise: falhasIA, resultados, duracao_ms: Date.now() - inicio };
  logSuccess("Relatórios FII processados", resumo);
  return json({ dados: resumo });
}

// ============================================================
// /investimentos/relatorios-fii — rotas do usuário (sempre o próprio usuário
// autenticado; nunca honra X-Contexto-User-Id: gasta a chave de IA de quem pede)
//   GET  /relatorios-fii[?ativo_id=&limite=&nao_vistas=1]   análises salvas (nao_vistas: só as ainda não lidas)
//   GET  /relatorios-fii/disponiveis?ativo_id= relatórios do fundo (analisados ou não)
//   POST /relatorios-fii/analisar {ativo_id, relatorio_id?, config_id?}
//   POST /relatorios-fii/analise-pessoal {analise_id, config_id?}   etapa 2: personaliza a análise (perfil, posição, peso, tempo de carteira)
//   PUT  /relatorios-fii/:id {visto:boolean}
//   DELETE /relatorios-fii/:id
// ============================================================
export async function rotaRelatoriosFii(c: Db, req: Request, m: string, userId: string): Promise<Response> {
  const url = new URL(req.url);
  const partes = url.pathname.split("/").filter(Boolean);
  const sub = partes[partes.indexOf("relatorios-fii") + 1] ?? "";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (m === "GET" && sub === "") {
    const ativoId = url.searchParams.get("ativo_id");
    const limite = Math.min(Math.max(Number(url.searchParams.get("limite")) || 60, 1), 200);
    let q = c.from("inv_analises_relatorio")
      .select("*, inv_ativos(ticker, nome), inv_relatorios_fii(url_documento, fundo_nome, data_entrega), inv_documentos_resultado(url_documento, emissor_nome, data_entrega, tipo_doc, fonte)")
      .eq("user_id", userId).order("data_referencia", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }).limit(limite);
    if (ativoId) q = q.eq("ativo_id", ativoId);
    if (url.searchParams.get("nao_vistas") === "1") q = q.is("visto_em", null);
    q = q.or(`data_referencia.gte.${recuarDias(hojeISO(), DIAS_HISTORICO_ANALISES)},data_referencia.is.null`);
    const { data, error } = await q;
    if (error) { logError("Listar análises de relatório FII", error); return erro(error.message); }
    return json({ dados: data });
  }

  // Backfill sob demanda: o cron diário só olha ~12 dias, então um FII sem
  // relatório no cache (ou o "3 últimos") precisa buscar uma janela maior.
  if (m === "POST" && sub === "sincronizar") {
    const body = await req.json().catch(() => ({}));
    if (body.ativo_id) {
      const { data: alvo } = await c.from("inv_ativos").select("id, user_id, ticker, nome, tipo_ativo, acoes_subtipo")
        .eq("id", String(body.ativo_id)).eq("user_id", userId).maybeSingle();
      if (!alvo) return erro("Ativo não encontrado", 404);
      if ((TIPOS_COM_RESULTADO as readonly string[]).includes(String(alvo.tipo_ativo))) {
        const r = await sincronizarDocumentosAtivo(alvo as never);
        return json({ dados: r });
      }
    }
    const dias = Math.min(Math.max(Number(body.dias) || 100, 1), 120);
    const r = await sincronizarRelatorios({ dias, paginas: 60, orcamentoMs: 100_000 });
    if (r.gerenciais === 0 && r.falhas > 0) return erro("Fundos.NET indisponível no momento. Tente novamente em instantes.", 502);
    return json({ dados: r });
  }

  if (m === "GET" && sub === "disponiveis") {
    const ativoId = url.searchParams.get("ativo_id");
    if (!ativoId) return erro("ativo_id obrigatório");
    const { data: ativo } = await c.from("inv_ativos").select("id, ticker, nome, tipo_ativo").eq("id", ativoId).eq("user_id", userId).maybeSingle();
    if (!ativo) return erro("Ativo não encontrado", 404);
    if (ativo.tipo_ativo && (TIPOS_COM_RESULTADO as readonly string[]).includes(String(ativo.tipo_ativo))) {
      return json({ dados: await listarDisponiveis(c, userId, { id: String(ativo.id), ticker: String(ativo.ticker), tipo_ativo: String(ativo.tipo_ativo) }) });
    }
    const nucleo = nucleoTicker(String(ativo.ticker));
    const { data: rels, error } = await c.from("inv_relatorios_fii")
      .select("id, fundo_nome, fundo_pregao, data_referencia, data_entrega, url_documento")
      .or(`fundo_pregao.ilike.%${nucleo}%,fundo_nome.ilike.%${nucleo}%`)
      .order("data_entrega", { ascending: false }).limit(100);
    if (error) { logError("Relatórios disponíveis", error); return erro(error.message); }
    // o ilike pega só o núcleo do ticker; o casamento por nome roda sobre as últimas semanas
    const { data: recentes } = await c.from("inv_relatorios_fii")
      .select("id, fundo_nome, fundo_pregao, data_referencia, data_entrega, url_documento")
      .gte("data_entrega", recuarDias(hojeISO(), 120)).order("data_entrega", { ascending: false }).limit(1500);
    const mapa = new Map<number, Record<string, unknown>>();
    for (const r of [...(rels ?? []), ...(recentes ?? [])]) {
      const rr = r as { id: number; fundo_nome: string; fundo_pregao: string | null };
      if (relatorioCasaComAtivo({ ticker: String(ativo.ticker), nome: ativo.nome as string | null }, rr)) mapa.set(Number(rr.id), r);
    }
    const lista = [...mapa.values()].sort((a, b) => String(b.data_entrega).localeCompare(String(a.data_entrega))).slice(0, 12);
    const { data: feitas } = await c.from("inv_analises_relatorio").select("relatorio_id").eq("user_id", userId).eq("ativo_id", ativoId);
    const analisados = new Set((feitas ?? []).map((f) => Number(f.relatorio_id)));
    return json({ dados: lista.map((r) => ({ ...r, analisado: analisados.has(Number(r.id)) })) });
  }

  if (m === "POST" && sub === "analisar") {
    const body = await req.json().catch(() => ({}));
    logRequest("POST", "/investimentos/relatorios-fii/analisar", body);
    if (!body.ativo_id) return erro("ativo_id obrigatório");
    const { data: ativo } = await c.from("inv_ativos").select("id, user_id, ticker, nome, tipo_ativo")
      .eq("id", String(body.ativo_id)).eq("user_id", userId).maybeSingle();
    if (!ativo) return erro("Ativo não encontrado", 404);
    const ehDoc = (TIPOS_COM_RESULTADO as readonly string[]).includes(String(ativo.tipo_ativo));
    if (ativo.tipo_ativo !== "FII" && !ehDoc) return erro("Este tipo de ativo não tem relatório periódico para analisar");

    // config_id (opcional): usa outro motor de IA já cadastrado, sem trocar a ativa.
    const cfgRes = await lerConfigIAAtiva(c, userId, body.config_id ? String(body.config_id) : undefined);
    if (!cfgRes.ok) return erro(cfgRes.erro, cfgRes.status);

    if (ehDoc) {
      const alvo = { id: String(ativo.id), user_id: userId, ticker: String(ativo.ticker), nome: ativo.nome as string | null, tipo_ativo: String(ativo.tipo_ativo) };
      const docs = await documentosDoAtivo(c, alvo, 24);
      const doc = body.relatorio_id != null ? docs.find((d) => d.id === String(body.relatorio_id)) : docs[0];
      if (!doc) return erro("Nenhum documento de resultado encontrado para este ativo. Use \"Buscar relatórios\" primeiro.", 404);
      const rd = await analisarESalvarDocumento(c, userId, cfgRes.config, alvo, doc, "MANUAL");
      if (!rd.ok) return erro(rd.erro, rd.status);
      return json({ dados: rd.analise }, 201);
    }

    const admin = dbAdmin();
    let rel: Relatorio | null = null;
    if (body.relatorio_id != null) {
      const { data } = await admin.from("inv_relatorios_fii").select("*").eq("id", Number(body.relatorio_id)).maybeSingle();
      rel = data as Relatorio | null;
      if (rel && !relatorioCasaComAtivo({ ticker: String(ativo.ticker), nome: ativo.nome as string | null }, rel)) {
        return erro("Este relatório não pertence ao fundo selecionado", 400);
      }
    } else {
      const { data: recentes } = await admin.from("inv_relatorios_fii").select("*")
        .gte("data_entrega", recuarDias(hojeISO(), 120)).order("data_entrega", { ascending: false }).limit(1500);
      rel = ((recentes ?? []) as Relatorio[]).find((r) => relatorioCasaComAtivo({ ticker: String(ativo.ticker), nome: ativo.nome as string | null }, r)) ?? null;
    }
    if (!rel) return erro("Nenhum relatório gerencial recente encontrado para este fundo (o cron diário busca os publicados nos últimos dias).", 404);

    const r = await analisarESalvar(c, userId, cfgRes.config, { id: String(ativo.id), user_id: userId, ticker: String(ativo.ticker), nome: ativo.nome as string | null }, rel, "MANUAL");
    if (!r.ok) return erro(r.erro, r.status);
    return json({ dados: r.analise }, 201);
  }

  // Etapa 2: parte da análise da etapa 1 já salva (não relê o relatório) e cruza com o
  // contexto do dono. Gasta a chave de IA de quem pede, por isso é sempre sob demanda.
  if (m === "POST" && sub === "analise-pessoal") {
    const body = await req.json().catch(() => ({}));
    if (!body.analise_id || !UUID.test(String(body.analise_id))) return erro("analise_id obrigatório");
    const { data: base } = await c.from("inv_analises_relatorio")
      .select("id, ativo_id, veredito, resumo, pontos_fortes, pontos_atencao, inconsistencias, mudancas")
      .eq("id", String(body.analise_id)).eq("user_id", userId).maybeSingle();
    if (!base) return erro("Análise não encontrada", 404);
    const { data: ativo } = await c.from("inv_ativos").select("id, ticker, tipo_ativo")
      .eq("id", String(base.ativo_id)).eq("user_id", userId).maybeSingle();
    if (!ativo) return erro("Ativo não encontrado", 404);

    const ctx = await carregarContextoPessoal(c, userId, { id: String(ativo.id), ticker: String(ativo.ticker), tipo_ativo: String(ativo.tipo_ativo) });
    if (!ctx) return erro("Você não tem posição ativa neste ativo — não há o que personalizar.", 409);

    const cfgRes = await lerConfigIAAtiva(c, userId, body.config_id ? String(body.config_id) : undefined);
    if (!cfgRes.ok) return erro(cfgRes.erro, cfgRes.status);
    let pessoal;
    try {
      pessoal = await gerarAnalisePessoal(cfgRes.config, ctx, base as never);
    } catch (e) {
      logError("Análise pessoal (IA)", e);
      return erro(e instanceof ErroIA ? e.message : "Falha ao consultar a IA.", e instanceof ErroIA ? e.statusResposta : 502);
    }
    const { data, error } = await c.from("inv_analises_relatorio").update({ analise_pessoal: pessoal })
      .eq("id", base.id).eq("user_id", userId).select().single();
    if (error) { logError("Salvar análise pessoal", error); return erro(error.message, 500); }
    return json({ dados: data }, 201);
  }

  if (m === "PUT" && UUID.test(sub)) {
    const body = await req.json().catch(() => ({}));
    const { data, error } = await c.from("inv_analises_relatorio")
      .update({ visto_em: body.visto === false ? null : new Date().toISOString() })
      .eq("id", sub).eq("user_id", userId).select().maybeSingle();
    if (error) return erro(error.message);
    if (!data) return erro("Análise não encontrada", 404);
    return json({ dados: data });
  }

  if (m === "DELETE" && UUID.test(sub)) {
    const { error } = await c.from("inv_analises_relatorio").delete().eq("id", sub).eq("user_id", userId);
    if (error) return erro(error.message);
    return json({ mensagem: "Análise excluída" });
  }

  return erro("Rota não encontrada", 404);
}
