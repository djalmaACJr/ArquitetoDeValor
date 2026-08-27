// supabase/functions/investimentos/avaliacoes.ts
// Rotas /investimentos/questionarios e /investimentos/avaliacoes (mentores IA).
// Extraído de index.ts.
import { json, erro, extrairAcao } from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import { chamarProvedorIA, ErroIA, lerConfigIAAtiva, lerMentoresIA } from "../_shared/ia.ts";
import {
  Db, TIPOS_ATIVO, CRITERIOS_QUESTAO, PESOS_SUGERIDOS_POR_PERFIL,
  PESOS_PADRAO_CRITERIO, TIPO_ATIVO_LABEL_BR,
} from "./shared.ts";
import { buscarFatosRelevantesParaAtivo, descreverFatosRelevantes } from "./fatosRelevantes.ts";

export function segmentoTipo(req: Request): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf("questionarios");
  if (idx === -1 || idx + 1 >= partes.length) return null;
  return decodeURIComponent(partes[idx + 1]);
}

// Valida o payload { perguntas, pesos } de um questionário. Retorna
// string de erro ou null se válido.
export function validarQuestionario(perguntas: unknown, pesos: unknown): string | null {
  if (!Array.isArray(perguntas) || perguntas.length < 10) {
    return "perguntas deve ser um array com no mínimo 10 questões";
  }
  const ids = new Set<string>();
  for (const p of perguntas as Array<Record<string, unknown>>) {
    const id = String(p?.id ?? "").trim();
    if (!id) return "cada pergunta precisa de um id";
    if (ids.has(id)) return `id de pergunta duplicado: ${id}`;
    ids.add(id);
    if (!String(p?.texto ?? "").trim()) return `pergunta ${id} sem texto`;
    if (!CRITERIOS_QUESTAO.includes(String(p?.criterio))) {
      return `pergunta ${id} com critério inválido (use FUNDAMENTOS, CRESCIMENTO, DIVIDENDOS ou VALUATION)`;
    }
    const opcoes = p?.opcoes;
    if (!Array.isArray(opcoes) || opcoes.length !== 5 || opcoes.some((o) => !String(o ?? "").trim())) {
      return `pergunta ${id} precisa de exatamente 5 opções não vazias`;
    }
  }
  // Cada critério deve ter ao menos 1 pergunta (questionário cobre os 3).
  for (const cr of CRITERIOS_QUESTAO) {
    if (!(perguntas as Array<Record<string, unknown>>).some((p) => String(p?.criterio) === cr)) {
      return `o questionário precisa cobrir o critério ${cr}`;
    }
  }
  const pe = pesos as Record<string, unknown> | null;
  if (!pe || typeof pe !== "object") return "pesos é obrigatório";
  let soma = 0;
  for (const cr of CRITERIOS_QUESTAO) {
    const v = Number(pe[cr]);
    if (!Number.isFinite(v) || v < 0 || v > 100) return `peso inválido para ${cr}`;
    soma += v;
  }
  if (Math.abs(soma - 100) > 0.5) return `a soma dos pesos deve ser 100 (atual: ${soma})`;
  return null;
}

export async function rotaQuestionarios(c: Db, req: Request, m: string, userId: string) {
  const tipo = segmentoTipo(req);

  // Lista todos os custom
  if (m === "GET" && !tipo) {
    logRequest("GET", "/investimentos/questionarios");
    const { data, error } = await c.from("inv_questionarios").select("*").order("tipo_ativo");
    if (error) { logError("Listar questionarios", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (tipo && !TIPOS_ATIVO.includes(tipo)) return erro(`tipo_ativo inválido: ${tipo}`);

  // Geração por IA: POST /questionarios/:tipo/gerar
  const acao = extrairAcao(req, "questionarios"); // 3º segmento após "questionarios"
  if (m === "POST" && tipo && acao === "gerar") {
    return await gerarQuestionarioIA(c, req, tipo!, userId);
  }

  if (m === "GET" && tipo) {
    const { data, error } = await c.from("inv_questionarios").select("*").eq("tipo_ativo", tipo).maybeSingle();
    if (error) { logError("Buscar questionario", error); return erro(error.message); }
    if (!data) return erro("Sem questionário customizado para este tipo", 404);
    return json({ dados: data });
  }

  if (m === "PUT" && tipo) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/questionarios/${tipo}`);
    const validacao = validarQuestionario(body?.perguntas, body?.pesos);
    if (validacao) return erro(validacao);

    const origem = body?.origem === "IA" ? "IA" : "MANUAL";
    const linha = {
      user_id:     userId,
      tipo_ativo:  tipo,
      perguntas:   body.perguntas,
      pesos:       body.pesos,
      origem,
      ia_provedor: origem === "IA" ? (body?.ia_provedor ?? null) : null,
      ia_modelo:   origem === "IA" ? (body?.ia_modelo ?? null) : null,
      ia_gerou_em: origem === "IA" ? new Date().toISOString() : null,
      updated_at:  new Date().toISOString(),
    };
    const { data, error } = await c
      .from("inv_questionarios")
      .upsert(linha, { onConflict: "user_id,tipo_ativo" })
      .select()
      .single();
    if (error) { logError("Upsert questionario", error); return erro(error.message); }
    logSuccess("Questionário salvo", { tipo, origem });
    return json({ dados: data });
  }

  if (m === "DELETE" && tipo) {
    const { error } = await c.from("inv_questionarios").delete().eq("tipo_ativo", tipo);
    if (error) { logError("Excluir questionario", error); return erro(error.message); }
    return json({ dados: { tipo_ativo: tipo, removido: true } });
  }

  return erro("Método não permitido", 405);
}

// Pede ao provedor de IA do usuário para montar o questionário. NÃO
// persiste — devolve { perguntas, pesos, ia_provedor, ia_modelo } para
// pré-visualização; o frontend salva via PUT (origem='IA').
export async function gerarQuestionarioIA(c: Db, req: Request, tipo: string, userId: string) {
  logRequest("POST", `/investimentos/questionarios/${tipo}/gerar`);

  const cfg = await lerConfigIAAtiva(c, userId);
  if (!cfg.ok) return erro(cfg.erro, cfg.status);
  const { provedor, modelo, apiKey } = cfg.config;

  // Perfil + pesos globais do usuário (a "matriz de pesos dinâmicos" do prompt).
  const { data: perfilRow } = await c.from("usuarios")
    .select("inv_perfil, inv_pesos_criterio").eq("id", userId).maybeSingle();
  const perfil = (perfilRow?.inv_perfil ?? null) as
    | { perfil?: string; idade?: number; idade_aposentadoria?: number }
    | null;

  // Pesos efetivos: globais salvos > sugeridos pelo perfil > padrão (Moderado).
  const pesosSalvos = (perfilRow?.inv_pesos_criterio ?? null) as Record<string, number> | null;
  const pesosBase = pesosSalvos
    ?? (perfil?.perfil ? PESOS_SUGERIDOS_POR_PERFIL[perfil.perfil] : null)
    ?? PESOS_PADRAO_CRITERIO;
  const pf = Math.round(Number(pesosBase.FUNDAMENTOS) || 0);
  const pc = Math.round(Number(pesosBase.CRESCIMENTO) || 0);
  const pr = Math.round(Number(pesosBase.DIVIDENDOS) || 0);
  const pv = Math.round(Number(pesosBase.VALUATION) || 0);
  const pesosFinais = { FUNDAMENTOS: pf, CRESCIMENTO: pc, DIVIDENDOS: pr, VALUATION: pv };

  const ctxPerfil = perfil?.perfil
    ? `Perfil do investidor: ${perfil.perfil}. Idade: ${perfil.idade ?? "?"}. ` +
      `Idade de aposentadoria pretendida: ${perfil.idade_aposentadoria ?? "?"}.`
    : "Perfil do investidor: não informado.";

  const rotuloTipo = TIPO_ATIVO_LABEL_BR[tipo] ?? tipo;

  const system =
    "Você é um analista de sistemas e engenheiro financeiro especializado em alocação de ativos de " +
    "longo prazo (Buy and Hold). Gere um questionário de auditoria estrito, em português do Brasil, " +
    "para avaliar a viabilidade e a qualidade de um tipo de ativo. Responda SOMENTE com um JSON " +
    "válido (sem markdown, sem comentários, sem texto fora do JSON) no formato exato:\n" +
    '{ "perguntas": [ { "id": "slug_curto", "texto": "...", ' +
    '"criterio": "FUNDAMENTOS|CRESCIMENTO|DIVIDENDOS|VALUATION", ' +
    '"opcoes": ["pior","...","...","...","melhor"] } ], ' +
    '"pesos": { "FUNDAMENTOS": int, "CRESCIMENTO": int, "DIVIDENDOS": int, "VALUATION": int } }\n' +
    "Regras OBRIGATÓRIAS: gere EXATAMENTE 40 perguntas — 10 por critério, na ordem FUNDAMENTOS, " +
    "CRESCIMENTO, DIVIDENDOS, VALUATION. Cada pergunta com EXATAMENTE 5 opções ordenadas da pior " +
    "(índice 0) à melhor (índice 4), específicas ao indicador da pergunta (evite repetir sempre a " +
    "mesma escala genérica). ids curtos, únicos, em snake_case. Os pesos devem ser EXATAMENTE os " +
    "informados na matriz abaixo.";
  const userMsg =
    `Tipo de ativo a auditar: ${rotuloTipo} (código ${tipo}).\n${ctxPerfil}\n\n` +
    "Matriz de pesos dinâmicos (cada seção = 10 questões de um critério):\n" +
    `1. FUNDAMENTOS E GOVERNANÇA — critério FUNDAMENTOS (peso ${pf}%): saúde financeira estrutural, ` +
    "barreiras de entrada, perenidade, alavancagem/endividamento e alinhamento da gestão/emissor.\n" +
    `2. CRESCIMENTO E RESILIÊNCIA — critério CRESCIMENTO (peso ${pc}%): capacidade de expansão, ganho ` +
    "de eficiência, escalabilidade do modelo e comportamento diante de ciclos macroeconômicos ou inflação.\n" +
    `3. GERAÇÃO DE RENDA / FLUXO DE CAIXA — critério DIVIDENDOS (peso ${pr}%): regularidade do retorno ` +
    "em caixa, sustentabilidade do fluxo de pagamentos (se aplicável) ou custo de oportunidade de carregar o ativo.\n" +
    `4. MARGEM DE SEGURANÇA E VALUATION — critério VALUATION (peso ${pv}%): múltiplos atuais de preço, ` +
    "se o ativo está historicamente caro ou barato, e quais premissas de risco estão embutidas no preço atual.\n\n" +
    "Cada pergunta deve ser direta, focada em dados, fatos ou indicadores claros do mercado deste ativo " +
    "específico. Gere agora o JSON do questionário.";

  let bruto: string;
  try {
    bruto = await chamarProvedorIA(provedor, {
      apiKey,
      persona: system,
      mensagens: [{ role: "user", content: userMsg }],
      maxTokens: 8000,
      modelo: modelo ?? undefined,
    });
  } catch (e) {
    logError("Gerar questionario IA", e);
    // ErroIA já traz mensagem amigável (pt-BR) e o status HTTP adequado.
    if (e instanceof ErroIA) return erro(e.message, e.statusResposta);
    const msg = e instanceof Error ? e.message : String(e);
    return erro(`Não consegui falar com a IA (${provedor}) agora. Tente novamente em instantes. (${msg.slice(0, 160)})`, 502);
  }

  const parsed = extrairJson(bruto);
  if (!parsed) return erro("A IA não retornou um JSON válido. Tente novamente.", 502);
  // Pesos são autoritativos (a matriz do usuário); ignoramos o que a IA devolveu.
  const validacao = validarQuestionario(parsed.perguntas, pesosFinais);
  if (validacao) return erro(`A IA retornou um questionário inválido: ${validacao}`, 502);

  return json({
    dados: {
      tipo_ativo:  tipo,
      perguntas:   parsed.perguntas,
      pesos:       pesosFinais,
      ia_provedor: provedor,
      ia_modelo:   modelo,
    },
  });
}

// Extrai o primeiro objeto JSON do texto da IA (tolera cercas ```json e
// texto ao redor). Retorna null se não conseguir parsear.
export function extrairJson(texto: string): { perguntas: unknown; pesos: unknown } | null {
  if (!texto) return null;
  let s = texto.trim();
  // Remove cercas de código markdown se houver.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Recorta do primeiro { ao último }.
  const ini = s.indexOf("{");
  const fim = s.lastIndexOf("}");
  if (ini === -1 || fim <= ini) return null;
  try {
    const obj = JSON.parse(s.slice(ini, fim + 1));
    return { perguntas: obj?.perguntas, pesos: obj?.pesos };
  } catch {
    return null;
  }
}

// ============================================================
// /investimentos/avaliacoes — avaliação da carteira pelos MENTORES
// (todas as IAs configuradas em usuarios.ia_configs).
//
// Orquestração MENTOR a MENTOR (em paralelo no frontend), para barra de
// progresso por mentor:
//   GET  /avaliacoes          → lista as avaliações salvas do usuário
//   POST /avaliacoes/mentor   → 1 mentor avalia 1 ativo (NÃO persiste)
//                               body { ativo_id, config_id, perguntas, pesos }
//   POST /avaliacoes/salvar   → consolida as respostas dos mentores de 1
//                               ativo, calcula o consenso, persiste e
//                               sobrescreve a nota do ativo
//                               body { ativo_id, perguntas, pesos, mentores }
// ============================================================

export interface PerguntaAv { id: string; texto: string; criterio: string; opcoes: string[] }

// Resultado de um mentor para um ativo (espelha InvAvaliacaoMentor no front).
export interface ResMentor {
  config_id: string; nome: string | null; provedor: string; modelo: string | null;
  nota: number | null; respostas: Record<string, number>; erro: string | null;
}

// Replica calcularNota do frontend (lib/questionarioAtivos.ts): nota de
// cada critério = média dos índices respondidos × 2,5; nota final = média
// ponderada pelos pesos dos critérios COM resposta. Null se nada respondido.
export function calcularNotaBackend(
  perguntas: PerguntaAv[],
  pesos: Record<string, number>,
  respostas: Record<string, number>,
): number | null {
  const notasPorCriterio = new Map<string, number>();
  for (const criterio of CRITERIOS_QUESTAO) {
    const doCriterio = perguntas.filter(
      (p) => p.criterio === criterio &&
        Number.isInteger(respostas[p.id]) && respostas[p.id] >= 0 && respostas[p.id] <= 4,
    );
    if (doCriterio.length === 0) continue;
    const soma = doCriterio.reduce((s, p) => s + respostas[p.id], 0);
    notasPorCriterio.set(criterio, (soma / doCriterio.length) * 2.5);
  }
  if (notasPorCriterio.size === 0) return null;

  let somaPond = 0, somaPeso = 0;
  for (const [criterio, nota] of notasPorCriterio) {
    const peso = Math.max(0, Number(pesos[criterio]) || 0);
    somaPond += nota * peso;
    somaPeso += peso;
  }
  if (somaPeso === 0) {
    const media = [...notasPorCriterio.values()].reduce((s, n) => s + n, 0) / notasPorCriterio.size;
    return Math.round(media * 10) / 10;
  }
  return Math.round((somaPond / somaPeso) * 10) / 10;
}

// Mediana de uma lista (não vazia) de números.
export function mediana(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Desvio-padrão populacional (0 se < 2 elementos).
export function desvioPadrao(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = nums.reduce((s, v) => s + v, 0) / nums.length;
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length);
}

// Extrai o primeiro objeto JSON do texto da IA (tolera cercas ```json e
// texto ao redor). Versão genérica (devolve o objeto inteiro).
export function extrairJsonObj(texto: string): Record<string, unknown> | null {
  if (!texto) return null;
  let s = texto.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const ini = s.indexOf("{");
  const fim = s.lastIndexOf("}");
  if (ini === -1 || fim <= ini) return null;
  try {
    return JSON.parse(s.slice(ini, fim + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Descrição curta do ativo para contextualizar o mentor.
export function descreverAtivo(a: Record<string, unknown>): string {
  const partes = [
    `Ticker: ${a.ticker}`,
    `Nome: ${a.nome ?? "?"}`,
    `Tipo: ${TIPO_ATIVO_LABEL_BR[String(a.tipo_ativo)] ?? a.tipo_ativo}`,
    a.moeda ? `Moeda: ${a.moeda}` : "",
    a.setor ? `Setor: ${a.setor}` : "",
    a.fii_categoria ? `Categoria FII: ${a.fii_categoria}` : "",
    a.acoes_subtipo ? `Subtipo: ${a.acoes_subtipo}` : "",
    a.rf_subtipo ? `Título RF: ${a.rf_subtipo}` : "",
    a.rf_indexador ? `Indexador: ${a.rf_indexador}` : "",
    a.rf_taxa ? `Taxa: ${a.rf_taxa}` : "",
    a.rf_emissor ? `Emissor: ${a.rf_emissor}` : "",
    a.rf_vencimento ? `Vencimento: ${a.rf_vencimento}` : "",
    a.descricao ? `Obs.: ${a.descricao}` : "",
  ].filter(Boolean);
  return partes.join(" · ");
}

// Segmento de ação após "avaliacoes" no path (ex.: "mentor" | "salvar").
export function segmentoAcaoAval(req: Request): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf("avaliacoes");
  if (idx === -1 || idx + 1 >= partes.length) return null;
  return decodeURIComponent(partes[idx + 1]);
}

// Normaliza/valida o objeto bruto de respostas da IA → { id: indice 0..4 }
// apenas para ids do questionário. Devolve {} se nada reconhecível.
export function normalizarRespostas(raw: unknown, idsValidos: Set<string>): Record<string, number> {
  const respostas: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return respostas;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!idsValidos.has(id)) continue;
    const idx = Math.round(Number(v));
    if (Number.isFinite(idx) && idx >= 0 && idx <= 4) respostas[id] = idx;
  }
  return respostas;
}

// Um mentor avalia um ativo (1 chamada de IA). Nunca lança — devolve o
// resultado com `erro` preenchido em caso de falha (não derruba o lote).
//
// `c` só é usado para buscar o contexto factual de Fatos Relevantes (FII) —
// dado compartilhado, cacheado pelo cron `fatos-relevantes-diario` (ver
// fatosRelevantes.ts). Falha/ausência desse contexto NUNCA impede a
// avaliação — o mentor só perde esse reforço e segue com seu conhecimento
// de mercado, como antes.
export async function avaliarUmMentor(
  c: Db,
  mentor: { id: string; nome: string | null; provedor: string; modelo: string | null; apiKey: string; buscaWeb: boolean },
  ativo: Record<string, unknown>,
  perguntas: PerguntaAv[],
  pesos: Record<string, number>,
): Promise<ResMentor> {
  const base: ResMentor = {
    config_id: mentor.id, nome: mentor.nome, provedor: mentor.provedor,
    modelo: mentor.modelo, nota: null, respostas: {}, erro: null,
  };
  const idsValidos = new Set(perguntas.map((p) => p.id));
  const persona =
    "Você é um analista financeiro especializado em alocação de ativos de longo prazo (Buy and Hold). " +
    "Avalie o ativo informado respondendo ao questionário de auditoria. Para CADA pergunta, escolha o " +
    "índice (0 a 4) da opção que melhor reflete a realidade do ativo — 0 = pior, 4 = melhor. Priorize os " +
    "Fatos Relevantes/Comunicados informados abaixo (se houver) sobre seu conhecimento de treinamento — " +
    "eles são publicações oficiais recentes do próprio fundo/empresa. Na ausência deles, use seu " +
    "conhecimento de mercado sobre o ativo. Responda SOMENTE com um JSON válido (sem markdown, sem " +
    'comentários, sem texto fora do JSON) no formato exato: { "respostas": { "<id_da_pergunta>": indice_0_a_4 } }. ' +
    "Inclua TODAS as perguntas. Se não tiver dados sobre algum aspecto, escolha o índice mais neutro/conservador.";
  const perguntasTxt = perguntas.map((p) =>
    `- id "${p.id}" [${p.criterio}]: ${p.texto}\n  opções: ${p.opcoes.map((o, i) => `${i}=${o}`).join(" | ")}`
  ).join("\n");

  // Contexto factual: só existe fonte cacheada pra FII (Fundos.NET). Falha
  // silenciosa de propósito (ver comentário da função).
  let blocoFatos = "";
  if (ativo.tipo_ativo === "FII") {
    try {
      const ticker = String(ativo.ticker ?? "");
      const fatos = await buscarFatosRelevantesParaAtivo(c, ticker, (ativo.nome as string | null) ?? null);
      blocoFatos = descreverFatosRelevantes(fatos);
    } catch (e) {
      logError("Buscar fatos relevantes p/ mentor", e); // nunca derruba a avaliação
    }
  }

  const userMsg =
    `Ativo a avaliar:\n${descreverAtivo(ativo)}\n\n` +
    (blocoFatos ? `${blocoFatos}\n\n` : "") +
    `Questionário (${perguntas.length} perguntas):\n${perguntasTxt}\n\n` +
    "Devolva agora o JSON com as respostas (índice 0..4) de TODAS as perguntas.";

  try {
    const bruto = await chamarProvedorIA(mentor.provedor, {
      apiKey: mentor.apiKey,
      persona,
      mensagens: [{ role: "user", content: userMsg }],
      maxTokens: 4000,
      modelo: mentor.modelo ?? undefined,
      buscaWeb: mentor.buscaWeb,
    });
    const parsed = extrairJsonObj(bruto);
    const respostas = normalizarRespostas(parsed?.respostas ?? parsed, idsValidos);
    if (Object.keys(respostas).length === 0) {
      base.erro = "A IA não retornou respostas reconhecíveis.";
    } else {
      base.respostas = respostas;
      base.nota = calcularNotaBackend(perguntas, pesos, respostas);
    }
  } catch (e) {
    base.erro = e instanceof ErroIA ? e.message
      : `Falha ao falar com a IA (${mentor.provedor}). ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
  }
  return base;
}

export async function rotaAvaliacoes(c: Db, req: Request, m: string, userId: string) {
  // Lista as avaliações salvas
  if (m === "GET") {
    logRequest("GET", "/investimentos/avaliacoes");
    const { data, error } = await c.from("inv_avaliacoes").select("*").order("gerado_em", { ascending: false });
    if (error) { logError("Listar avaliacoes", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m !== "POST") return erro("Método não permitido", 405);

  const acao = segmentoAcaoAval(req);
  const body = await req.json();
  const ativoId = String(body?.ativo_id ?? "").trim();
  if (!ativoId) return erro("ativo_id é obrigatório");

  const perguntas = body?.perguntas as PerguntaAv[];
  const pesos = body?.pesos as Record<string, number>;
  const validacao = validarQuestionario(perguntas, pesos);
  if (validacao) return erro(`Questionário inválido: ${validacao}`);

  // ── POST /avaliacoes/mentor — 1 mentor avalia 1 ativo (sem persistir) ──
  if (acao === "mentor") {
    const configId = String(body?.config_id ?? "").trim();
    if (!configId) return erro("config_id é obrigatório");
    logRequest("POST", `/investimentos/avaliacoes/mentor (ativo ${ativoId}, mentor ${configId})`);

    const { data: ativo, error: errAtivo } = await c.from("inv_ativos").select("*").eq("id", ativoId).maybeSingle();
    if (errAtivo) { logError("Buscar ativo p/ avaliação", errAtivo); return erro(errAtivo.message); }
    if (!ativo) return erro("Ativo não encontrado", 404);

    const resMentores = await lerMentoresIA(c, userId);
    if (!resMentores.ok) return erro(resMentores.erro, resMentores.status);
    const mentor = resMentores.mentores.find((x) => x.id === configId);
    if (!mentor) return erro("Mentor não encontrado", 404);

    const r = await avaliarUmMentor(c, mentor, ativo, perguntas, pesos);
    return json({ dados: r });
  }

  // ── POST /avaliacoes/salvar — consolida os mentores e persiste ──
  if (acao === "salvar") {
    logRequest("POST", `/investimentos/avaliacoes/salvar (ativo ${ativoId})`);

    const recebidos = Array.isArray(body?.mentores) ? (body.mentores as ResMentor[]) : [];
    if (recebidos.length === 0) return erro("Nenhum resultado de mentor informado");

    const idsValidos = new Set(perguntas.map((p) => p.id));
    // Recalcula a nota de cada mentor a partir das respostas (não confia no
    // que o cliente mandou) e revalida os índices.
    const resultados: ResMentor[] = recebidos.map((r) => {
      const respostas = normalizarRespostas(r?.respostas, idsValidos);
      const temResposta = Object.keys(respostas).length > 0;
      return {
        config_id: String(r?.config_id ?? ""),
        nome: r?.nome ?? null,
        provedor: String(r?.provedor ?? ""),
        modelo: r?.modelo ?? null,
        respostas: temResposta ? respostas : {},
        nota: temResposta ? calcularNotaBackend(perguntas, pesos, respostas) : null,
        erro: temResposta ? null : (r?.erro ?? "Sem respostas."),
      };
    });

    const ok = resultados.filter((r) => r.erro === null && r.nota != null);
    if (ok.length === 0) {
      const primeiro = resultados.find((r) => r.erro)?.erro;
      return erro(primeiro ?? "Nenhum mentor conseguiu avaliar este ativo.", 502);
    }

    // Consolidação por pergunta: média e mediana dos índices das IAs. Se a
    // diferença entre média e mediana for < 10% (relativa à média), usa a
    // média; caso contrário usa a mediana (reduz impacto de notas extremas).
    const perguntasConsenso = perguntas.map((p) => {
      const valores = ok.map((r) => r.respostas[p.id]).filter((v) => Number.isInteger(v));
      if (valores.length === 0) return { id: p.id, media_indice: null as number | null, media_nota: null as number | null };
      const media = valores.reduce((s, v) => s + v, 0) / valores.length;
      const med = mediana(valores);
      const consolidado = (media === 0 || Math.abs(media - med) / media < 0.10) ? media : med;
      return {
        id: p.id,
        media_indice: Math.round(consolidado * 100) / 100,
        media_nota: Math.round(consolidado * 2.5 * 10) / 10,
      };
    });

    // Nota de cada critério = média das notas (consolidadas) das suas perguntas.
    const criterioDe = new Map(perguntas.map((p) => [p.id, p.criterio]));
    const notaPorPergunta = new Map(perguntasConsenso.map((p) => [p.id, p.media_nota]));
    const criterios: Record<string, number | null> = {};
    for (const cr of CRITERIOS_QUESTAO) {
      const ns = perguntas
        .filter((p) => criterioDe.get(p.id) === cr)
        .map((p) => notaPorPergunta.get(p.id))
        .filter((v): v is number => typeof v === "number");
      criterios[cr] = ns.length ? Math.round((ns.reduce((s, v) => s + v, 0) / ns.length) * 10) / 10 : null;
    }

    // Nota final = média PONDERADA das notas dos critérios pelos pesos.
    let somaPond = 0, somaPeso = 0;
    for (const cr of CRITERIOS_QUESTAO) {
      const nota = criterios[cr];
      if (nota == null) continue;
      const peso = Math.max(0, Number(pesos[cr]) || 0);
      somaPond += nota * peso;
      somaPeso += peso;
    }
    const comNota = CRITERIOS_QUESTAO.map((cr) => criterios[cr]).filter((v): v is number => v != null);
    const notaFinal = somaPeso > 0
      ? Math.round((somaPond / somaPeso) * 10) / 10
      : (comNota.length ? Math.round((comNota.reduce((s, v) => s + v, 0) / comNota.length) * 10) / 10 : null);

    // Nível de consenso entre as IAs pela dispersão das notas finais delas.
    const notasMentores = ok.map((r) => r.nota).filter((v): v is number => v != null);
    const dispersao = Math.round(desvioPadrao(notasMentores) * 100) / 100;
    const nivel_consenso = notasMentores.length < 2 ? "ALTO" : dispersao < 1 ? "ALTO" : dispersao < 2 ? "MEDIO" : "BAIXO";

    const consenso = { pesos, perguntas: perguntasConsenso, mentores: resultados, criterios, nivel_consenso, dispersao };
    const agora = new Date().toISOString();

    // Histórico: lê a avaliação atual (que será substituída) e acrescenta a
    // nova ao final. Se a linha existente ainda não tinha histórico, semeia
    // com a avaliação anterior para já permitir a comparação subiu/desceu.
    interface HistItem { gerado_em: string; nota_final: number | null; criterios: Record<string, number | null> | null }
    const { data: existente } = await c
      .from("inv_avaliacoes")
      .select("nota_final, gerado_em, consenso, historico")
      .eq("ativo_id", ativoId)
      .maybeSingle();
    const histAtual: HistItem[] = Array.isArray(existente?.historico) ? existente!.historico as HistItem[] : [];
    if (histAtual.length === 0 && existente && existente.nota_final != null) {
      histAtual.push({
        gerado_em: existente.gerado_em ?? agora,
        nota_final: existente.nota_final as number,
        criterios: ((existente.consenso as Record<string, unknown> | null)?.criterios as Record<string, number | null> | null) ?? null,
      });
    }
    histAtual.push({ gerado_em: agora, nota_final: notaFinal, criterios });
    const historico = histAtual.slice(-24);

    const { data: avaliacao, error: errUpsert } = await c
      .from("inv_avaliacoes")
      .upsert({
        user_id: userId, ativo_id: ativoId, nota_final: notaFinal,
        consenso, historico, gerado_em: agora, updated_at: agora,
      }, { onConflict: "user_id,ativo_id" })
      .select()
      .single();
    if (errUpsert) { logError("Upsert avaliacao", errUpsert); return erro(errUpsert.message); }

    // Consenso vira a nota oficial do ativo. As respostas gravadas são o
    // índice médio arredondado por pergunta (rastreabilidade).
    const respostasConsenso: Record<string, number> = {};
    for (const p of perguntasConsenso) if (p.media_indice != null) respostasConsenso[p.id] = Math.round(p.media_indice);
    const { error: errAtualizaAtivo } = await c
      .from("inv_ativos")
      .update({ nota_usuario: notaFinal, questionario_respostas: respostasConsenso })
      .eq("id", ativoId);
    if (errAtualizaAtivo) logError("Atualizar nota do ativo", errAtualizaAtivo);

    logSuccess("Ativo avaliado pelos mentores", { ativo: ativoId, mentores: ok.length, nota: notaFinal });
    return json({ dados: avaliacao });
  }

  return erro("Ação inválida. Use /avaliacoes/mentor ou /avaliacoes/salvar.", 400);
}
