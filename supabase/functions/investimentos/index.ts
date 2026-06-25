// ============================================================
// Arquiteto de Valor — Edge Function: investimentos v1
// ============================================================
// Roteia por recurso sob /investimentos/<recurso>:
//   ativos | alocacoes | posicoes | operacoes | dividendos | dashboard
// Mantém o padrão do projeto: uma função por diretório top-level,
// roteamento interno por método/rota, RLS por user_id = auth.uid().
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  json, erro, db, dbAdmin, autenticar, extrairId, extrairAcao,
  verificarExistencia, camposParaAtualizar, corsPreFlight,
} from "../_shared/utils.ts";
import { logError, logRequest, logResponse, logSuccess } from "../_shared/logger.ts";
import { chamarProvedorIA, ErroIA, lerConfigIAAtiva, lerMentoresIA } from "../_shared/ia.ts";

type Db = ReturnType<typeof db>;

const TIPOS_ATIVO = [
  "ACOES", "ETF", "FII", "REIT", "STOCKS",
  "ETF_INTERNACIONAL", "RENDA_FIXA", "CRIPTOMOEDAS", "TESOURO_DIRETO",
];
// Critérios das perguntas do questionário de avaliação. DIVIDENDOS é o id
// interno do critério "Geração de renda" (mantido por compatibilidade).
const CRITERIOS_QUESTAO = ["FUNDAMENTOS", "CRESCIMENTO", "DIVIDENDOS", "VALUATION"];
// Pesos sugeridos por perfil (somam 100) — espelham FrontEnd/src/lib/constants.ts.
// Usados no prompt da IA quando o usuário não tem pesos globais salvos.
const PESOS_SUGERIDOS_POR_PERFIL: Record<string, Record<string, number>> = {
  CONSERVADOR: { FUNDAMENTOS: 35, CRESCIMENTO: 10, DIVIDENDOS: 35, VALUATION: 20 },
  MODERADO:    { FUNDAMENTOS: 30, CRESCIMENTO: 25, DIVIDENDOS: 25, VALUATION: 20 },
  ARROJADO:    { FUNDAMENTOS: 25, CRESCIMENTO: 40, DIVIDENDOS: 10, VALUATION: 25 },
};
const PESOS_PADRAO_CRITERIO = PESOS_SUGERIDOS_POR_PERFIL.MODERADO;
const TIPO_ATIVO_LABEL_BR: Record<string, string> = {
  ACOES: "Ações (Brasil)", ETF: "ETF (Brasil)", FII: "Fundos Imobiliários (FII)",
  REIT: "REITs (fundos imobiliários dos EUA)", STOCKS: "Ações internacionais (Stocks)",
  ETF_INTERNACIONAL: "ETF Internacional", RENDA_FIXA: "Renda Fixa (CDB/LCI/LCA/CRI/CRA/Debênture)",
  CRIPTOMOEDAS: "Criptomoedas", TESOURO_DIRETO: "Tesouro Direto",
};
const STATUS_POSICAO = ["ATIVA", "ENCERRADA"];
const TIPOS_OPERACAO = ["COMPRA", "VENDA", "APORTE", "RESGATE", "DIVIDENDO", "RENDIMENTO"];
// Renda fixa / Tesouro Direto
const SUBTIPOS_RF    = ["TESOURO", "CDB", "LCI", "LCA", "CRI", "CRA", "DEBENTURE", "OUTRO"];
const INDEXADORES_RF = ["PREFIXADO", "POS_FIXADO", "HIBRIDO"];
const INDICES_RF     = ["CDI", "SELIC", "IPCA", "IGPM"];
// Fundos imobiliários
const CATEGORIAS_FII = ["TIJOLO", "PAPEL", "FOF", "DESENVOLVIMENTO", "OUTRO"];
// Ações
const SUBTIPOS_ACOES = ["ON", "PN", "UNIT", "BDR"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();

  const url     = new URL(req.url);
  const partes  = url.pathname.split("/").filter(Boolean);
  const idxBase = partes.indexOf("investimentos");
  const recurso = idxBase >= 0 ? (partes[idxBase + 1] ?? "") : "";
  const m       = req.method;

  // Job do servidor: autentica por secret (header x-cron-secret), sem JWT
  // de usuário. Tratado ANTES de autenticar() por isso.
  if (recurso === "snapshot-cron") {
    try { return await rotaSnapshotCron(req, m); }
    catch (e) { logError("Handler snapshot-cron", e); return erro("Erro interno", 500); }
  }

  // Job do servidor: provisiona proventos de ativos em USD (Polygon.io).
  // Também sem JWT — protegido pelo x-cron-secret.
  if (recurso === "dividendos-cron") {
    try { return await rotaDividendosCron(req, m); }
    catch (e) { logError("Handler dividendos-cron", e); return erro("Erro interno", 500); }
  }

  // Job do servidor: provisiona proventos de ativos em BRL (ACOES/ETF/FII)
  // a partir dos dados públicos da B3. Sem JWT — protegido pelo x-cron-secret.
  if (recurso === "dividendos-cron-br") {
    try { return await rotaDividendosCronBr(req, m); }
    catch (e) { logError("Handler dividendos-cron-br", e); return erro("Erro interno", 500); }
  }

  // Job do servidor: materializa o rendimento (yield) das criptos como
  // operações RENDIMENTO p/ todos os usuários. Sem JWT — x-cron-secret.
  if (recurso === "rendimento-cripto-cron") {
    try { return await rotaRendimentoCriptoCron(req, m); }
    catch (e) { logError("Handler rendimento-cripto-cron", e); return erro("Erro interno", 500); }
  }

  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;
  const c       = db(req);

  try {
    switch (recurso) {
      case "ativos":          return await rotaAtivos(c, req, m, userId);
      case "alocacoes":       return await rotaAlocacoes(c, req, m, userId);
      case "questionarios":   return await rotaQuestionarios(c, req, m, userId);
      case "avaliacoes":      return await rotaAvaliacoes(c, req, m, userId);
      case "posicoes":        return await rotaPosicoes(c, req, m, userId);
      case "operacoes":       return await rotaOperacoes(c, req, m, userId);
      case "dividendos":      return await rotaDividendos(c, req, m, userId);
      case "dividendos-buscar-br": return await rotaDividendosBuscarBr(req, m, userId);
      case "dividendos-backfill-rate": return await rotaDividendosBackfillRate(c, m, userId);
      case "rendimento-cripto": return await rotaRendimentoCripto(c, m, userId);
      case "tipos-dividendo": return await rotaTiposDividendo(c, req, m, userId);
      case "historico-mensal": return await rotaHistorico(c, req, m, userId);
      case "snapshot-auto":   return await rotaSnapshotAuto(c, req, m, userId);
      case "snapshot-backfill": return await rotaSnapshotBackfill(c, req, m, userId);
      case "importar":        return await rotaImportar(c, req, m, userId);
      case "atualizar-ativos": return await rotaAtualizarAtivos(c, req, m, userId);
      case "normalizar-tesouro": return await rotaNormalizarTesouro(c, req, m, userId);
      case "restaurar":       return await rotaRestaurar(c, req, m, userId);
      case "dashboard":       return m === "GET" ? await dashboard(c, url.searchParams) : erro("Método não permitido", 405);
      case "ranking":         return m === "GET" ? await ranking(c, url.searchParams) : erro("Método não permitido", 405);
      case "busca-externa":   return m === "GET" ? await buscaExterna(url.searchParams) : erro("Método não permitido", 405);
      case "ptax":
        if (m === "GET")  return await rotaPtax(c, url.searchParams);
        if (m === "POST") return await sincronizarPtaxResposta(c);
        return erro("Método não permitido", 405);
      case "indices":
        if (m === "GET")  return await rotaIndices(c, url.searchParams);
        if (m === "POST") return await sincronizarIndicesResposta(c);
        return erro("Método não permitido", 405);
      case "tesouro":
        if (m === "GET")  return await rotaTesouro(c, url.searchParams);
        if (m === "POST") return await sincronizarTesouroResposta();
        return erro("Método não permitido", 405);
      default:                return erro("Rota não encontrada", 404);
    }
  } catch (e) {
    logError("Handler investimentos", e);
    return erro("Erro interno", 500);
  }
});

// ============================================================
// Helpers de validação de posse (RLS já filtra; estes dão 404)
// ============================================================

async function contaExiste(c: Db, contaId: unknown): Promise<boolean> {
  if (!contaId) return false;
  const { data } = await c.from("contas").select("id").eq("id", contaId).maybeSingle();
  return !!data;
}

async function ativoExiste(c: Db, ativoId: unknown): Promise<boolean> {
  if (!ativoId) return false;
  const { data } = await c.from("inv_ativos").select("id").eq("id", ativoId).maybeSingle();
  return !!data;
}

// ============================================================
// /investimentos/ativos
// ============================================================

async function rotaAtivos(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "ativos");

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/ativos", { params: Object.fromEntries(params) });
    let q = c.from("inv_ativos").select("*").order("ticker", { ascending: true });
    const tipo = params.get("tipo");
    if (tipo && TIPOS_ATIVO.includes(tipo)) q = q.eq("tipo_ativo", tipo);
    const { data, error } = await q;
    if (error) { logError("Listar ativos", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "GET" && id) {
    const { data, error } = await c.from("inv_ativos").select("*").eq("id", id).maybeSingle();
    if (error) { logError("Buscar ativo", error); return erro(error.message); }
    if (!data) return erro("Ativo não encontrado", 404);
    return json({ dados: data });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/ativos", body);

    if (!body.ticker || !body.tipo_ativo) {
      return erro("Campos obrigatórios: ticker, tipo_ativo");
    }
    if (!TIPOS_ATIVO.includes(String(body.tipo_ativo))) {
      return erro(`tipo_ativo inválido: ${TIPOS_ATIVO.join(" | ")}`);
    }
    const ticker = String(body.ticker).trim().toUpperCase();
    if (ticker.length < 1 || ticker.length > 20) return erro("ticker deve ter 1..20 caracteres");

    // Nome: usa o informado; se vazio ou igual ao ticker, busca o oficial
    // na fonte externa (a menos que não ache → cai no ticker).
    let nome = String(body.nome ?? "").trim();
    if (!nome || nome.toUpperCase() === ticker) {
      const m = await resolverNomes([{ ticker, tipo_ativo: String(body.tipo_ativo) }]);
      nome = m.get(ticker) ?? nome;
    }
    nome = (nome || ticker).slice(0, 120);

    const erroNota = validarNota(body.nota_usuario);
    if (erroNota) return erro(erroNota);
    const erroResp = validarRespostas(body.questionario_respostas);
    if (erroResp) return erro(erroResp);
    const erroRF = validarCamposRF(body);
    if (erroRF) return erro(erroRF);

    if (body.ativo_pai && !(await ativoExiste(c, body.ativo_pai))) {
      return erro("ativo_pai não encontrado", 404);
    }

    const { data, error } = await c.from("inv_ativos").insert({
      user_id:      userId,
      ticker,
      nome,
      tipo_ativo:   body.tipo_ativo,
      moeda:        body.moeda ? String(body.moeda).toUpperCase().slice(0, 3) : "BRL",
      descricao:    body.descricao ?? null,
      nota_usuario: body.nota_usuario ?? null,
      questionario_respostas: body.questionario_respostas ?? null,
      ativo_pai:    body.ativo_pai ?? null,
      rf_subtipo:      body.rf_subtipo ?? null,
      rf_indexador:    body.rf_indexador ?? null,
      rf_indice:            body.rf_indice ?? null,
      rf_percentual_indice: body.rf_percentual_indice ?? null,
      rf_taxa_fixa:         body.rf_taxa_fixa ?? null,
      rf_taxa:         body.rf_taxa ?? null,
      rf_emissor:      body.rf_emissor ?? null,
      rf_vencimento:   body.rf_vencimento ?? null,
      rf_garantia_fgc: body.rf_garantia_fgc ?? null,
      rf_isento_ir:    body.rf_isento_ir ?? null,
      fii_categoria:   body.fii_categoria ?? null,
      acoes_subtipo:   body.acoes_subtipo ?? null,
      cripto_rendimento_aa: body.cripto_rendimento_aa ?? null,
      cripto_rendimento_inicio: body.cripto_rendimento_inicio ?? null,
      cripto_rendimento_periodicidade: body.cripto_rendimento_periodicidade ?? null,
      cotacao_automatica: body.cotacao_automatica ?? true,
    }).select().single();

    if (error) {
      if (error.code === "23505") return erro("Já existe um ativo com este ticker", 409);
      logError("Criar ativo", error); return erro(error.message);
    }
    logSuccess("Ativo criado", { id: data.id });
    return json({ dados: data }, 201);
  }

  if (m === "PUT" && id) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/ativos/${id}`, body);

    const naoEncontrado = await verificarExistencia(c, "inv_ativos", id, "Ativo não encontrado");
    if (naoEncontrado) return naoEncontrado;

    // Estado dos campos que DEFINEM o valor de mercado da renda fixa, antes do
    // update — para detectar, depois, se a forma de rentabilidade mudou.
    const { data: antesRF } = await c.from("inv_ativos")
      .select("tipo_ativo, rf_indexador, rf_taxa, rf_vencimento")
      .eq("id", id).maybeSingle();

    if (body.tipo_ativo !== undefined && !TIPOS_ATIVO.includes(String(body.tipo_ativo))) {
      return erro(`tipo_ativo inválido: ${TIPOS_ATIVO.join(" | ")}`);
    }
    const erroNota = validarNota(body.nota_usuario);
    if (erroNota) return erro(erroNota);
    const erroResp = validarRespostas(body.questionario_respostas);
    if (erroResp) return erro(erroResp);
    const erroRF = validarCamposRF(body);
    if (erroRF) return erro(erroRF);
    if (body.ativo_pai && (body.ativo_pai === id)) return erro("ativo_pai não pode ser o próprio ativo");
    if (body.ativo_pai && !(await ativoExiste(c, body.ativo_pai))) return erro("ativo_pai não encontrado", 404);

    const campos = camposParaAtualizar(body, [
      "ticker", "nome", "tipo_ativo", "moeda", "descricao", "nota_usuario",
      "questionario_respostas", "ativo_pai",
      "rf_subtipo", "rf_indexador", "rf_indice", "rf_percentual_indice",
      "rf_taxa_fixa", "rf_taxa", "rf_emissor",
      "rf_vencimento", "rf_garantia_fgc", "rf_isento_ir", "fii_categoria",
      "acoes_subtipo", "cripto_rendimento_aa", "cripto_rendimento_inicio",
      "cripto_rendimento_periodicidade", "cotacao_automatica",
    ]);
    if (typeof campos.ticker === "string") campos.ticker = campos.ticker.trim().toUpperCase();

    const { data, error } = await c.from("inv_ativos").update(campos).eq("id", id).select().single();
    if (error) {
      if (error.code === "23505") return erro("Já existe um ativo com este ticker", 409);
      logError("Editar ativo", error); return erro(error.message);
    }
    // Propaga tipo_ativo para a cópia desnormalizada em inv_dividendos. Existe
    // também um trigger no banco (trg_sync_dividendo_tipo_ativo); repetimos aqui
    // de forma idempotente para garantir a sincronização mesmo que a migration
    // do trigger não esteja aplicada — evitando dados divergentes (backup,
    // dedup de importação, etc. leem a coluna armazenada).
    if (campos.tipo_ativo !== undefined) {
      const { error: errSync } = await c.from("inv_dividendos")
        .update({ tipo_ativo: campos.tipo_ativo })
        .eq("ativo_id", id)
        .neq("tipo_ativo", campos.tipo_ativo);
      if (errSync) logError("Sincronizar tipo_ativo dos dividendos", errSync);
    }

    // Renda fixa: o valor de mercado é DERIVADO do indexador/taxa (não vem de
    // cotação externa). Se a forma de rentabilidade mudou, os snapshots mensais
    // já gravados ficam defasados — ex.: ativo importado SEM indexador teve o
    // histórico achatado no custo; ao marcar "110% CDI" depois, os meses antigos
    // continuariam parados e todo o rendimento se acumularia num único mês.
    // Apaga a série defasada e a reconstrói do 1º aporte até o mês corrente.
    const ehRFTipo = (t: unknown) => t === "RENDA_FIXA" || t === "TESOURO_DIRETO";
    const mudouRF = !!antesRF && (
      antesRF.tipo_ativo    !== data.tipo_ativo    ||
      antesRF.rf_indexador  !== data.rf_indexador  ||
      antesRF.rf_taxa       !== data.rf_taxa       ||
      antesRF.rf_vencimento !== data.rf_vencimento
    );
    if (mudouRF && (ehRFTipo(data.tipo_ativo) || ehRFTipo(antesRF?.tipo_ativo))) {
      try {
        await c.from("inv_historico_mensal").delete().eq("ativo_id", id);
        // Só reconstrói se CONTINUA renda fixa. Se virou um tipo cotado, o
        // histórico será preenchido pelo backfill/snapshot a partir da cotação.
        if (ehRFTipo(data.tipo_ativo)) await rebuildHistoricoRF(c, userId, id);
      } catch (e) {
        logError("Recalcular histórico de renda fixa", e);
      }
    }
    return json({ dados: data });
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/ativos/${id}`);
    const naoEncontrado = await verificarExistencia(c, "inv_ativos", id, "Ativo não encontrado");
    if (naoEncontrado) return naoEncontrado;

    // As FKs de posições, operações, dividendos e histórico têm ON DELETE
    // CASCADE → excluir o ativo remove tudo junto. As transações de extrato
    // de proventos permanecem (transacao_extrato_id é ON DELETE SET NULL).
    const { error } = await c.from("inv_ativos").delete().eq("id", id);
    if (error) { logError("Excluir ativo", error); return erro(error.message); }
    return json({ mensagem: "Ativo e dados vinculados excluídos com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

function validarNota(nota: unknown): string | null {
  if (nota == null) return null;
  const n = Number(nota);
  if (!Number.isFinite(n) || n < 0 || n > 10) return "nota_usuario deve estar entre 0 e 10";
  return null;
}

// Respostas do questionário: objeto { pergunta_id: indice 0..4 }
function validarRespostas(respostas: unknown): string | null {
  if (respostas == null) return null;
  if (typeof respostas !== "object" || Array.isArray(respostas)) {
    return "questionario_respostas deve ser um objeto { pergunta: indice }";
  }
  for (const [k, v] of Object.entries(respostas as Record<string, unknown>)) {
    const n = Number(v);
    if (!k || !Number.isInteger(n) || n < 0 || n > 4) {
      return "questionario_respostas: cada resposta deve ser um índice inteiro entre 0 e 4";
    }
  }
  return null;
}

// Características de renda fixa (rf_*) — válidas para RENDA_FIXA/TESOURO_DIRETO
// — e categoria de FII (fii_categoria) — válida para tipo FII.
function validarCamposRF(body: Record<string, unknown>): string | null {
  if (body.rf_subtipo != null && !SUBTIPOS_RF.includes(String(body.rf_subtipo))) {
    return `rf_subtipo inválido: ${SUBTIPOS_RF.join(" | ")}`;
  }
  if (body.rf_indexador != null && !INDEXADORES_RF.includes(String(body.rf_indexador))) {
    return `rf_indexador inválido: ${INDEXADORES_RF.join(" | ")}`;
  }
  if (body.rf_indice != null && !INDICES_RF.includes(String(body.rf_indice))) {
    return `rf_indice inválido: ${INDICES_RF.join(" | ")}`;
  }
  for (const campo of ["rf_percentual_indice", "rf_taxa_fixa"]) {
    const v = body[campo];
    if (v != null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      return `${campo} deve ser um número ≥ 0`;
    }
  }
  if (body.rf_taxa != null && String(body.rf_taxa).length > 40) {
    return "rf_taxa deve ter no máximo 40 caracteres";
  }
  if (body.rf_emissor != null && String(body.rf_emissor).length > 80) {
    return "rf_emissor deve ter no máximo 80 caracteres";
  }
  if (body.rf_vencimento != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.rf_vencimento))) {
    return "rf_vencimento deve estar no formato YYYY-MM-DD";
  }
  if (body.fii_categoria != null && !CATEGORIAS_FII.includes(String(body.fii_categoria))) {
    return `fii_categoria inválida: ${CATEGORIAS_FII.join(" | ")}`;
  }
  if (body.acoes_subtipo != null && !SUBTIPOS_ACOES.includes(String(body.acoes_subtipo))) {
    return `acoes_subtipo inválido: ${SUBTIPOS_ACOES.join(" | ")}`;
  }
  if (body.cripto_rendimento_aa != null) {
    const v = Number(body.cripto_rendimento_aa);
    if (!Number.isFinite(v) || v < 0 || v > 1000) {
      return "cripto_rendimento_aa deve ser um número entre 0 e 1000 (% a.a.)";
    }
  }
  if (body.cripto_rendimento_inicio != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.cripto_rendimento_inicio))) {
    return "cripto_rendimento_inicio deve estar no formato YYYY-MM-DD";
  }
  if (body.cripto_rendimento_periodicidade != null
      && !["DIARIA", "SEMANAL", "MENSAL"].includes(String(body.cripto_rendimento_periodicidade))) {
    return "cripto_rendimento_periodicidade inválida: DIARIA | SEMANAL | MENSAL";
  }
  return null;
}

// ============================================================
// /investimentos/alocacoes — alocação ideal por tipo
// GET lista; PUT faz upsert do conjunto (soma deve ser 100%)
// ============================================================

async function rotaAlocacoes(c: Db, req: Request, m: string, userId: string) {
  if (m === "GET") {
    logRequest("GET", "/investimentos/alocacoes");
    const { data, error } = await c.from("inv_alocacoes_tipo").select("*").order("tipo_ativo");
    if (error) { logError("Listar alocacoes", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "PUT") {
    const body = await req.json();
    logRequest("PUT", "/investimentos/alocacoes", body);

    const itens = Array.isArray(body.alocacoes) ? body.alocacoes : null;
    if (!itens || itens.length === 0) {
      return erro("alocacoes (array de { tipo_ativo, percentual_ideal }) é obrigatório");
    }

    let soma = 0;
    const linhas = [];
    for (const item of itens) {
      const tipo = String(item?.tipo_ativo ?? "");
      if (!TIPOS_ATIVO.includes(tipo)) return erro(`tipo_ativo inválido: ${tipo}`);
      const pct = Number(item?.percentual_ideal);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return erro(`percentual_ideal inválido para ${tipo}`);
      soma += pct;
      linhas.push({ user_id: userId, tipo_ativo: tipo, percentual_ideal: pct, updated_at: new Date().toISOString() });
    }

    // Tolerância para arredondamento de ponto flutuante
    if (Math.abs(soma - 100) > 0.01) {
      return erro(`a soma dos percentuais deve ser 100% (atual: ${soma.toFixed(2)}%)`);
    }

    const { data, error } = await c
      .from("inv_alocacoes_tipo")
      .upsert(linhas, { onConflict: "user_id,tipo_ativo" })
      .select();
    if (error) { logError("Upsert alocacoes", error); return erro(error.message); }
    logSuccess("Alocações atualizadas", { count: data?.length });
    return json({ dados: data });
  }

  return erro("Método não permitido", 405);
}

// ============================================================
// /investimentos/questionarios — questionário de avaliação custom
// por tipo de ativo (sobrepõe o default do frontend).
//   GET    /questionarios            → lista todos os custom do usuário
//   GET    /questionarios/:tipo      → 1 tipo (404 se não houver custom)
//   PUT    /questionarios/:tipo      → upsert (manual ou IA)
//   DELETE /questionarios/:tipo      → remove (volta ao default)
//   POST   /questionarios/:tipo/gerar → Mentor (IA) monta o questionário
// ============================================================

// Segmento após "questionarios" no path (o tipo_ativo). extrairId só
// reconhece UUID, então parseamos manualmente.
function segmentoTipo(req: Request): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf("questionarios");
  if (idx === -1 || idx + 1 >= partes.length) return null;
  return decodeURIComponent(partes[idx + 1]);
}

// Valida o payload { perguntas, pesos } de um questionário. Retorna
// string de erro ou null se válido.
function validarQuestionario(perguntas: unknown, pesos: unknown): string | null {
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

async function rotaQuestionarios(c: Db, req: Request, m: string, userId: string) {
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
async function gerarQuestionarioIA(c: Db, req: Request, tipo: string, userId: string) {
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
function extrairJson(texto: string): { perguntas: unknown; pesos: unknown } | null {
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

interface PerguntaAv { id: string; texto: string; criterio: string; opcoes: string[] }

// Resultado de um mentor para um ativo (espelha InvAvaliacaoMentor no front).
interface ResMentor {
  config_id: string; nome: string | null; provedor: string; modelo: string | null;
  nota: number | null; respostas: Record<string, number>; erro: string | null;
}

// Replica calcularNota do frontend (lib/questionarioAtivos.ts): nota de
// cada critério = média dos índices respondidos × 2,5; nota final = média
// ponderada pelos pesos dos critérios COM resposta. Null se nada respondido.
function calcularNotaBackend(
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
function mediana(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Desvio-padrão populacional (0 se < 2 elementos).
function desvioPadrao(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = nums.reduce((s, v) => s + v, 0) / nums.length;
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length);
}

// Extrai o primeiro objeto JSON do texto da IA (tolera cercas ```json e
// texto ao redor). Versão genérica (devolve o objeto inteiro).
function extrairJsonObj(texto: string): Record<string, unknown> | null {
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
function descreverAtivo(a: Record<string, unknown>): string {
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
function segmentoAcaoAval(req: Request): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf("avaliacoes");
  if (idx === -1 || idx + 1 >= partes.length) return null;
  return decodeURIComponent(partes[idx + 1]);
}

// Normaliza/valida o objeto bruto de respostas da IA → { id: indice 0..4 }
// apenas para ids do questionário. Devolve {} se nada reconhecível.
function normalizarRespostas(raw: unknown, idsValidos: Set<string>): Record<string, number> {
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
async function avaliarUmMentor(
  mentor: { id: string; nome: string | null; provedor: string; modelo: string | null; apiKey: string },
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
    "índice (0 a 4) da opção que melhor reflete a realidade do ativo — 0 = pior, 4 = melhor. Use seu " +
    "conhecimento de mercado sobre o ativo. Responda SOMENTE com um JSON válido (sem markdown, sem " +
    'comentários, sem texto fora do JSON) no formato exato: { "respostas": { "<id_da_pergunta>": indice_0_a_4 } }. ' +
    "Inclua TODAS as perguntas. Se não tiver dados sobre algum aspecto, escolha o índice mais neutro/conservador.";
  const perguntasTxt = perguntas.map((p) =>
    `- id "${p.id}" [${p.criterio}]: ${p.texto}\n  opções: ${p.opcoes.map((o, i) => `${i}=${o}`).join(" | ")}`
  ).join("\n");
  const userMsg =
    `Ativo a avaliar:\n${descreverAtivo(ativo)}\n\n` +
    `Questionário (${perguntas.length} perguntas):\n${perguntasTxt}\n\n` +
    "Devolva agora o JSON com as respostas (índice 0..4) de TODAS as perguntas.";

  try {
    const bruto = await chamarProvedorIA(mentor.provedor, {
      apiKey: mentor.apiKey,
      persona,
      mensagens: [{ role: "user", content: userMsg }],
      maxTokens: 4000,
      modelo: mentor.modelo ?? undefined,
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

async function rotaAvaliacoes(c: Db, req: Request, m: string, userId: string) {
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

    const r = await avaliarUmMentor(mentor, ativo, perguntas, pesos);
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

// ============================================================
// /investimentos/posicoes
// ============================================================

async function rotaPosicoes(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "posicoes");

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/posicoes", { params: Object.fromEntries(params) });
    let q = c.from("inv_posicoes")
      .select("*, inv_ativos(ticker, nome, tipo_ativo), contas(nome)")
      .order("data_compra", { ascending: false });
    const ativoId = params.get("ativo_id");
    const contaId = params.get("conta_id");
    const status  = params.get("status");
    if (ativoId) q = q.eq("ativo_id", ativoId);
    if (contaId) q = q.eq("conta_id", contaId);
    if (status && STATUS_POSICAO.includes(status)) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) { logError("Listar posicoes", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/posicoes", body);

    if (!body.ativo_id || !body.conta_id || body.quantidade == null || body.preco_custo == null || !body.data_compra) {
      return erro("Campos obrigatórios: ativo_id, conta_id, quantidade, preco_custo, data_compra");
    }
    if (!(await ativoExiste(c, body.ativo_id))) return erro("Ativo não encontrado", 404);
    if (!(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);

    const qtd   = Number(body.quantidade);
    const preco = Number(body.preco_custo);
    if (!Number.isFinite(qtd) || qtd < 0)   return erro("quantidade deve ser >= 0");
    if (!Number.isFinite(preco) || preco < 0) return erro("preco_custo deve ser >= 0");
    if (body.status && !STATUS_POSICAO.includes(String(body.status))) {
      return erro(`status inválido: ${STATUS_POSICAO.join(" | ")}`);
    }

    // valor_custo é recalculado pelo trigger fn_inv_posicao_valor_custo
    const { data, error } = await c.from("inv_posicoes").insert({
      user_id:     userId,
      ativo_id:    body.ativo_id,
      conta_id:    body.conta_id,
      quantidade:  qtd,
      preco_custo: preco,
      data_compra: String(body.data_compra),
      status:      body.status ?? "ATIVA",
    }).select().single();
    if (error) { logError("Criar posicao", error); return erro(error.message); }
    logSuccess("Posição criada", { id: data.id });
    return json({ dados: data }, 201);
  }

  if (m === "PUT" && id) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/posicoes/${id}`, body);
    const naoEncontrado = await verificarExistencia(c, "inv_posicoes", id, "Posição não encontrada");
    if (naoEncontrado) return naoEncontrado;

    if (body.conta_id && !(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);
    if (body.ativo_id && !(await ativoExiste(c, body.ativo_id))) return erro("Ativo não encontrado", 404);
    if (body.status && !STATUS_POSICAO.includes(String(body.status))) {
      return erro(`status inválido: ${STATUS_POSICAO.join(" | ")}`);
    }

    const campos = camposParaAtualizar(body, [
      "ativo_id", "conta_id", "quantidade", "preco_custo", "data_compra", "status",
    ]);
    const { data, error } = await c.from("inv_posicoes").update(campos).eq("id", id).select().single();
    if (error) { logError("Editar posicao", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/posicoes/${id}`);
    const naoEncontrado = await verificarExistencia(c, "inv_posicoes", id, "Posição não encontrada");
    if (naoEncontrado) return naoEncontrado;
    // inv_operacoes referencia posicao com ON DELETE CASCADE — operações somem junto.
    const { error } = await c.from("inv_posicoes").delete().eq("id", id);
    if (error) { logError("Excluir posicao", error); return erro(error.message); }
    return json({ mensagem: "Posição excluída com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

// ============================================================
// /investimentos/operacoes
// ============================================================

async function rotaOperacoes(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "operacoes");

  if (m === "GET") {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/operacoes", { params: Object.fromEntries(params) });
    let q = c.from("inv_operacoes").select("*").order("data_operacao", { ascending: false });
    const posicaoId = params.get("posicao_id");
    if (posicaoId) q = q.eq("posicao_id", posicaoId);
    const { data, error } = await q;
    if (error) { logError("Listar operacoes", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST") {
    const body = await req.json();
    logRequest("POST", "/investimentos/operacoes", body);

    if (!body.tipo_operacao || body.quantidade == null || !body.data_operacao) {
      return erro("Campos obrigatórios: tipo_operacao, quantidade, data_operacao");
    }
    if (!TIPOS_OPERACAO.includes(String(body.tipo_operacao))) {
      return erro(`tipo_operacao inválido: ${TIPOS_OPERACAO.join(" | ")}`);
    }
    const qtd   = Number(body.quantidade);
    const preco = body.preco_unitario != null ? Number(body.preco_unitario) : 0;
    if (!Number.isFinite(qtd) || qtd < 0)     return erro("quantidade deve ser >= 0");
    if (!Number.isFinite(preco) || preco < 0) return erro("preco_unitario deve ser >= 0");
    const valorTotal = body.valor_total != null ? Number(body.valor_total) : qtd * preco;

    // A operação mantém a posição. Resolve a posição por posicao_id (compat) ou
    // find-or-create pelo par (ativo, conta) — a posição é a soma das operações.
    let posicaoId: string;
    let contaId: string;
    if (body.posicao_id) {
      const { data: pos } = await c.from("inv_posicoes").select("id, conta_id").eq("id", String(body.posicao_id)).maybeSingle();
      if (!pos) return erro("Posição não encontrada", 404);
      posicaoId = String(pos.id); contaId = String(pos.conta_id);
    } else {
      if (!body.ativo_id || !body.conta_id) return erro("Informe posicao_id ou (ativo_id e conta_id)");
      if (!(await ativoExiste(c, String(body.ativo_id)))) return erro("Ativo não encontrado", 404);
      if (!(await contaExiste(c, String(body.conta_id)))) return erro("Conta não encontrada", 404);
      contaId = String(body.conta_id);
      const resolved = await acharOuCriarPosicao(c, userId, String(body.ativo_id), contaId, String(body.data_operacao));
      if (resolved instanceof Response) return resolved;
      posicaoId = resolved;
    }

    const { data, error } = await c.from("inv_operacoes").insert({
      user_id:        userId,
      posicao_id:     posicaoId,
      tipo_operacao:  body.tipo_operacao,
      conta_id:       contaId,
      quantidade:     qtd,
      preco_unitario: preco,
      valor_total:    valorTotal,
      data_operacao:  String(body.data_operacao),
    }).select().single();
    if (error) { logError("Criar operacao", error); return erro(error.message); }
    await recomputarPosicao(c, posicaoId);
    await sincronizarResgateVencimento(c, posicaoId);
    logSuccess("Operação criada", { id: data.id });
    return json({ dados: data }, 201);
  }

  if (m === "PUT" && id) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/operacoes/${id}`, body);
    const naoEncontrado = await verificarExistencia(c, "inv_operacoes", id, "Operação não encontrada");
    if (naoEncontrado) return naoEncontrado;

    if (body.tipo_operacao && !TIPOS_OPERACAO.includes(String(body.tipo_operacao))) {
      return erro(`tipo_operacao inválido: ${TIPOS_OPERACAO.join(" | ")}`);
    }
    if (body.posicao_id) {
      const posExiste = await verificarExistencia(c, "inv_posicoes", String(body.posicao_id), "Posição não encontrada");
      if (posExiste) return posExiste;
    }
    if (body.conta_id && !(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);
    if (body.quantidade != null) {
      const qtd = Number(body.quantidade);
      if (!Number.isFinite(qtd) || qtd < 0) return erro("quantidade deve ser >= 0");
    }
    if (body.preco_unitario != null) {
      const preco = Number(body.preco_unitario);
      if (!Number.isFinite(preco) || preco < 0) return erro("preco_unitario deve ser >= 0");
    }

    // Estado anterior: posição dona (pode mudar) e qtd/preço (p/ recompor valor_total)
    const { data: antes } = await c.from("inv_operacoes")
      .select("posicao_id, quantidade, preco_unitario").eq("id", id).maybeSingle();

    const campos = camposParaAtualizar(body, [
      "posicao_id", "tipo_operacao", "conta_id", "quantidade", "preco_unitario", "valor_total", "data_operacao",
    ]);
    // valor_total derivado quando qtd/preço mudaram e não foi enviado explicitamente.
    if (campos.valor_total == null && (campos.quantidade != null || campos.preco_unitario != null)) {
      const q = campos.quantidade     != null ? Number(campos.quantidade)     : Number(antes?.quantidade)     || 0;
      const p = campos.preco_unitario != null ? Number(campos.preco_unitario) : Number(antes?.preco_unitario) || 0;
      campos.valor_total = q * p;
    }

    const { data, error } = await c.from("inv_operacoes").update(campos).eq("id", id).select().single();
    if (error) { logError("Editar operacao", error); return erro(error.message); }

    const posAfetadas = new Set<string>();
    if (antes?.posicao_id) posAfetadas.add(String(antes.posicao_id));
    if (data?.posicao_id)  posAfetadas.add(String(data.posicao_id));
    for (const pid of posAfetadas) { await recomputarPosicao(c, pid); await sincronizarResgateVencimento(c, pid); }
    return json({ dados: data });
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/operacoes/${id}`);
    const { data: op } = await c.from("inv_operacoes").select("posicao_id").eq("id", id).maybeSingle();
    if (!op) return erro("Operação não encontrada", 404);
    const { error } = await c.from("inv_operacoes").delete().eq("id", id);
    if (error) { logError("Excluir operacao", error); return erro(error.message); }
    await recomputarPosicao(c, String(op.posicao_id));
    await sincronizarResgateVencimento(c, String(op.posicao_id));
    return json({ mensagem: "Operação excluída com sucesso" });
  }

  return erro("Método não permitido", 405);
}

// Posição ATIVA do par (ativo, conta) — reusa a existente (ATIVA ou ENCERRADA)
// ou cria uma vazia (qtd 0) que será preenchida por recomputarPosicao.
async function acharOuCriarPosicao(
  c: Db, userId: string, ativoId: string, contaId: string, dataOp: string,
): Promise<string | Response> {
  const { data: existentes } = await c.from("inv_posicoes")
    .select("id, status").eq("ativo_id", ativoId).eq("conta_id", contaId);
  const ativa = (existentes ?? []).find((p) => p.status === "ATIVA");
  if (ativa) return String(ativa.id);
  const qualquer = (existentes ?? [])[0];
  if (qualquer) return String(qualquer.id);
  const { data, error } = await c.from("inv_posicoes").insert({
    user_id: userId, ativo_id: ativoId, conta_id: contaId,
    quantidade: 0, preco_custo: 0, data_compra: dataOp, status: "ATIVA",
  }).select("id").single();
  if (error) { logError("Criar posição (operação)", error); return erro(error.message); }
  return String(data.id);
}

// Recalcula a posição como a SOMA das suas operações (custo médio ponderado).
// Compra/Aporte somam; Venda/Resgate abatem mantendo o preço médio; ao zerar a
// quantidade a posição vira ENCERRADA. valor_custo é recalculado pelo trigger.
//
// Operações com data FUTURA (data_operacao > hoje) NÃO afetam o saldo atual —
// ficam "programadas" (ex.: resgate agendado no vencimento da renda fixa) e só
// passam a valer quando a data chega (um recompute futuro as aplica).
async function recomputarPosicao(c: Db, posicaoId: string): Promise<void> {
  const { data: ops, error } = await c.from("inv_operacoes")
    .select("tipo_operacao, quantidade, preco_unitario, data_operacao, created_at")
    .eq("posicao_id", posicaoId)
    .order("data_operacao", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) { logError("Recomputar posição (ler operações)", error); return; }

  const hoje = hojeISO();
  let qtd = 0, custo = 0, precoMedio = 0;
  let dataCompra: string | null = null;
  for (const o of ops ?? []) {
    if (String(o.data_operacao) > hoje) continue; // operação programada (futura)
    const q = Number(o.quantidade) || 0;
    const p = Number(o.preco_unitario) || 0;
    const tipo = String(o.tipo_operacao);
    if (tipo === "COMPRA" || tipo === "APORTE") {
      qtd += q; custo += q * p;
      if (!dataCompra) dataCompra = String(o.data_operacao);
    } else if (tipo === "VENDA" || tipo === "RESGATE") {
      const media = qtd > 0 ? custo / qtd : 0;
      const remover = qtd > 0 ? Math.min(q, qtd) : 0;
      custo -= remover * media; qtd -= remover;
      if (qtd < 0) qtd = 0;
    } else if (tipo === "RENDIMENTO") {
      // Yield em tokens: aumenta a quantidade sem custo (token grátis) →
      // derruba o preço médio. O ganho vira valorização (qtd × preço).
      qtd += q;
    }
    // DIVIDENDO: não altera a posição
    if (qtd > 0) precoMedio = custo / qtd;
  }

  const { data: pos } = await c.from("inv_posicoes").select("data_compra").eq("id", posicaoId).maybeSingle();
  const campos = {
    quantidade:  qtd,
    preco_custo: precoMedio,
    data_compra: dataCompra ?? (pos?.data_compra ? String(pos.data_compra) : new Date().toISOString().split("T")[0]),
    status:      qtd > 0 ? "ATIVA" : "ENCERRADA",
  };
  const { error: errUpd } = await c.from("inv_posicoes").update(campos).eq("id", posicaoId);
  if (errUpd) logError("Recomputar posição (update)", errUpd);
}

// Mantém um RESGATE "programado" na data de vencimento da renda fixa/Tesouro,
// para que a posição se encerre sozinha quando o título vencer. A operação é
// futura (vencimento > hoje) → recomputarPosicao a ignora até a data chegar.
// Espelha sempre o saldo remanescente atual: chamada após cada recompute.
//   • vencimento futuro e saldo > 0 → cria/atualiza o resgate = saldo remanescente
//   • vencimento futuro e saldo = 0 → remove o resgate programado (nada a resgatar)
//   • vencimento já passado → não mexe (o resgate, se existir, já é histórico)
async function sincronizarResgateVencimento(c: Db, posicaoId: string): Promise<void> {
  const { data: pos } = await c.from("inv_posicoes")
    .select("id, user_id, conta_id, quantidade, preco_custo, inv_ativos(tipo_ativo, rf_vencimento)")
    .eq("id", posicaoId).maybeSingle();
  if (!pos) return;
  const rawA  = (pos as { inv_ativos?: Record<string, unknown> | Record<string, unknown>[] }).inv_ativos;
  const ativo = (Array.isArray(rawA) ? rawA[0] : rawA) ?? {};
  const tipo  = String(ativo.tipo_ativo ?? "");
  const venc  = (ativo.rf_vencimento as string | null) ?? null;
  if ((tipo !== "RENDA_FIXA" && tipo !== "TESOURO_DIRETO") || !venc) return;
  if (venc <= hojeISO()) return; // só gerencia enquanto o resgate é futuro

  const { data: existentes } = await c.from("inv_operacoes")
    .select("id").eq("posicao_id", posicaoId).eq("tipo_operacao", "RESGATE").eq("data_operacao", venc);
  const prog = (existentes ?? [])[0] as { id: string } | undefined;
  const qtd   = Number(pos.quantidade) || 0;
  const preco = Number(pos.preco_custo) || 0;

  if (qtd <= 0) {
    if (prog) await c.from("inv_operacoes").delete().eq("id", prog.id);
    return;
  }
  const campos = { quantidade: qtd, preco_unitario: preco, valor_total: qtd * preco };
  if (prog) {
    await c.from("inv_operacoes").update(campos).eq("id", prog.id);
  } else {
    await c.from("inv_operacoes").insert({
      user_id: pos.user_id, posicao_id: posicaoId, tipo_operacao: "RESGATE",
      conta_id: pos.conta_id, data_operacao: venc, ...campos,
    });
  }
}

// Encerra posições de renda fixa/Tesouro cujo vencimento já passou e que ainda
// estão ATIVA: garante um RESGATE na data de vencimento (caso de posições
// antigas/importadas sem resgate programado) e recomputa — o resgate, agora no
// passado, zera o saldo → ENCERRADA. Idempotente (ignora as já encerradas).
async function fecharPosicoesVencidas(c: Db, userId: string): Promise<void> {
  const hoje = hojeISO();
  const { data: posicoes } = await c.from("inv_posicoes")
    .select("id, quantidade, preco_custo, conta_id, user_id, inv_ativos!inner(tipo_ativo, rf_vencimento)")
    .eq("user_id", userId).eq("status", "ATIVA");
  for (const p of posicoes ?? []) {
    const rawA  = (p as { inv_ativos?: Record<string, unknown> | Record<string, unknown>[] }).inv_ativos;
    const ativo = (Array.isArray(rawA) ? rawA[0] : rawA) ?? {};
    const tipo  = String(ativo.tipo_ativo ?? "");
    const venc  = (ativo.rf_vencimento as string | null) ?? null;
    if ((tipo !== "RENDA_FIXA" && tipo !== "TESOURO_DIRETO") || !venc || venc > hoje) continue;

    const { data: existentes } = await c.from("inv_operacoes")
      .select("id").eq("posicao_id", String(p.id)).eq("tipo_operacao", "RESGATE").eq("data_operacao", venc);
    if (!(existentes ?? []).length) {
      const qtd = Number(p.quantidade) || 0, preco = Number(p.preco_custo) || 0;
      if (qtd > 0) {
        await c.from("inv_operacoes").insert({
          user_id: p.user_id, posicao_id: String(p.id), tipo_operacao: "RESGATE",
          conta_id: p.conta_id, data_operacao: venc, quantidade: qtd, preco_unitario: preco, valor_total: qtd * preco,
        });
      }
    }
    await recomputarPosicao(c, String(p.id));
  }
}

// ============================================================
// /investimentos/dividendos
// Cada dividendo gera uma transação RECEITA no extrato, na categoria
// mapeada pelo seu tipo_dividendo. Pagamento futuro → status PROJECAO;
// passado/hoje → PAGO. O vínculo fica em inv_dividendos.transacao_extrato_id.
// ============================================================

async function rotaDividendos(c: Db, req: Request, m: string, userId: string) {
  const id   = extrairId(req, "dividendos");
  const acao = extrairAcao(req, "dividendos");

  // POST /dividendos/:id/confirmar — reconcilia projeção: PROJECAO → PAGO
  // com valor/data reais. Mantém valor_projetado original na transação.
  if (m === "POST" && id && acao === "confirmar") {
    const body = await req.json().catch(() => ({}));
    logRequest("POST", `/investimentos/dividendos/${id}/confirmar`, body);

    const { data: div } = await c.from("inv_dividendos")
      .select("id, valor, data_pagamento, transacao_extrato_id").eq("id", id).maybeSingle();
    if (!div) return erro("Dividendo não encontrado", 404);
    if (!div.transacao_extrato_id) return erro("Dividendo sem transação vinculada no extrato", 409);

    const { data: tx } = await c.from("transacoes")
      .select("id, status").eq("id", div.transacao_extrato_id).maybeSingle();
    if (!tx) return erro("Transação do extrato não encontrada", 404);
    if (tx.status === "PAGO") return erro("Dividendo já confirmado", 409);

    const valor = body.valor != null ? Number(body.valor) : Number(div.valor);
    if (!Number.isFinite(valor) || valor <= 0) return erro("valor deve ser > 0");
    const dataPag = body.data_pagamento ? String(body.data_pagamento) : String(div.data_pagamento);

    const { error: errTx } = await c.from("transacoes")
      .update({ status: "PAGO", valor, data: dataPag })
      .eq("id", tx.id);
    if (errTx) { logError("Confirmar transação de dividendo", errTx); return erro(errTx.message); }

    const { data: divFinal, error: errDiv } = await c.from("inv_dividendos")
      .update({ valor, data_pagamento: dataPag })
      .eq("id", id)
      .select("*, inv_ativos(ticker, nome), inv_tipos_dividendo(nome), transacoes(status)")
      .single();
    if (errDiv) { logError("Confirmar dividendo", errDiv); return erro(errDiv.message); }

    logSuccess("Dividendo confirmado", { id, valor, data: dataPag });
    return json({ dados: divFinal });
  }

  // PUT /dividendos/:id — edita valor/data/conta/descrição e sincroniza
  // a transação vinculada no extrato (sem mudar o status dela).
  if (m === "PUT" && id && !acao) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/dividendos/${id}`, body);

    const { data: div } = await c.from("inv_dividendos")
      .select("id, transacao_extrato_id").eq("id", id).maybeSingle();
    if (!div) return erro("Dividendo não encontrado", 404);

    if (body.valor != null) {
      const v = Number(body.valor);
      if (!Number.isFinite(v) || v <= 0) return erro("valor deve ser > 0");
    }
    if (body.conta_id && !(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);
    if (body.tipo_dividendo_id) {
      const { data: td } = await c.from("inv_tipos_dividendo")
        .select("id").eq("id", body.tipo_dividendo_id).maybeSingle();
      if (!td) return erro("Tipo de dividendo não encontrado", 404);
    }

    const campos = camposParaAtualizar(body, ["valor", "data_pagamento", "descricao", "conta_id", "tipo_dividendo_id"]);
    if (Object.keys(campos).length === 0) return erro("Nenhum campo para atualizar");

    const { data: divFinal, error } = await c.from("inv_dividendos")
      .update(campos).eq("id", id)
      .select("*, inv_ativos(ticker, nome), inv_tipos_dividendo(nome), transacoes(status)")
      .single();
    if (error) { logError("Editar dividendo", error); return erro(error.message); }

    // Sincroniza a transação do extrato (valor / data / conta)
    if (div.transacao_extrato_id) {
      const txCampos: Record<string, unknown> = {};
      if (campos.valor          !== undefined) txCampos.valor    = campos.valor;
      if (campos.data_pagamento !== undefined) txCampos.data     = campos.data_pagamento;
      if (campos.conta_id       !== undefined) txCampos.conta_id = campos.conta_id;
      if (Object.keys(txCampos).length > 0) {
        // Em projeções o valor projetado acompanha o valor editado
        const { data: tx } = await c.from("transacoes")
          .select("status").eq("id", div.transacao_extrato_id).maybeSingle();
        if (tx?.status === "PROJECAO" && txCampos.valor !== undefined) {
          txCampos.valor_projetado = txCampos.valor;
        }
        const { error: errTx } = await c.from("transacoes")
          .update(txCampos).eq("id", div.transacao_extrato_id);
        if (errTx) logError("Sincronizar transação de dividendo", errTx);
      }
    }

    return json({ dados: divFinal });
  }

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/dividendos", { params: Object.fromEntries(params) });
    let q = c.from("inv_dividendos")
      .select("*, inv_ativos(ticker, nome, tipo_ativo), inv_tipos_dividendo(nome), transacoes(status)")
      .order("data_pagamento", { ascending: false });
    const ativoId = params.get("ativo_id");
    const tipo    = params.get("tipo_ativo");
    if (ativoId) q = q.eq("ativo_id", ativoId);
    const { data, error } = await q;
    if (error) { logError("Listar dividendos", error); return erro(error.message); }
    // inv_dividendos.tipo_ativo é uma cópia desnormalizada que pode ficar
    // defasada (ex.: ativo reclassificado de FII p/ ETF). Para o gráfico de
    // proventos nunca errar, devolvemos SEMPRE o tipo ATUAL do ativo (join),
    // independentemente de a sincronização por trigger ter rodado.
    const dados = (data ?? []).map((d) => {
      const at = (d as { inv_ativos?: { tipo_ativo?: string } | null }).inv_ativos ?? null;
      return at?.tipo_ativo ? { ...d, tipo_ativo: at.tipo_ativo } : d;
    });
    const filtrados = tipo && TIPOS_ATIVO.includes(tipo)
      ? dados.filter((d) => (d as { tipo_ativo?: string }).tipo_ativo === tipo)
      : dados;
    return json({ dados: filtrados });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/dividendos", body);

    // Associação inversa: vincula a um provento que JÁ existe no extrato
    // (não cria transação nova). Para trazer dividendos antigos, lançados
    // manualmente como receitas, para o módulo de investimentos.
    if (body.transacao_extrato_id) {
      return await associarDividendoExistente(c, body, userId);
    }

    if (!body.ativo_id || !body.conta_id || body.valor == null || !body.data_pagamento ||
        !body.tipo_ativo || !body.tipo_dividendo_id) {
      return erro("Campos obrigatórios: ativo_id, conta_id, valor, data_pagamento, tipo_ativo, tipo_dividendo_id");
    }
    if (!TIPOS_ATIVO.includes(String(body.tipo_ativo))) {
      return erro(`tipo_ativo inválido: ${TIPOS_ATIVO.join(" | ")}`);
    }
    const valor = Number(body.valor);
    // A transação do extrato exige valor > 0 (CHECK valor > 0 em transacoes)
    if (!Number.isFinite(valor) || valor <= 0) return erro("valor deve ser > 0");
    if (!(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);

    // Carrega ativo (ticker p/ descrição) e tipo de dividendo (categoria mapeada)
    const [{ data: ativo }, { data: tipoDiv }] = await Promise.all([
      c.from("inv_ativos").select("ticker").eq("id", body.ativo_id).maybeSingle(),
      c.from("inv_tipos_dividendo").select("id, nome, categoria_id").eq("id", body.tipo_dividendo_id).maybeSingle(),
    ]);
    if (!ativo)   return erro("Ativo não encontrado", 404);
    if (!tipoDiv) return erro("Tipo de dividendo não encontrado", 404);
    if (!tipoDiv.categoria_id) {
      return erro(`Configure a categoria do tipo de dividendo "${tipoDiv.nome}" antes de lançar`, 409);
    }

    // 1) Cria o dividendo (sem vínculo ainda)
    const { data: div, error: errDiv } = await c.from("inv_dividendos").insert({
      user_id:           userId,
      ativo_id:          body.ativo_id,
      conta_id:          body.conta_id,
      valor,
      data_pagamento:    String(body.data_pagamento),
      tipo_ativo:        body.tipo_ativo,
      tipo_dividendo_id: tipoDiv.id,
      descricao:         body.descricao ?? null,
    }).select().single();
    if (errDiv) { logError("Criar dividendo", errDiv); return erro(errDiv.message); }

    // 2) Cria a transação no extrato
    const hoje    = new Date().toISOString().split("T")[0];
    const futuro  = String(body.data_pagamento) > hoje;
    const status  = futuro ? "PROJECAO" : "PAGO";
    // descricao da transação: "TICKER - Nome do tipo" (2..200 chars)
    const desc    = `${ativo.ticker} - ${tipoDiv.nome}`.slice(0, 200);

    const { data: tx, error: errTx } = await c.from("transacoes").insert({
      user_id:         userId,
      conta_id:        body.conta_id,
      categoria_id:    tipoDiv.categoria_id,
      data:            String(body.data_pagamento),
      descricao:       desc.length >= 2 ? desc : `Dividendo ${desc}`.slice(0, 200),
      valor,
      tipo:            "RECEITA",
      status,
      valor_projetado: futuro ? valor : null,
    }).select("id").single();

    if (errTx) {
      // rollback manual: remove o dividendo órfão para não ficar sem extrato
      await c.from("inv_dividendos").delete().eq("id", div.id);
      logError("Criar transação de dividendo", errTx);
      return erro(`Falha ao lançar no extrato: ${errTx.message}`);
    }

    // 3) Vincula
    const { data: divFinal } = await c.from("inv_dividendos")
      .update({ transacao_extrato_id: tx.id })
      .eq("id", div.id)
      .select("*, inv_ativos(ticker, nome), inv_tipos_dividendo(nome), transacoes(status)")
      .single();

    logSuccess("Dividendo criado e lançado no extrato", { id: div.id, tx: tx.id, status });
    return json({ dados: divFinal ?? div }, 201);
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/dividendos/${id}`);
    const { data: div } = await c.from("inv_dividendos")
      .select("id, transacao_extrato_id").eq("id", id).maybeSingle();
    if (!div) return erro("Dividendo não encontrado", 404);

    const { error } = await c.from("inv_dividendos").delete().eq("id", id);
    if (error) { logError("Excluir dividendo", error); return erro(error.message); }

    // Remove também a transação vinculada do extrato
    if (div.transacao_extrato_id) {
      const { error: errTx } = await c.from("transacoes").delete().eq("id", div.transacao_extrato_id);
      if (errTx) logError("Excluir transação de dividendo", errTx);
    }
    return json({ mensagem: "Dividendo excluído com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

// Associa um provento já lançado no extrato a um ativo, criando o
// inv_dividendos vinculado SEM gerar nova transação. Idempotente: uma
// transação só pode ser associada a um dividendo.
async function associarDividendoExistente(c: Db, body: Record<string, unknown>, userId: string) {
  if (!body.ativo_id) return erro("ativo_id é obrigatório");

  const { data: ativo } = await c.from("inv_ativos")
    .select("id, tipo_ativo").eq("id", body.ativo_id).maybeSingle();
  if (!ativo) return erro("Ativo não encontrado", 404);

  const { data: tx } = await c.from("transacoes")
    .select("id, conta_id, categoria_id, valor, data, tipo").eq("id", body.transacao_extrato_id).maybeSingle();
  if (!tx) return erro("Transação do extrato não encontrada", 404);
  if (tx.tipo !== "RECEITA") return erro("Só é possível associar transações de RECEITA", 409);
  if (Number(tx.valor) <= 0) return erro("A transação deve ter valor maior que zero", 409);

  const { data: jaVinc } = await c.from("inv_dividendos")
    .select("id").eq("transacao_extrato_id", tx.id).maybeSingle();
  if (jaVinc) return erro("Esta transação já está associada a um dividendo", 409);

  let tipoDivId: string | null = body.tipo_dividendo_id ? String(body.tipo_dividendo_id) : null;
  if (tipoDivId) {
    const { data: td } = await c.from("inv_tipos_dividendo").select("id").eq("id", tipoDivId).maybeSingle();
    if (!td) tipoDivId = null; // tipo inválido → grava sem tipo (não bloqueia)
  }
  // Sem tipo informado: infere pelo mapeamento tipo ↔ categoria do extrato
  if (!tipoDivId && tx.categoria_id) {
    const { data: td } = await c.from("inv_tipos_dividendo")
      .select("id").eq("categoria_id", tx.categoria_id).limit(1).maybeSingle();
    if (td) tipoDivId = String(td.id);
  }

  const { data, error } = await c.from("inv_dividendos").insert({
    user_id:              userId,
    ativo_id:             ativo.id,
    conta_id:             tx.conta_id,
    valor:                tx.valor,
    data_pagamento:       tx.data,
    tipo_ativo:           ativo.tipo_ativo,
    tipo_dividendo_id:    tipoDivId,
    descricao:            body.descricao ?? null,
    transacao_extrato_id: tx.id,
  }).select("*, inv_ativos(ticker, nome), inv_tipos_dividendo(nome), transacoes(status)").single();

  if (error) { logError("Associar dividendo existente", error); return erro(error.message); }
  logSuccess("Dividendo associado ao extrato existente", { id: data.id, tx: tx.id });
  return json({ dados: data }, 201);
}

// ============================================================
// /investimentos/tipos-dividendo — tipos editáveis + mapeamento
// para a categoria do extrato (1 categoria por tipo, reutilizável).
// A criação da categoria em si usa a Edge Function `categorias`;
// aqui só guardamos o categoria_id escolhido.
// ============================================================

async function rotaTiposDividendo(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "tipos-dividendo");

  if (m === "GET" && !id) {
    logRequest("GET", "/investimentos/tipos-dividendo");
    const { data, error } = await c.from("inv_tipos_dividendo")
      .select("*, categorias(descricao, icone, cor)")
      .order("nome", { ascending: true });
    if (error) { logError("Listar tipos-dividendo", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/tipos-dividendo", body);
    if (!body.nome) return erro("Campo obrigatório: nome");
    const nome = String(body.nome).trim();
    if (nome.length < 1 || nome.length > 40) return erro("nome deve ter entre 1 e 40 caracteres");
    if (body.categoria_id) {
      const { data: cat } = await c.from("categorias").select("id").eq("id", body.categoria_id).maybeSingle();
      if (!cat) return erro("Categoria não encontrada", 404);
    }
    const { data, error } = await c.from("inv_tipos_dividendo").insert({
      user_id:      userId,
      nome,
      categoria_id: body.categoria_id ?? null,
    }).select().single();
    if (error) {
      if (error.code === "23505") return erro("Já existe um tipo de dividendo com este nome", 409);
      logError("Criar tipo-dividendo", error); return erro(error.message);
    }
    return json({ dados: data }, 201);
  }

  if (m === "PUT" && id) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/tipos-dividendo/${id}`, body);
    const naoEncontrado = await verificarExistencia(c, "inv_tipos_dividendo", id, "Tipo de dividendo não encontrado");
    if (naoEncontrado) return naoEncontrado;
    if (body.nome !== undefined) {
      const nome = String(body.nome).trim();
      if (nome.length < 1 || nome.length > 40) return erro("nome deve ter entre 1 e 40 caracteres");
    }
    if (body.categoria_id) {
      const { data: cat } = await c.from("categorias").select("id").eq("id", body.categoria_id).maybeSingle();
      if (!cat) return erro("Categoria não encontrada", 404);
    }
    const campos = camposParaAtualizar(body, ["nome", "categoria_id", "ativo"]);
    if (typeof campos.nome === "string") campos.nome = campos.nome.trim();
    campos.updated_at = new Date().toISOString();
    const { data, error } = await c.from("inv_tipos_dividendo").update(campos).eq("id", id).select().single();
    if (error) {
      if (error.code === "23505") return erro("Já existe um tipo de dividendo com este nome", 409);
      logError("Editar tipo-dividendo", error); return erro(error.message);
    }
    return json({ dados: data });
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/tipos-dividendo/${id}`);
    const naoEncontrado = await verificarExistencia(c, "inv_tipos_dividendo", id, "Tipo de dividendo não encontrado");
    if (naoEncontrado) return naoEncontrado;
    const { count } = await c.from("inv_dividendos").select("id", { count: "exact", head: true }).eq("tipo_dividendo_id", id);
    if ((count ?? 0) > 0) return erro("Não é possível excluir: há dividendos lançados com este tipo", 409);
    const { error } = await c.from("inv_tipos_dividendo").delete().eq("id", id);
    if (error) { logError("Excluir tipo-dividendo", error); return erro(error.message); }
    return json({ mensagem: "Tipo de dividendo excluído com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

// ============================================================
// /investimentos/historico-mensal — snapshot de valor por mês
// POST faz upsert por (ativo_id, conta_id, mes_ano) e calcula
// variacao_percentual e rentabilidade_mes contra o mês anterior,
// descontando aportes/resgates (mudança de quantidade avaliada ao
// preco_medio informado). Backfill recalcula o snapshot seguinte.
// ============================================================

const RE_MES_ANO = /^\d{4}-(0[1-9]|1[0-2])$/;

interface SnapshotMes {
  id?: string;
  mes_ano: string;
  valor_mercado: number;
  quantidade: number;
}

function calcularDesempenho(
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

async function snapshotVizinho(
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
async function recalcularSeguinte(c: Db, ativoId: string, contaId: string, mesAno: string) {
  const seguinte = await snapshotVizinho(c, ativoId, contaId, mesAno, "seguinte");
  if (!seguinte) return;
  const prevDoSeguinte = await snapshotVizinho(c, ativoId, contaId, seguinte.mes_ano, "anterior");
  const desempenho = calcularDesempenho(
    Number(seguinte.valor_mercado), Number(seguinte.quantidade), Number(seguinte.preco_medio), prevDoSeguinte,
  );
  await c.from("inv_historico_mensal").update(desempenho).eq("id", seguinte.id);
}

async function rotaHistorico(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "historico-mensal");

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/historico-mensal", { params: Object.fromEntries(params) });
    let q = c.from("inv_historico_mensal")
      .select("*, inv_ativos(ticker, nome, tipo_ativo)")
      .order("mes_ano", { ascending: false });
    const ativoId = params.get("ativo_id");
    const contaId = params.get("conta_id");
    const mesAno  = params.get("mes_ano");
    const de      = params.get("de");
    const ate     = params.get("ate");
    if (ativoId) q = q.eq("ativo_id", ativoId);
    if (contaId) q = q.eq("conta_id", contaId);
    if (mesAno && RE_MES_ANO.test(mesAno)) q = q.eq("mes_ano", mesAno);
    if (de  && RE_MES_ANO.test(de))  q = q.gte("mes_ano", de);
    if (ate && RE_MES_ANO.test(ate)) q = q.lte("mes_ano", ate);
    const { data, error } = await q;
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
        .select("quantidade, valor_custo")
        .eq("ativo_id", body.ativo_id).eq("conta_id", body.conta_id).eq("status", "ATIVA");
      const qtdTotal   = (pos ?? []).reduce((s, p) => s + Number(p.quantidade), 0);
      const custoTotal = (pos ?? []).reduce((s, p) => s + Number(p.valor_custo), 0);
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

const CDI_FALLBACK  = 0.105;  // % a.a. caso o BCB não responda
const IPCA_FALLBACK = 0.045;

// SGS/BCB: série 432 = Meta Selic (% a.a.); 13522 = IPCA acum. 12m (% a.a.)
async function sgsUltimo(serie: number, fallback: number): Promise<number> {
  try {
    const arr = await fetchJson(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`,
    ) as { valor?: string }[];
    const v = Number(arr?.[0]?.valor);
    return Number.isFinite(v) && v > 0 ? v / 100 : fallback;
  } catch { return fallback; }
}

// Primeira taxa percentual de um texto ("13,5% a.a." → 0.135)
function primeiraTaxa(txt: string): number {
  const m = String(txt ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) / 100 : 0;
}

const DIA_MS = 86_400_000;
// Valor acumulado de uma posição de renda fixa, do aporte até dataRef
function valorRF(custo: number, dataCompra: string, dataRef: Date, taxaAa: number): number {
  const ini  = new Date(`${String(dataCompra).slice(0, 10)}T12:00:00Z`).getTime();
  const dias = Math.max(0, (dataRef.getTime() - ini) / DIA_MS);
  if (taxaAa <= 0 || dias === 0) return custo;
  return custo * Math.pow(1 + taxaAa, dias / 365);
}

// Tickers que mudaram de código (fusão, reorganização) → símbolo atual usado
// para BUSCAR a cotação. O ticker cadastrado/exibido continua o original.
// Adicione novos casos aqui conforme aparecerem.
const ALIAS_TICKER: Record<string, string> = {
  BIDI11: "INBR32",  // Banco Inter → Inter & Co (BDR na B3)
  CPFF11: "CPTS11",  // FII Capitânia — migrou para CPTS11
};
// Símbolos a tentar para um ticker: ele e o alias (renomeado), cada um nas
// formas B3 (.SA) e pura (EUA). Tenta TODOS até achar série/cotação — assim
// um alias errado/desnecessário não quebra a busca do ticker original.
function candidatosTicker(ticker: string): string[] {
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
function basesTicker(ticker: string): string[] {
  const orig = (ticker ?? "").toUpperCase();
  return ALIAS_TICKER[orig] ? [orig, ALIAS_TICKER[orig]] : [orig];
}

// Cotação atual (brapi) p/ tickers da B3 / BDR / STOCKS → mapa ticker→{preco,moeda}
async function precosBrapi(tickers: string[]): Promise<Map<string, { preco: number; moeda: string }>> {
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
async function nomesBrapi(tickers: string[]): Promise<Map<string, string>> {
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
async function nomesCripto(tickers: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const meta = await metaCripto(tickers);
  for (const [sym, v] of meta) if (v.nome) out.set(sym, v.nome);
  return out;
}

// Resolve o nome oficial de uma lista de ativos pela fonte externa.
// Tesouro Direto e renda fixa privada não têm fonte → ficam de fora
// (mantém o que veio). Mapa: TICKER (upper) → nome.
async function resolverNomes(itens: { ticker: string; tipo_ativo: string }[]): Promise<Map<string, string>> {
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
async function resolverMeta(
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
async function precosCripto(tickers: string[]): Promise<Map<string, number>> {
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
async function metaCripto(tickers: string[]): Promise<Map<string, { nome?: string; logo?: string; preco?: number }>> {
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
async function ptaxAtual(c: Db): Promise<number> {
  const { data } = await c.from("cotacoes_ptax")
    .select("cotacao_venda").order("data", { ascending: false }).limit(1).maybeSingle();
  const v = Number((data as { cotacao_venda?: number } | null)?.cotacao_venda);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// ── Cache COMPARTILHADO de cotações (arqvalor.cotacoes_ativos) ───
// O preço de um ticker é igual para todos os usuários, então é cacheado
// numa tabela sem user_id. Leitura via JWT (RLS libera SELECT); escrita
// via service_role. Evita refetch externo por usuário e mantém o valor
// consistente entre contas.
const COTACAO_STALE_MS = 6 * 60 * 60 * 1000; // revalida o mês corrente a cada 6h

interface CacheCotacao { preco: number; moeda: string; atualizadoEm: string }

// Cotações cacheadas de vários tickers num mês específico
async function lerCacheMes(c: Db, tickers: string[], mesAno: string): Promise<Map<string, CacheCotacao>> {
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
async function lerCacheTicker(c: Db, ticker: string): Promise<{ precos: Map<string, number>; moeda: string }> {
  const precos = new Map<string, number>();
  let moeda = "";
  const { data } = await c.from("cotacoes_ativos")
    .select("mes_ano, preco, moeda").eq("ticker", ticker.toUpperCase());
  for (const r of data ?? []) { precos.set(String(r.mes_ano), Number(r.preco)); if (!moeda) moeda = String(r.moeda); }
  return { precos, moeda };
}

// Grava/atualiza o cache (service_role — ignora RLS)
async function gravarCache(rows: { ticker: string; mes_ano: string; preco: number; moeda: string }[]) {
  if (rows.length === 0) return;
  const admin = dbAdmin();
  const linhas = rows
    .filter((r) => r.ticker && Number.isFinite(r.preco) && r.preco >= 0)
    .map((r) => ({ ticker: r.ticker.toUpperCase(), mes_ano: r.mes_ano, preco: r.preco, moeda: r.moeda, atualizado_em: new Date().toISOString() }));
  if (linhas.length === 0) return;
  const { error } = await admin.from("cotacoes_ativos").upsert(linhas, { onConflict: "ticker,mes_ano" });
  if (error) logError("Upsert cotacoes_ativos", error);
}

// Cotação ATUAL via Yahoo (fallback p/ ativos que a brapi não cobre, ex.: EUA).
// Tenta o símbolo puro (EUA) e o .SA (B3); devolve preço + moeda detectada.
async function precoAtualYahoo(ticker: string): Promise<{ preco: number; moeda: string } | null> {
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
async function resolverPrecosAtuais(
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
async function gravarSnapshot(
  c: Db, userId: string, ativoId: string, contaId: string, mesAno: string, valorMercado: number,
  qtdOverride?: number, precoMedioOverride?: number,
) {
  let qtdTotal: number, precoMedio: number;
  if (qtdOverride != null && precoMedioOverride != null) {
    // Backfill: quantidade/preço-médio do mês informado (≠ posição atual)
    qtdTotal = qtdOverride; precoMedio = precoMedioOverride;
  } else {
    const { data: pos } = await c.from("inv_posicoes")
      .select("quantidade, valor_custo")
      .eq("ativo_id", ativoId).eq("conta_id", contaId).eq("status", "ATIVA");
    qtdTotal   = (pos ?? []).reduce((s, p) => s + Number(p.quantidade), 0);
    const custoTotal = (pos ?? []).reduce((s, p) => s + Number(p.valor_custo), 0);
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

interface GrupoPosicao {
  ativoId: string; contaId: string; ticker: string; nome: string; tipo: string; moeda: string;
  indexador: string | null; taxa: string | null; vencimento: string | null;
  posicoes: { quantidade: number; valor_custo: number; data_compra: string }[];
}

// Núcleo da captura do mês: agrupa posições ATIVAS do usuário, resolve os
// preços (cache compartilhado) e grava o snapshot do mês. Serve tanto ao
// client do usuário (RLS) quanto ao client admin do cron — por isso filtra
// user_id explicitamente e passa qtd/preço-médio na hora de gravar.
async function executarSnapshotMes(
  client: Db, userId: string, mesAno: string, contaId?: string | null,
): Promise<{ atualizados: number; ignorados: { ticker: string; motivo: string }[] }> {
  const mesCorrente = new Date().toISOString().slice(0, 7);
  const [ano, mes] = mesAno.split("-").map(Number);
  const dataRef = mesAno === mesCorrente ? new Date() : new Date(Date.UTC(ano, mes, 0, 12));

  let q = client.from("inv_posicoes")
    .select("ativo_id, conta_id, quantidade, valor_custo, data_compra, inv_ativos(ticker, nome, tipo_ativo, moeda, rf_indexador, rf_taxa, rf_vencimento, cotacao_automatica)")
    .eq("status", "ATIVA").eq("user_id", userId);
  if (contaId) q = q.eq("conta_id", contaId);
  const { data: posicoes, error } = await q;
  if (error) { logError("snapshot posicoes", error); throw new Error(error.message); }

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
        posicoes: [],
      });
    }
    grupos.get(key)!.posicoes.push({
      quantidade: Number(p.quantidade) || 0, valor_custo: Number(p.valor_custo) || 0,
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
      valor = valorRFPosicoes(g.posicoes, g.tipo, g.indexador, g.vencimento, g.nome, mesAno, dataRef, g.taxa, cdiSerie, ipcaSerie, cdi, ipca, mtmTesouro);
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

async function rotaSnapshotAuto(c: Db, req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const body = await req.json().catch(() => ({})) as { mes_ano?: string; conta_id?: string };
  const mesCorrente = new Date().toISOString().slice(0, 7);
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
async function rotaSnapshotCron(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  if (!esperado || (req.headers.get("x-cron-secret") ?? "") !== esperado) return erro("Não autorizado", 401);

  const admin = dbAdmin();
  const mesAno = new Date().toISOString().slice(0, 7);
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
//   • 1 requisição Polygon por ticker, com pausa aleatória curta entre
//     elas (folga no limite de 5 req/min do plano free, num job de manhã).
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
async function rotaDividendosCron(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  if (!esperado || (req.headers.get("x-cron-secret") ?? "") !== esperado) return erro("Não autorizado", 401);
  const apiKey = Deno.env.get("POLYGON_API_KEY") ?? "";
  if (!apiKey) { logError("dividendos-cron", "POLYGON_API_KEY ausente"); return erro("POLYGON_API_KEY não configurada", 500); }

  const admin = dbAdmin();
  const hoje  = hojeISO();
  logRequest("POST", "/investimentos/dividendos-cron", { hoje });

  // PTAX recente para conversão USD→BRL (mesma fonte/convenção do resto)
  try { await garantirSincronizado(admin); } catch (e) { logError("dividendos-cron ptax", e); }
  if (!(await ptaxVendaAte(admin, hoje))) { logError("dividendos-cron", "PTAX indisponível"); return erro("PTAX indisponível", 500); }

  // Ativos em USD (Polygon cobre papéis das bolsas americanas)
  const { data: ativos, error } = await admin.from("inv_ativos")
    .select("id, user_id, ticker, tipo_ativo").eq("moeda", "USD");
  if (error) { logError("dividendos-cron ativos", error); return erro(error.message); }

  let processados = 0, criados = 0, atualizados = 0, pulados = 0;
  for (const ativo of (ativos ?? []) as { id: string; user_id: string; ticker: string; tipo_ativo: string }[]) {
    try {
      // Posições ATIVAS desse ativo, por conta
      const { data: posicoes } = await admin.from("inv_posicoes")
        .select("conta_id, quantidade").eq("ativo_id", ativo.id).eq("status", "ATIVA");
      if (!posicoes || posicoes.length === 0) continue;

      // Tipo "Dividendos" do usuário, com categoria mapeada
      const { data: tipoDiv } = await admin.from("inv_tipos_dividendo")
        .select("id, categoria_id").eq("user_id", ativo.user_id).eq("nome", "Dividendos").maybeSingle();
      if (!tipoDiv?.categoria_id) { pulados++; continue; }

      // Pausa aleatória curta (250–1250ms) antes de cada requisição
      await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 1000)));
      const divs = await buscarDividendosPolygon(ativo.ticker, apiKey);
      processados++;

      // Soma por pay_date (mesmo tipo, mesmo dia → 1x); só futuros
      const porData = new Map<string, number>();
      for (const d of divs) {
        if (d.pay_date < hoje) continue;
        porData.set(d.pay_date, (porData.get(d.pay_date) ?? 0) + d.cash_amount);
      }

      for (const payDate of [...porData.keys()].sort()) {
        const cashPorAcao = porData.get(payDate)!;
        const ptax = (await ptaxVendaAte(admin, payDate)) ?? 0;
        if (ptax <= 0) continue;
        for (const pos of posicoes as { conta_id: string; quantidade: number }[]) {
          const valorBRL = Number((cashPorAcao * Number(pos.quantidade) * ptax).toFixed(2));
          if (valorBRL <= 0) continue;
          const r = await upsertDividendoProvisionado(admin, {
            userId: ativo.user_id, ativoId: ativo.id, contaId: pos.conta_id,
            tipoAtivo: ativo.tipo_ativo, tipoDivId: String(tipoDiv.id),
            categoriaId: String(tipoDiv.categoria_id), ticker: ativo.ticker,
            valor: valorBRL, payDate,
            // rate por ação convertido p/ BRL (mesma moeda do valor lançado)
            valorPorCota: Number((cashPorAcao * ptax).toFixed(8)),
          });
          if (r === "criado") criados++; else if (r === "atualizado") atualizados++;
        }
      }
    } catch (e) { logError("dividendos-cron ativo", e); }
  }

  logSuccess("Dividendos cron", { processados, criados, atualizados, pulados });
  return json({ dados: { processados, criados, atualizados, pulados } });
}

// Última PTAX (venda) com data <= alvo (último dia útil). Para datas
// futuras retorna a cotação mais recente disponível (estimativa).
async function ptaxVendaAte(admin: Db, dataAlvo: string): Promise<number | null> {
  const { data } = await admin.from("cotacoes_ptax")
    .select("cotacao_venda").lte("data", dataAlvo)
    .order("data", { ascending: false }).limit(1).maybeSingle();
  const v = Number((data as { cotacao_venda?: number } | null)?.cotacao_venda);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Primeiro dia do mês seguinte a "YYYY-MM" (limite exclusivo da janela do mês).
function primeiroDiaProximoMes(payDate: string): string {
  let [y, mo] = payDate.slice(0, 7).split("-").map(Number);
  mo++; if (mo > 12) { mo = 1; y++; }
  return `${y}-${String(mo).padStart(2, "0")}-01`;
}

// Cria ou corrige uma provisão (PROJECAO) de provento. Reconcilia pela
// chave (user, ativo, conta, tipo) dentro do MÊS do pay_date: se já houver
// uma PROJECAO, atualiza valor/data (na dívida e na transação); senão cria
// o par dividendo + transação RECEITA PROJECAO vinculados.
async function upsertDividendoProvisionado(admin: Db, p: {
  userId: string; ativoId: string; contaId: string; tipoAtivo: string;
  tipoDivId: string; categoriaId: string; ticker: string; valor: number; payDate: string;
  rotulo?: string; valorPorCota?: number | null;
}): Promise<"criado" | "atualizado" | "ignorado"> {
  // Dividendo por cota (rate da fonte) na moeda do lançamento; usado por DY/YoC.
  const vpc = p.valorPorCota != null && Number.isFinite(p.valorPorCota) && p.valorPorCota > 0
    ? Number(p.valorPorCota) : null;
  const mesIni = `${p.payDate.slice(0, 7)}-01`;
  const mesFim = primeiroDiaProximoMes(p.payDate);

  const { data: candidatos } = await admin.from("inv_dividendos")
    .select("id, transacao_extrato_id, valor, data_pagamento, transacoes(status)")
    .eq("user_id", p.userId).eq("ativo_id", p.ativoId).eq("conta_id", p.contaId)
    .eq("tipo_dividendo_id", p.tipoDivId)
    .gte("data_pagamento", mesIni).lt("data_pagamento", mesFim);

  const existente = (candidatos ?? []).find(
    (d) => (d as { transacoes?: { status?: string } }).transacoes?.status === "PROJECAO",
  ) as { id: string; transacao_extrato_id: string | null; valor: number; data_pagamento: string } | undefined;

  if (existente) {
    const mudou = Number(existente.valor) !== p.valor || String(existente.data_pagamento).slice(0, 10) !== p.payDate;
    if (!mudou && vpc == null) return "ignorado";
    await admin.from("inv_dividendos")
      .update({ valor: p.valor, data_pagamento: p.payDate, ...(vpc != null ? { valor_por_cota: vpc } : {}) })
      .eq("id", existente.id);
    if (existente.transacao_extrato_id) {
      await admin.from("transacoes")
        .update({ valor: p.valor, data: p.payDate, valor_projetado: p.valor })
        .eq("id", existente.transacao_extrato_id);
    }
    return "atualizado";
  }

  // Sem inv_dividendos provisionado: tenta ADOTAR um lançamento manual que o
  // usuário já tenha criado na agenda para este provento (mesma conta +
  // categoria do tipo + mês, RECEITA ainda não recebida e ainda não vinculada
  // a nenhum dividendo). Evita duplicar quando a pessoa provisiona o aluguel
  // na mão e o dia não bate com o anúncio da B3.
  const manual = await adotarTransacaoManual(admin, {
    userId: p.userId, contaId: p.contaId, categoriaId: p.categoriaId,
    ticker: p.ticker, mesIni, mesFim,
  });
  if (manual) {
    const { data: div, error: errDiv } = await admin.from("inv_dividendos").insert({
      user_id: p.userId, ativo_id: p.ativoId, conta_id: p.contaId,
      valor: p.valor, data_pagamento: p.payDate, tipo_ativo: p.tipoAtivo,
      tipo_dividendo_id: p.tipoDivId, descricao: null, transacao_extrato_id: manual.id,
      valor_por_cota: vpc,
    }).select("id").single();
    if (errDiv || !div) { logError("dividendos-cron adotar div", errDiv); return "ignorado"; }
    // Atualiza valor/data do lançamento manual com os números reais da B3
    // (o trigger trg_sync_transacao_dividendo mantém o dividendo alinhado).
    const campos: Record<string, unknown> = { valor: p.valor, data: p.payDate };
    if (manual.status === "PROJECAO") campos.valor_projetado = p.valor;
    await admin.from("transacoes").update(campos).eq("id", manual.id);
    return "atualizado";
  }

  // Cria o dividendo (sem vínculo ainda)
  const { data: div, error: errDiv } = await admin.from("inv_dividendos").insert({
    user_id: p.userId, ativo_id: p.ativoId, conta_id: p.contaId,
    valor: p.valor, data_pagamento: p.payDate, tipo_ativo: p.tipoAtivo,
    tipo_dividendo_id: p.tipoDivId, descricao: null, valor_por_cota: vpc,
  }).select("id").single();
  if (errDiv || !div) { logError("dividendos-cron criar div", errDiv); return "ignorado"; }

  const desc = `${p.ticker} - ${p.rotulo ?? "Dividendos"}`.slice(0, 200);
  const { data: tx, error: errTx } = await admin.from("transacoes").insert({
    user_id: p.userId, conta_id: p.contaId, categoria_id: p.categoriaId,
    data: p.payDate, descricao: desc.length >= 2 ? desc : `Dividendo ${desc}`.slice(0, 200),
    valor: p.valor, tipo: "RECEITA", status: "PROJECAO", valor_projetado: p.valor,
  }).select("id").single();
  if (errTx || !tx) {
    await admin.from("inv_dividendos").delete().eq("id", div.id); // rollback
    logError("dividendos-cron criar tx", errTx);
    return "ignorado";
  }

  await admin.from("inv_dividendos").update({ transacao_extrato_id: tx.id }).eq("id", div.id);
  return "criado";
}

// Procura um lançamento de provento que o usuário criou manualmente na agenda e
// que ainda NÃO está vinculado a nenhum inv_dividendos, para reaproveitar em vez
// de duplicar. Conservador: só adota quando consegue identificar UM único
// candidato (pelo ticker na descrição, ou um único lançamento livre no mês) —
// nunca arrisca encostar em receita que possa ser de outro provento.
async function adotarTransacaoManual(admin: Db, p: {
  userId: string; contaId: string; categoriaId: string;
  ticker: string; mesIni: string; mesFim: string;
}): Promise<{ id: string; status: string } | null> {
  const { data: txs } = await admin.from("transacoes")
    .select("id, descricao, status")
    .eq("user_id", p.userId).eq("conta_id", p.contaId)
    .eq("categoria_id", p.categoriaId).eq("tipo", "RECEITA")
    .in("status", ["PROJECAO", "PENDENTE"])
    .gte("data", p.mesIni).lt("data", p.mesFim);
  const lista = (txs ?? []) as { id: string; descricao: string | null; status: string }[];
  if (lista.length === 0) return null;

  // Descarta os que já pertencem a algum dividendo (já reconciliados).
  const { data: vinc } = await admin.from("inv_dividendos")
    .select("transacao_extrato_id").in("transacao_extrato_id", lista.map((t) => t.id));
  const usados = new Set(
    (vinc ?? []).map((v) => (v as { transacao_extrato_id: string }).transacao_extrato_id),
  );
  const livres = lista.filter((t) => !usados.has(t.id));
  if (livres.length === 0) return null;

  // Desambigua por ticker na descrição; senão, só adota se houver um único livre.
  const alvo = p.ticker.trim().toUpperCase();
  const porTicker = livres.filter((t) => (t.descricao ?? "").toUpperCase().includes(alvo));
  if (porTicker.length === 1) return { id: porTicker[0].id, status: porTicker[0].status };
  if (porTicker.length === 0 && livres.length === 1) return { id: livres[0].id, status: livres[0].status };
  return null; // ambíguo → não arrisca; segue para criar um novo
}

// Proventos da Polygon.io (v3 reference dividends; incluído no plano free).
// Campos usados: pay_date, cash_amount (por ação, em USD), dividend_type.
async function buscarDividendosPolygon(
  ticker: string, apiKey: string,
): Promise<{ pay_date: string; cash_amount: number; dividend_type: string }[]> {
  const t = ticker.trim().toUpperCase();
  if (!t) return [];
  const url =
    `https://api.polygon.io/v3/reference/dividends?ticker=${encodeURIComponent(t)}` +
    `&limit=50&order=desc&sort=pay_date&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) { logError("Polygon dividends", `${t}: ${res.status}`); return []; }
  const data = await res.json() as {
    results?: { pay_date?: string; cash_amount?: number; dividend_type?: string }[];
  };
  const out: { pay_date: string; cash_amount: number; dividend_type: string }[] = [];
  for (const d of data.results ?? []) {
    const pay  = String(d.pay_date ?? "").slice(0, 10);
    const cash = Number(d.cash_amount);
    if (!RE_DATA.test(pay) || !Number.isFinite(cash) || cash <= 0) continue;
    out.push({ pay_date: pay, cash_amount: cash, dividend_type: String(d.dividend_type ?? "") });
  }
  return out;
}

// ============================================================
// /investimentos/dividendos-cron-br — JOB diário: provisiona proventos
// FUTUROS de ativos em BRL (ACOES / ETF / FII) a partir dos dados
// PÚBLICOS e GRATUITOS da B3. Sem JWT — protegido pelo x-cron-secret
// (= CRON_SECRET). Agende com pg_cron + pg_net (migration própria).
//
// Regras (espelham a rotina USD, definidas com o usuário):
//   • Fonte: endpoints públicos da B3 (não precisa de API key).
//       - ACOES/ETF → listedCompaniesProxy/GetListedSupplementCompany
//       - FII       → fundsProxy/GetListedSupplementFunds
//   • 1 requisição por ativo, com pausa aleatória curta entre elas.
//   • Só proventos FUTUROS (paymentDate >= hoje) → PROJECAO
//     ("provisionado"). BRL não usa PTAX.
//   • Valor por POSIÇÃO ATIVA: rate (por ação/cota) × quantidade.
//   • Tipo do provento mapeado pelo `label` da B3 → inv_tipos_dividendo:
//       DIVIDENDO        → "Dividendos"
//       JRS CAP PROPRIO  → "JSCP"
//       RENDIMENTO + FII → "Aluguel de FII"
//       RENDIMENTO + ação→ "Rend. Trib."
//     Sem categoria mapeada no tipo → pula (não lança sem extrato).
//   • Reconciliação: reusa upsertDividendoProvisionado (mesma chave
//     user+ativo+conta+tipo dentro do mês do pay_date).
// ============================================================
// JOB (todos os usuários) — protegido pelo x-cron-secret.
async function rotaDividendosCronBr(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  if (!esperado || (req.headers.get("x-cron-secret") ?? "") !== esperado) return erro("Não autorizado", 401);
  logRequest("POST", "/investimentos/dividendos-cron-br", {});
  return json({ dados: await provisionarProventosBrl(dbAdmin(), null) });
}

// Disparo MANUAL pelo usuário logado (botão "Buscar proventos agora").
// Autenticado por JWT — roda a MESMA rotina, escopada só ao próprio usuário,
// então NÃO precisa do CRON_SECRET.
async function rotaDividendosBuscarBr(_req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/dividendos-buscar-br", { userId });
  return json({ dados: await provisionarProventosBrl(dbAdmin(), userId) });
}

// Núcleo compartilhado: provisiona proventos BRL. filtroUserId = null processa
// TODOS os usuários (cron); um id processa só aquele usuário (disparo manual).
async function provisionarProventosBrl(
  admin: Db, filtroUserId: string | null,
): Promise<{ processados: number; criados: number; atualizados: number; pulados: number }> {
  const hoje = hojeISO();

  // Ativos BRL cotados que a B3 cobre com proventos
  let consulta = admin.from("inv_ativos")
    .select("id, user_id, ticker, tipo_ativo, acoes_subtipo")
    .eq("moeda", "BRL").in("tipo_ativo", ["ACOES", "ETF", "FII"]);
  if (filtroUserId) consulta = consulta.eq("user_id", filtroUserId);
  const { data: ativos, error } = await consulta;
  if (error) { logError("dividendos-br ativos", error); throw new Error(error.message); }

  // Cache dos tipos de dividendo por usuário (nome → {id, categoria_id})
  const tiposPorUser = new Map<string, Map<string, { id: string; categoria_id: string | null }>>();
  async function tiposDoUsuario(userId: string) {
    if (tiposPorUser.has(userId)) return tiposPorUser.get(userId)!;
    const { data } = await admin.from("inv_tipos_dividendo")
      .select("id, nome, categoria_id").eq("user_id", userId);
    const mapa = new Map<string, { id: string; categoria_id: string | null }>();
    for (const t of (data ?? []) as { id: string; nome: string; categoria_id: string | null }[]) {
      mapa.set(t.nome, { id: String(t.id), categoria_id: t.categoria_id });
    }
    tiposPorUser.set(userId, mapa);
    return mapa;
  }

  // Pendências de mapeamento por usuário: tipo → {motivo, tickers}. Quando
  // um provento FUTURO não pode ser lançado por falta de categoria mapeada,
  // registramos aqui para avisar o usuário (ver persistência no fim).
  const pend = new Map<string, Map<string, { motivo: string; tickers: Set<string> }>>();
  const usuariosTocados = new Set<string>();
  // Novidades por usuário (criados/atualizados) para o aviso de login.
  const nov = new Map<string, { criados: number; atualizados: number; itens: NovidadeItem[] }>();

  let processados = 0, criados = 0, atualizados = 0, pulados = 0;
  for (const ativo of (ativos ?? []) as AtivoBrl[]) {
    try {
      const { data: posicoes } = await admin.from("inv_posicoes")
        .select("conta_id, quantidade").eq("ativo_id", ativo.id).eq("status", "ATIVA");
      if (!posicoes || posicoes.length === 0) continue;
      usuariosTocados.add(ativo.user_id);

      // Pausa aleatória curta (250–1250ms) — cordialidade com a B3
      await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 1000)));
      const proventos = await coletarProventosB3(ativo);
      processados++;

      const tipos = await tiposDoUsuario(ativo.user_id);
      for (const pv of proventos) {
        if (pv.payDate < hoje) continue; // só futuros (PROJECAO)
        const nomeTipo = tipoNomePorLabelB3(pv.label, ativo.tipo_ativo);
        const tipo = tipos.get(nomeTipo);
        if (!tipo?.categoria_id) {
          // Sem categoria → não lança; registra pendência para avisar.
          pulados++;
          registrarPendencia(pend, ativo.user_id, nomeTipo,
            tipo ? "sem_categoria" : "tipo_inexistente", ativo.ticker);
          continue;
        }

        for (const pos of posicoes as { conta_id: string; quantidade: number }[]) {
          const valorBRL = Number((pv.rate * Number(pos.quantidade)).toFixed(2));
          if (valorBRL <= 0) continue;
          const r = await upsertDividendoProvisionado(admin, {
            userId: ativo.user_id, ativoId: ativo.id, contaId: pos.conta_id,
            tipoAtivo: ativo.tipo_ativo, tipoDivId: tipo.id,
            categoriaId: String(tipo.categoria_id), ticker: ativo.ticker,
            valor: valorBRL, payDate: pv.payDate, rotulo: nomeTipo,
            valorPorCota: pv.rate,
          });
          if (r === "criado" || r === "atualizado") {
            if (r === "criado") criados++; else atualizados++;
            registrarNovidade(nov, ativo.user_id, {
              ticker: ativo.ticker, tipo: nomeTipo, data_pagamento: pv.payDate,
              valor: valorBRL, acao: r,
            });
          }
        }
      }
    } catch (e) { logError("dividendos-cron-br ativo", e); }
  }

  // Persiste (ou limpa) o aviso por usuário processado. Sobrescreve sempre:
  // ao mapear a categoria que faltava, a próxima execução zera o aviso.
  for (const userId of usuariosTocados) {
    const m = pend.get(userId);
    const tiposAviso = m && m.size > 0
      ? [...m.entries()].map(([tipo, info]) => ({
          tipo, motivo: info.motivo, tickers: [...info.tickers].slice(0, 30),
        }))
      : [];
    const aviso = tiposAviso.length > 0 ? { atualizado_em: hoje, tipos: tiposAviso } : null;
    await admin.from("usuarios").update({ inv_dividendos_avisos: aviso }).eq("id", userId);
  }

  // Persiste novidades p/ exibir no login. Mescla com o que ainda não foi
  // visto (o frontend zera ao visualizar) para não perder avisos antigos.
  for (const [userId, info] of nov) {
    const { data: cur } = await admin.from("usuarios")
      .select("inv_dividendos_novidades").eq("id", userId).single();
    const prev = (cur?.inv_dividendos_novidades ?? null) as NovidadesPayload | null;
    const payload: NovidadesPayload = {
      gerado_em:   new Date().toISOString(),
      criados:     info.criados + (prev?.criados ?? 0),
      atualizados: info.atualizados + (prev?.atualizados ?? 0),
      itens:       [...info.itens, ...(prev?.itens ?? [])].slice(0, 25),
    };
    await admin.from("usuarios").update({ inv_dividendos_novidades: payload }).eq("id", userId);

    // Registro DURÁVEL na agenda: 1 lembrete-resumo CONCLUÍDO por execução
    // (a notificação do login some ao ser vista; este fica no histórico).
    const partes: string[] = [];
    if (info.criados > 0)     partes.push(`${info.criados} provisionado(s)`);
    if (info.atualizados > 0) partes.push(`${info.atualizados} atualizado(s)`);
    if (partes.length > 0) {
      const desc = `Proventos B3 (busca automática): ${partes.join(", ")}`.slice(0, 200);
      const { error: errLem } = await admin.from("lembretes")
        .insert({ user_id: userId, data: hoje, descricao: desc, status: "CONCLUIDO" });
      if (errLem) logError("dividendos-br lembrete", errLem);
    }
  }

  logSuccess("Dividendos BR", { escopo: filtroUserId ?? "todos", processados, criados, atualizados, pulados });
  return { processados, criados, atualizados, pulados };
}

// ============================================================
// /investimentos/dividendos-backfill-rate (POST, JWT do usuário)
//
// Preenche inv_dividendos.valor_por_cota (rate por cota) dos proventos
// ANTIGOS que estão NULL, re-buscando da B3 e casando por (ativo + data de
// pagamento). É o que destrava o DY/YoC no padrão investidor10 para o
// histórico já existente. Só ações/ETF/FII em BRL (a B3 cobre esses).
//
// Casamento: 1 provento na data → aplica direto; vários (ex.: dividendo +
// JSCP no mesmo dia) → desambigua pelo tipo; se não der, pula (mantém NULL,
// cai na estimativa do /ranking).
// ============================================================
async function rotaDividendosBackfillRate(c: Db, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/dividendos-backfill-rate", { userId });

  // Ativos BRL cobertos pela B3
  const { data: ativos, error: errAtv } = await c.from("inv_ativos")
    .select("id, user_id, ticker, tipo_ativo, acoes_subtipo")
    .eq("moeda", "BRL").in("tipo_ativo", ["ACOES", "ETF", "FII"]);
  if (errAtv) { logError("backfill-rate ativos", errAtv); return erro(errAtv.message); }

  let processados = 0, preenchidos = 0, semFonte = 0, ambiguos = 0;
  for (const ativo of (ativos ?? []) as AtivoBrl[]) {
    try {
      // Proventos do ativo ainda sem rate
      const { data: rows } = await c.from("inv_dividendos")
        .select("id, data_pagamento, valor, inv_tipos_dividendo(nome)")
        .eq("ativo_id", ativo.id).is("valor_por_cota", null);
      if (!rows || rows.length === 0) continue;

      // Cortesia com a B3: pausa curta antes da requisição
      await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 1000)));
      const proventos = await coletarProventosB3(ativo);
      processados++;
      if (proventos.length === 0) { semFonte += rows.length; continue; }

      // payDate → [{ rate, tipoNome }]
      const porData = new Map<string, { rate: number; tipoNome: string }[]>();
      for (const pv of proventos) {
        const tipoNome = tipoNomePorLabelB3(pv.label, ativo.tipo_ativo);
        const lista = porData.get(pv.payDate) ?? [];
        lista.push({ rate: pv.rate, tipoNome });
        porData.set(pv.payDate, lista);
      }

      for (const row of rows as { id: string; data_pagamento: string; inv_tipos_dividendo?: { nome?: string } | null }[]) {
        const cands = porData.get(String(row.data_pagamento).slice(0, 10));
        if (!cands || cands.length === 0) { semFonte++; continue; }
        let rate: number | null = null;
        if (cands.length === 1) {
          rate = cands[0].rate;
        } else {
          const nomeRow = row.inv_tipos_dividendo?.nome ?? "";
          const match = cands.filter((c2) => c2.tipoNome === nomeRow);
          if (match.length === 1) rate = match[0].rate;
        }
        if (rate == null || !(rate > 0)) { ambiguos++; continue; }
        const { error: errUpd } = await c.from("inv_dividendos")
          .update({ valor_por_cota: Number(rate.toFixed(8)) }).eq("id", row.id);
        if (errUpd) { logError("backfill-rate update", errUpd); continue; }
        preenchidos++;
      }
    } catch (e) { logError("backfill-rate ativo", e); }
  }

  logSuccess("Backfill rate", { processados, preenchidos, semFonte, ambiguos });
  return json({ dados: { processados, preenchidos, sem_fonte: semFonte, ambiguos } });
}

// ============================================================
// /investimentos/rendimento-cripto (POST, JWT do usuário)
//
// Materializa o rendimento (yield) das criptos com cripto_rendimento_aa > 0
// como operações RENDIMENTO: 1 por mês por posição (upsert), com juros
// compostos diários. Aumenta a quantidade com custo zero (mais tokens) — não
// é provento. Idempotente: re-rodar só ajusta os valores dos meses.
// ============================================================
async function rotaRendimentoCripto(c: Db, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/rendimento-cripto", { userId });
  return json({ dados: await provisionarRendimentoCripto(c, userId) });
}

// JOB (todos os usuários) — protegido pelo x-cron-secret. Roda via service_role.
async function rotaRendimentoCriptoCron(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  if (!esperado || (req.headers.get("x-cron-secret") ?? "") !== esperado) return erro("Não autorizado", 401);
  logRequest("POST", "/investimentos/rendimento-cripto-cron", {});
  return json({ dados: await provisionarRendimentoCripto(dbAdmin(), null) });
}

// Dias (UTC) entre duas datas YYYY-MM-DD.
function diasEntreISO(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
// Soma n dias a uma data YYYY-MM-DD.
function addDiasISO(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
// Periodicidade → dias do período de composição (default MENSAL=30).
function periodoDiasComposicao(p: string | null | undefined): number {
  if (p === "DIARIA") return 1;
  if (p === "SEMANAL") return 7;
  return 30; // MENSAL / null
}

// filtroUserId = null processa TODOS os usuários (cron); um id processa só
// aquele usuário (disparo manual via JWT). Espelha provisionarProventosBrl.
async function provisionarRendimentoCripto(
  c: Db, filtroUserId: string | null,
): Promise<{ posicoes: number; operacoes_criadas: number; operacoes_atualizadas: number }> {
  const hoje = hojeISO();
  let consulta = c.from("inv_ativos")
    .select("id, user_id, ticker, cripto_rendimento_aa, cripto_rendimento_inicio, cripto_rendimento_periodicidade")
    .eq("tipo_ativo", "CRIPTOMOEDAS").gt("cripto_rendimento_aa", 0);
  if (filtroUserId) consulta = consulta.eq("user_id", filtroUserId);
  const { data: ativos } = await consulta;

  let posicoesTocadas = 0, opsCriadas = 0;
  for (const ativo of (ativos ?? []) as {
    id: string; user_id: string; cripto_rendimento_aa: number;
    cripto_rendimento_inicio: string | null; cripto_rendimento_periodicidade: string | null;
  }[]) {
    const taxa = Number(ativo.cripto_rendimento_aa) / 100; // % a.a. → fração
    if (!(taxa > 0)) continue;
    const pDias = periodoDiasComposicao(ativo.cripto_rendimento_periodicidade);

    const { data: posicoes } = await c.from("inv_posicoes")
      .select("id, conta_id").eq("ativo_id", ativo.id).eq("status", "ATIVA");

    for (const pos of (posicoes ?? []) as { id: string; conta_id: string }[]) {
      // Rebuild: apaga as operações RENDIMENTO da posição e recalcula do zero.
      // Evita conflito entre esquemas (mensal antigo × semanal novo) e mantém
      // tudo consistente quando taxa/início/periodicidade mudam.
      await c.from("inv_operacoes").delete().eq("posicao_id", pos.id).eq("tipo_operacao", "RENDIMENTO");

      const { data: ops } = await c.from("inv_operacoes")
        .select("tipo_operacao, quantidade, data_operacao")
        .eq("posicao_id", pos.id).order("data_operacao", { ascending: true });
      const base = (ops ?? []) as { tipo_operacao: string; quantidade: number; data_operacao: string }[];

      // Início = 1º aporte/compra; se houver data configurada, usa a MAIOR
      // (não há cotas antes da compra; e o usuário pode ter passado a render depois).
      const primeira = base.find((o) => o.tipo_operacao === "COMPRA" || o.tipo_operacao === "APORTE");
      if (!primeira) continue;
      const compra = String(primeira.data_operacao);
      const cfg = ativo.cripto_rendimento_inicio ? String(ativo.cripto_rendimento_inicio) : null;
      const inicio = cfg && cfg > compra ? cfg : compra;
      if (inicio > hoje) continue;

      // Quantidade até uma data: ops reais + recompensas calculadas neste run.
      const rewards: { data: string; qtd: number }[] = [];
      const qtdAte = (limite: string): number => {
        let q = 0;
        for (const o of base) {
          if (String(o.data_operacao) > limite) break;
          const qq = Number(o.quantidade) || 0;
          const t = o.tipo_operacao;
          if (t === "COMPRA" || t === "APORTE") q += qq;
          else if (t === "VENDA" || t === "RESGATE") q -= Math.min(qq, q);
          if (q < 0) q = 0;
        }
        for (const r of rewards) if (r.data <= limite) q += r.qtd;
        return q;
      };

      // Materialização SEMANAL: 1 operação por bloco de 7 dias desde o início.
      let bIni = inicio;
      while (bIni <= hoje) {
        const bUlt = addDiasISO(bIni, 6);              // último dia do bloco
        const fim  = bUlt > hoje ? hoje : bUlt;        // bloco corrente é parcial
        const dias = diasEntreISO(bIni, fim) + 1;      // inclusivo
        const qtdBase = qtdAte(bIni);                  // cotas no início do bloco
        // Composição na periodicidade escolhida (taxa por período, dias/período vezes).
        const fator  = Math.pow(1 + taxa * pDias / 365, dias / pDias);
        const tokens = qtdBase * (fator - 1);
        if (tokens > 1e-8) {
          const valor = Number(tokens.toFixed(8));
          await c.from("inv_operacoes").insert({
            user_id: ativo.user_id, posicao_id: pos.id, tipo_operacao: "RENDIMENTO",
            conta_id: pos.conta_id, quantidade: valor, preco_unitario: 0,
            valor_total: 0, data_operacao: fim,
          });
          opsCriadas++;
          rewards.push({ data: fim, qtd: valor }); // compõe nos blocos seguintes
        }
        bIni = addDiasISO(bIni, 7);
      }

      await recomputarPosicao(c, pos.id);
      posicoesTocadas++;
    }
  }
  logSuccess("Rendimento cripto", { posicoesTocadas, opsCriadas });
  return { posicoes: posicoesTocadas, operacoes_criadas: opsCriadas, operacoes_atualizadas: 0 };
}

interface NovidadeItem {
  ticker: string; tipo: string; data_pagamento: string; valor: number;
  acao: "criado" | "atualizado";
}
interface NovidadesPayload {
  gerado_em: string; criados: number; atualizados: number; itens: NovidadeItem[];
}

// Acumula um provento criado/atualizado para o aviso de login.
function registrarNovidade(
  nov: Map<string, { criados: number; atualizados: number; itens: NovidadeItem[] }>,
  userId: string, item: NovidadeItem,
) {
  let n = nov.get(userId);
  if (!n) { n = { criados: 0, atualizados: 0, itens: [] }; nov.set(userId, n); }
  if (item.acao === "criado") n.criados++; else n.atualizados++;
  if (n.itens.length < 25) n.itens.push(item);
}

// Acumula uma pendência de mapeamento (tipo sem categoria / inexistente).
function registrarPendencia(
  pend: Map<string, Map<string, { motivo: string; tickers: Set<string> }>>,
  userId: string, tipo: string, motivo: string, ticker: string,
) {
  let m = pend.get(userId);
  if (!m) { m = new Map(); pend.set(userId, m); }
  const cur = m.get(tipo);
  if (cur) cur.tickers.add(ticker);
  else m.set(tipo, { motivo, tickers: new Set([ticker]) });
}

interface AtivoBrl {
  id: string; user_id: string; ticker: string;
  tipo_ativo: string; acoes_subtipo: string | null;
}
interface ProventoB3 { payDate: string; rate: number; label: string }

// Identificador B3 = ticker sem os dígitos finais (PETR4→PETR, HGLG11→HGLG).
function emissorB3(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\d+$/, "");
}

// Mapeia o label da B3 + tipo do ativo para o nome do inv_tipos_dividendo.
function tipoNomePorLabelB3(label: string, tipoAtivo: string): string {
  const l = label.trim().toUpperCase();
  if (l.includes("JRS") || l.includes("JCP") || l.includes("JURO")) return "JSCP";
  if (l.includes("DIVIDENDO")) return "Dividendos";
  // RENDIMENTO (e demais): FII = aluguel; ação/ETF = rendimento tributável
  return tipoAtivo === "FII" ? "Aluguel de FII" : "Rend. Trib.";
}

// Coleta proventos FUTUROS-inclusos da B3 e deduplica. Para ações filtra
// a classe (ON/PN/UNIT) do papel; para FII junta as séries de mesma data.
async function coletarProventosB3(ativo: AtivoBrl): Promise<ProventoB3[]> {
  const brutos = ativo.tipo_ativo === "FII"
    ? await buscarProventosFundoB3(emissorB3(ativo.ticker))
    : await buscarProventosCompanhiaB3(emissorB3(ativo.ticker));
  if (brutos.length === 0) return [];

  const classeAlvo = classeDoTicker(ativo.ticker, ativo.acoes_subtipo);
  // Dedup por (payDate|label): para ações prioriza o ISIN da classe certa.
  const escolhido = new Map<string, ProventoB3 & { classe: "ON" | "PN" | null }>();
  for (const b of brutos) {
    const chave = `${b.payDate}|${b.label}`;
    const atual = escolhido.get(chave);
    if (!atual) { escolhido.set(chave, b); continue; }
    if (ativo.tipo_ativo !== "FII" && classeAlvo) {
      // Substitui se o novo casa com a classe e o atual não
      if (b.classe === classeAlvo && atual.classe !== classeAlvo) escolhido.set(chave, b);
    }
  }
  return [...escolhido.values()].map(({ payDate, rate, label }) => ({ payDate, rate, label }));
}

// Classe-alvo do papel: prioriza acoes_subtipo; senão deduz do sufixo
// numérico (3=ON, 4/5/6=PN, 11=UNIT). null = indeterminado (ex.: ETF/FII).
function classeDoTicker(ticker: string, subtipo: string | null): "ON" | "PN" | "UNIT" | null {
  if (subtipo === "ON" || subtipo === "PN" || subtipo === "UNIT") return subtipo;
  const m = ticker.trim().match(/(\d+)$/);
  if (!m) return null;
  const suf = m[1];
  if (suf === "3") return "ON";
  if (suf === "4" || suf === "5" || suf === "6") return "PN";
  if (suf === "11") return "UNIT";
  return null;
}

// Classe a partir do ISIN da B3 (…OR<dig> = ON, …PR<dig> = PN).
function classeDoIsin(isin: string): "ON" | "PN" | null {
  const s = (isin ?? "").toUpperCase();
  if (/OR\d$/.test(s)) return "ON";
  if (/PR\d$/.test(s)) return "PN";
  return null;
}

// Proventos de COMPANHIA (ações/ETF) — GetListedSupplementCompany.
async function buscarProventosCompanhiaB3(issuer: string): Promise<(ProventoB3 & { classe: "ON" | "PN" | null })[]> {
  if (!issuer) return [];
  const params = btoa(JSON.stringify({ issuingCompany: issuer, language: "pt-br" }));
  const url = `https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/${params}`;
  const data = await fetchB3<{ cashDividends?: B3CashDividend[] }[]>(url, issuer);
  const reg = Array.isArray(data) ? data[0] : data;
  return mapearCashDividends(reg?.cashDividends);
}

// Proventos de FUNDO (FII) — GetListedSupplementFunds.
async function buscarProventosFundoB3(identifier: string): Promise<(ProventoB3 & { classe: "ON" | "PN" | null })[]> {
  if (!identifier) return [];
  const params = btoa(JSON.stringify({ typeFund: 7, identifierFund: identifier }));
  const url = `https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds/${params}`;
  const data = await fetchB3<{ cashDividends?: B3CashDividend[] }>(url, identifier);
  const reg = Array.isArray(data) ? data[0] : data;
  return mapearCashDividends(reg?.cashDividends);
}

interface B3CashDividend {
  paymentDate?: string; rate?: string; label?: string; isinCode?: string; assetIssued?: string;
}

function mapearCashDividends(lista?: B3CashDividend[]): (ProventoB3 & { classe: "ON" | "PN" | null })[] {
  const out: (ProventoB3 & { classe: "ON" | "PN" | null })[] = [];
  for (const d of lista ?? []) {
    const payDate = brDataISO(String(d.paymentDate ?? ""));
    const rate    = brNumero(String(d.rate ?? ""));
    if (!RE_DATA.test(payDate) || !Number.isFinite(rate) || rate <= 0) continue;
    out.push({
      payDate, rate, label: String(d.label ?? ""),
      classe: classeDoIsin(String(d.isinCode ?? d.assetIssued ?? "")),
    });
  }
  return out;
}

// GET JSON na B3 com timeout e tratamento tolerante (igual Polygon/Yahoo).
async function fetchB3<T>(url: string, ref: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { logError("B3 proventos", `${ref}: ${res.status}`); return null; }
    const txt = await res.text();
    if (!txt || txt === '""' || txt === "null") return null;
    return JSON.parse(txt) as T;
  } catch (e) { logError("B3 proventos", `${ref}: ${e}`); return null; }
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

function mesesEntre(ini: string, fim: string): string[] {
  const out: string[] = [];
  let [y, mo] = ini.split("-").map(Number);
  const [yf, mf] = fim.split("-").map(Number);
  let guard = 0;
  while ((y < yf || (y === yf && mo <= mf)) && guard++ < 1200) {
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

// Último mês com snapshot de uma renda fixa: o título não gera histórico
// depois de vencido, então a série não passa do mês de vencimento (quando este
// é anterior ao fim normal da série).
function fimSerieRF(venc: string | null, mesFim: string): string {
  if (!venc) return mesFim;
  const vencMes = venc.slice(0, 7);
  return vencMes < mesFim ? vencMes : mesFim;
}

// Histórico mensal de cotação no Yahoo Finance. Devolve a série (mês→preço)
// e a MOEDA detectada (meta.currency) — B3 usa sufixo .SA (BRL); papéis dos
// EUA usam o ticker puro (USD). Yahoo bloqueia sem User-Agent.
async function historicoYahoo(symbol: string): Promise<{ precos: Map<string, number>; moeda: string }> {
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

async function historicoBrapiHist(ticker: string): Promise<Map<string, number>> {
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
async function historicoCotado(ticker: string, moedaHint: string): Promise<{ precos: Map<string, number>; moeda: string }> {
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
const COINGECKO_ID_OVERRIDES: Record<string, string> = {
  USDC: "usd-coin",
};
const _cgIdCache = new Map<string, string | null>();
async function coingeckoId(symbol: string): Promise<string | null> {
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

async function historicoCripto(ticker: string): Promise<Map<string, number>> {
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
async function resolverHistoricoCotado(c: Db, ticker: string, moedaHint: string, inicio: string): Promise<{ precos: Map<string, number>; moeda: string }> {
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

async function resolverHistoricoCripto(c: Db, ticker: string, inicio: string): Promise<Map<string, number>> {
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
async function ptaxPorMesMap(c: Db, desdeISO: string): Promise<Map<string, number>> {
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
async function rebuildHistoricoRF(c: Db, userId: string, ativoId: string): Promise<number> {
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

  const mesCorrente = new Date().toISOString().slice(0, 7);
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

async function rotaSnapshotBackfill(c: Db, req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const body = await req.json().catch(() => ({})) as { conta_id?: string; ate?: string; ativo_id?: string };
  const mesCorrente = new Date().toISOString().slice(0, 7);
  // Backfill cobre só meses PASSADOS — para no mês anterior. O mês corrente é
  // tarefa do "Atualizar cotação"/job diário (cotação ao vivo), e o fechamento
  // mensal da fonte (Yahoo) só sai quando o mês termina.
  const [yc, mc] = mesCorrente.split("-").map(Number);
  const dPrev = new Date(Date.UTC(yc, mc - 2, 1));
  const mesAnterior = `${dPrev.getUTCFullYear()}-${String(dPrev.getUTCMonth() + 1).padStart(2, "0")}`;
  const mesFim = body.ate && RE_MES_ANO.test(body.ate) ? body.ate : mesAnterior;
  logRequest("POST", "/investimentos/snapshot-backfill", { conta_id: body.conta_id ?? null, ativo_id: body.ativo_id ?? null, ate: mesFim });

  let q = c.from("inv_posicoes")
    .select("ativo_id, conta_id, quantidade, valor_custo, data_compra, inv_ativos(ticker, nome, tipo_ativo, moeda, rf_indexador, rf_taxa, rf_vencimento, cotacao_automatica)")
    .eq("status", "ATIVA");
  if (body.conta_id) q = q.eq("conta_id", body.conta_id);
  if (body.ativo_id) q = q.eq("ativo_id", body.ativo_id);
  const { data: posicoes, error } = await q;
  if (error) { logError("backfill posicoes", error); return erro(error.message); }

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
        posicoes: [], inicio: mesCompra,
      });
    }
    const g = grupos.get(key)!;
    g.posicoes.push({
      quantidade: Number(p.quantidade) || 0, valor_custo: Number(p.valor_custo) || 0,
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
    // meses que já têm snapshot — não sobrescreve
    const { data: existentes } = await c.from("inv_historico_mensal")
      .select("mes_ano").eq("ativo_id", g.ativoId).eq("conta_id", g.contaId);
    const jaTem = new Set((existentes ?? []).map((e) => String(e.mes_ano)));
    // RF não gera histórico depois do vencimento.
    const fimGrupo = ehRF(g.tipo) ? fimSerieRF(g.vencimento, mesFim) : mesFim;
    const faltantes = mesesEntre(g.inicio, fimGrupo).filter((me) => !jaTem.has(me));
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

    for (const me of faltantes) {
      // posições já compradas até este mês
      const posMes = g.posicoes.filter((p) => p.data_compra.slice(0, 7) <= me);
      if (posMes.length === 0) continue;
      const qtdMes   = posMes.reduce((s, p) => s + p.quantidade, 0);
      const custoMes = posMes.reduce((s, p) => s + p.valor_custo, 0);
      if (qtdMes <= 0) continue;
      const precoMedio = custoMes / qtdMes;
      const dataRef = new Date(Date.UTC(Number(me.slice(0, 4)), Number(me.slice(5, 7)), 0, 12)); // último dia do mês

      let valor: number;
      if (ehRF(g.tipo)) {
        valor = valorRFPosicoes(posMes, g.tipo, g.indexador, g.vencimento, g.nome, me, dataRef, g.taxa, cdiSerie, ipcaSerie, cdi, ipca, mtmTesouro);
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

interface AtivoIn {
  ticker: string; nome?: string; tipo_ativo: string; moeda?: string;
  rf_subtipo?: string | null; rf_indexador?: string | null;
  rf_emissor?: string | null; rf_vencimento?: string | null;
  fii_categoria?: string | null; acoes_subtipo?: string | null;
}
interface PosicaoIn {
  ticker: string; conta_id: string; quantidade: number; preco_custo: number;
  data_compra: string; valor_mercado: number; mes_ano?: string;
}
interface OperacaoIn {
  ticker: string; conta_id: string; tipo_operacao: string; quantidade: number;
  preco_unitario?: number; valor_total?: number; data_operacao: string;
}
interface DividendoIn {
  ticker: string; conta_id: string; valor: number; data_pagamento: string;
  tipo_ativo: string; tipo_dividendo_nome?: string | null;
}

// Insere um array em lote, em pedaços, devolvendo as linhas criadas.
async function inserirEmLote(
  c: Db, tabela: string, rows: Record<string, unknown>[], retorno = "*", chunk = 500,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const fatia = rows.slice(i, i + chunk);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await c.from(tabela).insert(fatia as any).select(retorno);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    if (data) out.push(...(data as unknown as Record<string, unknown>[]));
  }
  return out;
}

// ============================================================
// /investimentos/atualizar-ativos — re-busca nome/moeda oficiais
//
// Reaplica a fonte externa (brapi) a TODOS os ativos do usuário, para o
// caso de a chamada ter falhado no cadastro/importação (ex.: BRAPI_TOKEN
// ausente na época) e o ativo ter ficado só com o ticker. Conservador:
//   • nome  → só preenche quando o atual está vazio ou é o próprio ticker
//             (nunca sobrescreve um nome editado à mão);
//   • moeda → a fonte é autoritativa; corrige quando diverge (ex.: STOCKS
//             que ficaram em BRL devem virar USD).
// Renda fixa privada e Tesouro Direto não têm fonte → são ignorados.
// ============================================================
async function rotaAtualizarAtivos(c: Db, _req: Request, m: string, _userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/atualizar-ativos", {});

  const { data, error } = await c.from("inv_ativos")
    .select("id, ticker, nome, tipo_ativo, moeda, logo_url, setor");
  if (error) { logError("Atualizar ativos — listar", error); return erro(error.message); }
  const lista = (data ?? []) as
    { id: string; ticker: string; nome: string; tipo_ativo: string; moeda: string; logo_url: string | null; setor: string | null }[];
  if (lista.length === 0) {
    return json({ dados: { processados: 0, atualizados: 0, ativos: [] } });
  }

  const meta = await resolverMeta(lista.map((a) =>
    ({ ticker: a.ticker, tipo_ativo: a.tipo_ativo })));

  const atualizados: { ticker: string; nome: string }[] = [];
  for (const a of lista) {
    const info = meta.get(String(a.ticker).toUpperCase());
    if (!info) continue;
    const tk = String(a.ticker).toUpperCase();
    const campos: Record<string, unknown> = {};

    // Preenche o nome quando o atual está vazio ou é só o ticker. Grava mesmo
    // quando o nome oficial É o próprio ticker (ex.: USDC) — senão fica "—".
    const nomeEhTicker = !a.nome || a.nome.trim().toUpperCase() === tk;
    if (info.nome && nomeEhTicker && info.nome !== a.nome) {
      campos.nome = info.nome;
    }
    if (info.moeda && info.moeda.length <= 3 && info.moeda !== a.moeda) {
      campos.moeda = info.moeda;
    }
    if (info.logo && info.logo !== a.logo_url) {
      campos.logo_url = info.logo;
    }
    if (info.setor && info.setor !== a.setor) {
      campos.setor = info.setor;
    }
    if (Object.keys(campos).length === 0) continue;

    const { error: eUp } = await c.from("inv_ativos").update(campos).eq("id", a.id);
    if (eUp) { logError(`Atualizar ativo ${tk}`, eUp); continue; }
    atualizados.push({ ticker: a.ticker, nome: String(campos.nome ?? a.nome) });
  }

  logSuccess("Ativos atualizados", { processados: lista.length, atualizados: atualizados.length });
  return json({ dados: { processados: lista.length, atualizados: atualizados.length, ativos: atualizados } });
}

// ============================================================
// /investimentos/normalizar-tesouro — padroniza o ticker/nome dos títulos
// do Tesouro já cadastrados para o formato legível (TD-IPCA-2040…), derivado
// de indexador + vencimento (+ juros semestrais). Idempotente: re-rodar não
// muda nada. Pula quando faltam dados ou quando o código novo colidiria com
// outro ativo já existente (relatado em `ignorados`).
// ============================================================
async function rotaNormalizarTesouro(c: Db, _req: Request, m: string, _userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/normalizar-tesouro");

  const { data, error } = await c.from("inv_ativos")
    .select("id, ticker, nome, rf_indexador, rf_vencimento")
    .eq("tipo_ativo", "TESOURO_DIRETO");
  if (error) { logError("Normalizar Tesouro — listar", error); return erro(error.message); }
  const lista = (data ?? []) as {
    id: string; ticker: string; nome: string | null;
    rf_indexador: string | null; rf_vencimento: string | null;
  }[];
  if (lista.length === 0) return json({ dados: { processados: 0, renomeados: 0, ativos: [], ignorados: [] } });

  // tickers em uso (para detectar colisão antes do UPDATE)
  const emUso = new Set(lista.map((a) => String(a.ticker).toUpperCase()));
  const renomeados: { de: string; para: string }[] = [];
  const ignorados:  { ticker: string; motivo: string }[] = [];

  for (const a of lista) {
    const indexador = a.rf_indexador;
    const venc      = a.rf_vencimento;
    const atual     = String(a.ticker).toUpperCase();
    if (!indexador || !venc) { ignorados.push({ ticker: a.ticker, motivo: "sem indexador/vencimento" }); continue; }
    const semestral = tesouroSemestral(String(a.nome ?? ""));
    const novo = tickerTesouro(indexador, venc, semestral);
    if (!novo) { ignorados.push({ ticker: a.ticker, motivo: "vencimento inválido" }); continue; }
    if (novo === atual) continue;                               // já no padrão
    if (emUso.has(novo)) { ignorados.push({ ticker: a.ticker, motivo: `já existe ${novo}` }); continue; }

    const campos: Record<string, unknown> = { ticker: novo };
    // Nome: só preenche/normaliza quando vazio ou ainda era o ticker antigo
    // (nunca sobrescreve um nome editado à mão).
    const nomeAtual = String(a.nome ?? "").trim();
    if (!nomeAtual || nomeAtual.toUpperCase() === atual) campos.nome = nomeTesouro(indexador, venc, semestral);

    const { error: eUp } = await c.from("inv_ativos").update(campos).eq("id", a.id);
    if (eUp) { ignorados.push({ ticker: a.ticker, motivo: eUp.message }); continue; }
    emUso.delete(atual); emUso.add(novo);
    renomeados.push({ de: a.ticker, para: novo });
  }

  logSuccess("Tesouro normalizado", { processados: lista.length, renomeados: renomeados.length });
  return json({ dados: { processados: lista.length, renomeados: renomeados.length, ativos: renomeados, ignorados } });
}

async function rotaImportar(c: Db, req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const body = await req.json();
  logRequest("POST", "/investimentos/importar", {
    ativos: body?.ativos?.length, posicoes: body?.posicoes?.length,
    operacoes: body?.operacoes?.length, dividendos: body?.dividendos?.length,
    gerar_extrato: body?.gerar_extrato_proventos,
  });

  const ativosIn     = Array.isArray(body.ativos)     ? body.ativos     as AtivoIn[]     : [];
  const posicoesIn   = Array.isArray(body.posicoes)   ? body.posicoes   as PosicaoIn[]   : [];
  const operacoesIn  = Array.isArray(body.operacoes)  ? body.operacoes  as OperacaoIn[]  : [];
  const dividendosIn = Array.isArray(body.dividendos) ? body.dividendos as DividendoIn[] : [];
  const gerarExtrato = body.gerar_extrato_proventos === true;
  const avisos: string[] = [];

  if (ativosIn.length === 0 && posicoesIn.length === 0 &&
      operacoesIn.length === 0 && dividendosIn.length === 0) {
    return erro("Nada para importar");
  }

  const up = (s: unknown) => String(s ?? "").trim().toUpperCase();

  try {
    // ── Validação de contas (uma vez) ───────────────────────────────
    const contaIds = [...new Set([
      ...posicoesIn.map((p) => p.conta_id),
      ...operacoesIn.map((o) => o.conta_id),
      ...dividendosIn.map((d) => d.conta_id),
    ].filter(Boolean))];
    const contasValidas = new Set<string>();
    if (contaIds.length > 0) {
      const { data: contasOk } = await c.from("contas").select("id").in("id", contaIds);
      for (const x of contasOk ?? []) contasValidas.add(String(x.id));
    }

    // ── 1) Ativos — insere só os que ainda não existem ──────────────
    const { data: existentes } = await c.from("inv_ativos").select("id, ticker");
    const idPorTicker = new Map<string, string>();
    for (const a of existentes ?? []) idPorTicker.set(up(a.ticker), String(a.id));

    const novosPorTicker = new Map<string, Record<string, unknown>>();
    for (const a of ativosIn) {
      const ticker = up(a.ticker);
      if (!ticker || ticker.length > 20) continue;
      if (!TIPOS_ATIVO.includes(String(a.tipo_ativo))) continue;
      if (idPorTicker.has(ticker) || novosPorTicker.has(ticker)) continue;
      novosPorTicker.set(ticker, {
        user_id:       userId,
        ticker,
        nome:          String(a.nome ?? ticker).trim().slice(0, 120) || ticker,
        tipo_ativo:    a.tipo_ativo,
        moeda:         a.moeda ? up(a.moeda).slice(0, 3) : "BRL",
        rf_subtipo:    a.rf_subtipo ?? null,
        rf_indexador:  a.rf_indexador ?? null,
        rf_emissor:    a.rf_emissor ?? null,
        rf_vencimento: a.rf_vencimento ?? null,
        fii_categoria: a.fii_categoria ?? null,
        acoes_subtipo: SUBTIPOS_ACOES.includes(String(a.acoes_subtipo)) ? a.acoes_subtipo : null,
      });
    }
    // Nome oficial via busca externa para os que vieram sem nome (= ticker)
    if (novosPorTicker.size > 0) {
      const semNome = [...novosPorTicker.values()].filter((r) =>
        !r.nome || String(r.nome).toUpperCase() === String(r.ticker).toUpperCase());
      if (semNome.length > 0) {
        const nomes = await resolverNomes(semNome.map((r) =>
          ({ ticker: String(r.ticker), tipo_ativo: String(r.tipo_ativo) })));
        for (const r of semNome) {
          const n = nomes.get(String(r.ticker).toUpperCase());
          if (n) r.nome = n;
        }
      }
    }

    let ativosCriados = 0;
    if (novosPorTicker.size > 0) {
      const criados = await inserirEmLote(c, "inv_ativos", [...novosPorTicker.values()], "id, ticker");
      ativosCriados = criados.length;
      for (const a of criados) idPorTicker.set(up(a.ticker), String(a.id));
    }

    // ── 2) Posições — uma por (ativo_id, conta_id), status ATIVA ────
    const posPorPar = new Map<string, string>(); // ativo_id|conta_id -> posicao_id
    const { data: posExist } = await c.from("inv_posicoes")
      .select("id, ativo_id, conta_id").eq("status", "ATIVA");
    for (const p of posExist ?? []) posPorPar.set(`${p.ativo_id}|${p.conta_id}`, String(p.id));

    const posInserir: Record<string, unknown>[] = [];
    const posAtualizar: { id: string; campos: Record<string, unknown> }[] = [];
    const vistosPar = new Set<string>();
    for (const p of posicoesIn) {
      const ativoId = idPorTicker.get(up(p.ticker));
      if (!ativoId || !p.conta_id || !contasValidas.has(p.conta_id)) continue;
      const key = `${ativoId}|${p.conta_id}`;
      if (vistosPar.has(key)) continue;
      vistosPar.add(key);
      const campos = {
        quantidade:  Number(p.quantidade)  || 0,
        preco_custo: Number(p.preco_custo) || 0,
        data_compra: String(p.data_compra),
        status:      "ATIVA",
      };
      const existId = posPorPar.get(key);
      if (existId) posAtualizar.push({ id: existId, campos });
      else posInserir.push({ user_id: userId, ativo_id: ativoId, conta_id: p.conta_id, ...campos });
    }
    let posicoesCount = 0;
    if (posInserir.length > 0) {
      const criadas = await inserirEmLote(c, "inv_posicoes", posInserir, "id, ativo_id, conta_id");
      posicoesCount += criadas.length;
      for (const p of criadas) posPorPar.set(`${p.ativo_id}|${p.conta_id}`, String(p.id));
    }
    for (const u of posAtualizar) {
      const { error } = await c.from("inv_posicoes").update(u.campos).eq("id", u.id);
      if (error) avisos.push(`Falha ao atualizar posição: ${error.message}`);
      else posicoesCount++;
    }

    // Posições "fantasma" ENCERRADAS para pares que só aparecem no
    // extrato (ativo totalmente vendido) — dão lar às operações sem
    // distorcer a carteira atual (quantidade 0).
    const paresOperacao = new Set<string>();
    for (const o of operacoesIn) {
      const ativoId = idPorTicker.get(up(o.ticker));
      if (ativoId && o.conta_id && contasValidas.has(o.conta_id)) paresOperacao.add(`${ativoId}|${o.conta_id}`);
    }
    const orfas: Record<string, unknown>[] = [];
    for (const par of paresOperacao) {
      if (posPorPar.has(par)) continue;
      const [ativoId, contaId] = par.split("|");
      // data_compra = 1ª operação do par
      const datas = operacoesIn
        .filter((o) => idPorTicker.get(up(o.ticker)) === ativoId && o.conta_id === contaId)
        .map((o) => String(o.data_operacao)).filter(Boolean).sort();
      orfas.push({
        user_id: userId, ativo_id: ativoId, conta_id: contaId,
        quantidade: 0, preco_custo: 0,
        data_compra: datas[0] ?? new Date().toISOString().split("T")[0],
        status: "ENCERRADA", _par: par,
      });
    }
    if (orfas.length > 0) {
      const semPar = orfas.map(({ _par, ...r }) => r);
      const criadas = await inserirEmLote(c, "inv_posicoes", semPar, "id, ativo_id, conta_id");
      for (const p of criadas) posPorPar.set(`${p.ativo_id}|${p.conta_id}`, String(p.id));
    }

    // ── 3) Operações — dedup por (posicao, tipo, data, qtd, valor) ──
    const posIds = [...posPorPar.values()];
    const opKey = (o: Record<string, unknown>) =>
      `${o.posicao_id}|${o.tipo_operacao}|${o.data_operacao}|${Number(o.quantidade)}|${Number(o.valor_total)}`;
    const opsExistSet = new Set<string>();
    if (posIds.length > 0) {
      // .in() em pedaços para não estourar limite de URL
      for (let i = 0; i < posIds.length; i += 200) {
        const { data } = await c.from("inv_operacoes")
          .select("posicao_id, tipo_operacao, data_operacao, quantidade, valor_total")
          .in("posicao_id", posIds.slice(i, i + 200));
        for (const o of data ?? []) opsExistSet.add(opKey(o));
      }
    }
    const opsInserir: Record<string, unknown>[] = [];
    for (const o of operacoesIn) {
      const ativoId = idPorTicker.get(up(o.ticker));
      if (!ativoId || !o.conta_id || !contasValidas.has(o.conta_id)) continue;
      if (!TIPOS_OPERACAO.includes(String(o.tipo_operacao))) continue;
      const posId = posPorPar.get(`${ativoId}|${o.conta_id}`);
      if (!posId) continue;
      const qtd   = Number(o.quantidade) || 0;
      const preco = Number(o.preco_unitario) || 0;
      const valor = o.valor_total != null ? Number(o.valor_total) : qtd * preco;
      const row = {
        user_id: userId, posicao_id: posId, tipo_operacao: o.tipo_operacao,
        conta_id: o.conta_id, quantidade: qtd, preco_unitario: preco,
        valor_total: valor, data_operacao: String(o.data_operacao),
      };
      const k = opKey(row);
      if (opsExistSet.has(k)) continue;
      opsExistSet.add(k);
      opsInserir.push(row);
    }
    let operacoesCount = 0;
    if (opsInserir.length > 0) {
      const criadas = await inserirEmLote(c, "inv_operacoes", opsInserir);
      operacoesCount = criadas.length;
    }

    // ── 4) Dividendos — dedup por (ativo, data, valor, tipo_ativo) ──
    const { data: tiposDiv } = await c.from("inv_tipos_dividendo").select("id, nome, categoria_id");
    const tipoDivPorNome = new Map<string, { id: string; categoria_id: string | null }>();
    for (const t of tiposDiv ?? []) {
      tipoDivPorNome.set(String(t.nome).toLowerCase(), { id: String(t.id), categoria_id: t.categoria_id ?? null });
    }
    // cria tipos de provento ausentes (sem categoria mapeada)
    const nomesNecessarios = [...new Set(
      dividendosIn.map((d) => (d.tipo_dividendo_nome ?? "").trim()).filter(Boolean),
    )];
    for (const nome of nomesNecessarios) {
      if (tipoDivPorNome.has(nome.toLowerCase())) continue;
      const { data, error } = await c.from("inv_tipos_dividendo")
        .insert({ user_id: userId, nome: nome.slice(0, 40) }).select("id, categoria_id").single();
      if (!error && data) tipoDivPorNome.set(nome.toLowerCase(), { id: String(data.id), categoria_id: data.categoria_id ?? null });
    }

    const { data: divExist } = await c.from("inv_dividendos")
      .select("ativo_id, data_pagamento, valor, tipo_ativo");
    const divKey = (ativoId: string, data: string, valor: number, tipo: string) =>
      `${ativoId}|${data}|${valor}|${tipo}`;
    const divExistSet = new Set<string>();
    for (const d of divExist ?? []) divExistSet.add(divKey(String(d.ativo_id), String(d.data_pagamento), Number(d.valor), String(d.tipo_ativo)));

    const hoje = new Date().toISOString().split("T")[0];
    const divSemExtrato: Record<string, unknown>[] = [];
    const divComExtrato: { div: Record<string, unknown>; categoriaId: string; ticker: string; tipoNome: string }[] = [];
    let semCategoria = 0;
    for (const d of dividendosIn) {
      const ativoId = idPorTicker.get(up(d.ticker));
      const valor = Number(d.valor);
      if (!ativoId || !d.conta_id || !contasValidas.has(d.conta_id)) continue;
      if (!(valor > 0) || !TIPOS_ATIVO.includes(String(d.tipo_ativo))) continue;
      const k = divKey(ativoId, String(d.data_pagamento), valor, String(d.tipo_ativo));
      if (divExistSet.has(k)) continue;
      divExistSet.add(k);
      const tipo = d.tipo_dividendo_nome ? tipoDivPorNome.get(String(d.tipo_dividendo_nome).toLowerCase()) : undefined;
      const base = {
        user_id: userId, ativo_id: ativoId, conta_id: d.conta_id, valor,
        data_pagamento: String(d.data_pagamento), tipo_ativo: d.tipo_ativo,
        tipo_dividendo_id: tipo?.id ?? null,
      };
      if (gerarExtrato && tipo?.categoria_id) {
        divComExtrato.push({ div: base, categoriaId: tipo.categoria_id, ticker: up(d.ticker), tipoNome: String(d.tipo_dividendo_nome) });
      } else {
        if (gerarExtrato && d.tipo_dividendo_nome && !tipo?.categoria_id) semCategoria++;
        divSemExtrato.push(base);
      }
    }

    let dividendosCount = 0;
    let dividendosNoExtrato = 0;
    if (divSemExtrato.length > 0) {
      const criados = await inserirEmLote(c, "inv_dividendos", divSemExtrato, "id");
      dividendosCount += criados.length;
    }
    // Subset com extrato: por linha (precisa vincular a transação criada)
    for (const item of divComExtrato) {
      const { data: div, error: errDiv } = await c.from("inv_dividendos").insert(item.div).select("id").single();
      if (errDiv || !div) { avisos.push(`Falha ao gravar dividendo ${item.ticker}: ${errDiv?.message ?? ""}`); continue; }
      dividendosCount++;
      const futuro = String((item.div as Record<string, unknown>).data_pagamento) > hoje;
      const desc = `${item.ticker} - ${item.tipoNome}`.slice(0, 200);
      const { data: tx, error: errTx } = await c.from("transacoes").insert({
        user_id: userId,
        conta_id: (item.div as Record<string, unknown>).conta_id,
        categoria_id: item.categoriaId,
        data: (item.div as Record<string, unknown>).data_pagamento,
        descricao: desc.length >= 2 ? desc : `Dividendo ${desc}`.slice(0, 200),
        valor: (item.div as Record<string, unknown>).valor,
        tipo: "RECEITA",
        status: futuro ? "PROJECAO" : "PAGO",
        valor_projetado: futuro ? (item.div as Record<string, unknown>).valor : null,
      }).select("id").single();
      if (errTx || !tx) { avisos.push(`Dividendo ${item.ticker} gravado, mas falhou no extrato: ${errTx?.message ?? ""}`); continue; }
      await c.from("inv_dividendos").update({ transacao_extrato_id: tx.id }).eq("id", div.id);
      dividendosNoExtrato++;
    }
    if (semCategoria > 0) {
      avisos.push(`${semCategoria} provento(s) gravados sem extrato: o tipo não tem categoria mapeada (configure em Investimentos › Tipos de provento).`);
    }

    // ── 5) Histórico mensal — snapshot do mês corrente ──────────────
    const mesAno = hoje.slice(0, 7);
    let historicoCount = 0;
    const histVistos = new Set<string>();
    for (const p of posicoesIn) {
      const ativoId = idPorTicker.get(up(p.ticker));
      if (!ativoId || !p.conta_id || !contasValidas.has(p.conta_id)) continue;
      const mes = p.mes_ano && RE_MES_ANO.test(String(p.mes_ano)) ? String(p.mes_ano) : mesAno;
      const par = `${ativoId}|${p.conta_id}|${mes}`;
      if (histVistos.has(par)) continue;
      histVistos.add(par);
      const valorMercado = Number(p.valor_mercado);
      if (!Number.isFinite(valorMercado) || valorMercado < 0) continue;
      const quantidade = Number(p.quantidade) || 0;
      const precoMedio = Number(p.preco_custo) || 0;
      const prev = await snapshotVizinho(c, ativoId, p.conta_id, mes, "anterior");
      const desempenho = calcularDesempenho(valorMercado, quantidade, precoMedio, prev);
      const { error } = await c.from("inv_historico_mensal").upsert({
        user_id: userId, ativo_id: ativoId, conta_id: p.conta_id, mes_ano: mes,
        valor_mercado: valorMercado, quantidade, preco_medio: precoMedio, ...desempenho,
      }, { onConflict: "ativo_id,conta_id,mes_ano" });
      if (error) { avisos.push(`Histórico ${up(p.ticker)}: ${error.message}`); continue; }
      await recalcularSeguinte(c, ativoId, p.conta_id, mes);
      historicoCount++;
    }

    logSuccess("Importação de investimentos concluída", {
      ativosCriados, posicoesCount, operacoesCount, dividendosCount, dividendosNoExtrato,
    });
    return json({
      dados: {
        ativos_criados:        ativosCriados,
        posicoes:              posicoesCount,
        operacoes:             operacoesCount,
        dividendos:            dividendosCount,
        dividendos_no_extrato: dividendosNoExtrato,
        historico:             historicoCount,
        avisos,
      },
    }, 201);
  } catch (e) {
    logError("Importar investimentos", e);
    return erro(`Falha na importação: ${(e as Error).message}`);
  }
}

// ============================================================
// /investimentos/restaurar — restauração a partir do backup JSON
//
// Recria os dados de investimento preservando a estrutura (lotes,
// vínculos operação→posição, etc.). O client envia os dados do backup
// com seus IDs ORIGINAIS + um mapa conta_id e categoria_id (antigo→novo,
// resolvido no restore das contas/categorias). É idempotente: dedup por
// chaves naturais, então re-rodar não duplica.
// ============================================================

async function rotaRestaurar(c: Db, req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const body = await req.json();
  const up = (s: unknown) => String(s ?? "").trim().toUpperCase();
  const arr = (x: unknown) => (Array.isArray(x) ? x : []) as Record<string, unknown>[];
  const contaMap     = (body.conta_map     ?? {}) as Record<string, string>;
  const categoriaMap = (body.categoria_map ?? {}) as Record<string, string>;
  const avisos: string[] = [];

  // contas-alvo válidas (do usuário)
  const contasValidas = new Set<string>();
  const alvos = [...new Set(Object.values(contaMap))];
  if (alvos.length) {
    const { data } = await c.from("contas").select("id").in("id", alvos);
    for (const x of data ?? []) contasValidas.add(String(x.id));
  }
  const novaConta = (old: unknown): string | null => {
    const n = contaMap[String(old)];
    return n && contasValidas.has(n) ? n : null;
  };

  try {
    const out = { tipos: 0, ativos: 0, posicoes: 0, operacoes: 0, dividendos: 0, historico: 0, alocacoes: 0, questionarios: 0, avaliacoes: 0 };

    // ── 1) Tipos de dividendo (por nome) ──
    const tiposIn = arr(body.tipos_dividendo);
    const { data: tiposEx } = await c.from("inv_tipos_dividendo").select("id, nome");
    const tipoPorNome = new Map<string, string>();
    for (const t of tiposEx ?? []) tipoPorNome.set(String(t.nome).toLowerCase(), String(t.id));
    const tipoMap: Record<string, string> = {};
    for (const t of tiposIn) {
      const nome = String(t.nome ?? "").trim();
      if (!nome) continue;
      let id = tipoPorNome.get(nome.toLowerCase());
      if (!id) {
        const catId = t.categoria_id ? (categoriaMap[String(t.categoria_id)] ?? null) : null;
        const { data } = await c.from("inv_tipos_dividendo").insert({ user_id: userId, nome: nome.slice(0, 40), categoria_id: catId }).select("id").single();
        if (data) { id = String(data.id); tipoPorNome.set(nome.toLowerCase(), id); out.tipos++; }
      }
      if (id && t.id) tipoMap[String(t.id)] = id;
    }

    // ── 2) Ativos (por ticker) ──
    const ativosIn = arr(body.ativos);
    const { data: ativosEx } = await c.from("inv_ativos").select("id, ticker");
    const ativoPorTicker = new Map<string, string>();
    for (const a of ativosEx ?? []) ativoPorTicker.set(up(a.ticker), String(a.id));
    const novosAtivos: Record<string, unknown>[] = [];
    for (const a of ativosIn) {
      const ticker = up(a.ticker);
      if (!ticker || ativoPorTicker.has(ticker)) continue;
      if (!TIPOS_ATIVO.includes(String(a.tipo_ativo))) continue;
      novosAtivos.push({
        user_id: userId, ticker, nome: String(a.nome ?? ticker).slice(0, 120), tipo_ativo: a.tipo_ativo,
        moeda: a.moeda ? up(a.moeda).slice(0, 3) : "BRL", descricao: a.descricao ?? null,
        nota_usuario: a.nota_usuario ?? null, questionario_respostas: a.questionario_respostas ?? null,
        rf_subtipo: a.rf_subtipo ?? null, rf_indexador: a.rf_indexador ?? null, rf_taxa: a.rf_taxa ?? null,
        rf_indice: a.rf_indice ?? null, rf_percentual_indice: a.rf_percentual_indice ?? null,
        rf_taxa_fixa: a.rf_taxa_fixa ?? null,
        rf_emissor: a.rf_emissor ?? null, rf_vencimento: a.rf_vencimento ?? null,
        cripto_rendimento_aa: a.cripto_rendimento_aa ?? null,
        cripto_rendimento_inicio: a.cripto_rendimento_inicio ?? null,
        cripto_rendimento_periodicidade: a.cripto_rendimento_periodicidade ?? null,
        rf_garantia_fgc: a.rf_garantia_fgc ?? null, rf_isento_ir: a.rf_isento_ir ?? null,
        fii_categoria: a.fii_categoria ?? null, acoes_subtipo: a.acoes_subtipo ?? null,
        cotacao_automatica: a.cotacao_automatica ?? true,
        logo_url: a.logo_url ?? null, setor: a.setor ?? null,
      });
    }
    if (novosAtivos.length) {
      const cr = await inserirEmLote(c, "inv_ativos", novosAtivos, "id, ticker");
      out.ativos = cr.length;
      for (const x of cr) ativoPorTicker.set(up(x.ticker), String(x.id));
    }
    const ativoMap: Record<string, string> = {};
    for (const a of ativosIn) { const nid = ativoPorTicker.get(up(a.ticker)); if (nid && a.id) ativoMap[String(a.id)] = nid; }

    // ── 3) Posições (dedup por ativo+conta+data+qtd+custo) ──
    const posIn = arr(body.posicoes);
    const { data: posEx } = await c.from("inv_posicoes").select("id, ativo_id, conta_id, data_compra, quantidade, preco_custo");
    const posKey = (av: string, ct: string, dt: unknown, q: unknown, p: unknown) => `${av}|${ct}|${dt}|${Number(q)}|${Number(p)}`;
    const posPorChave = new Map<string, string>();
    for (const p of posEx ?? []) posPorChave.set(posKey(String(p.ativo_id), String(p.conta_id), String(p.data_compra), p.quantidade, p.preco_custo), String(p.id));
    const posMap: Record<string, string> = {};
    const posInserir: Record<string, unknown>[] = [];
    const posRef: { oldId: string; key: string }[] = [];
    for (const p of posIn) {
      const ativoId = ativoMap[String(p.ativo_id)];
      const contaId = novaConta(p.conta_id);
      if (!ativoId || !contaId) { avisos.push("Posição ignorada: ativo/conta não restaurados."); continue; }
      const k = posKey(ativoId, contaId, String(p.data_compra), p.quantidade, p.preco_custo);
      const existId = posPorChave.get(k);
      if (existId) { if (p.id) posMap[String(p.id)] = existId; continue; }
      posInserir.push({
        user_id: userId, ativo_id: ativoId, conta_id: contaId,
        quantidade: Number(p.quantidade) || 0, preco_custo: Number(p.preco_custo) || 0,
        data_compra: String(p.data_compra), status: p.status === "ENCERRADA" ? "ENCERRADA" : "ATIVA",
      });
      posRef.push({ oldId: String(p.id ?? ""), key: k });
    }
    if (posInserir.length) {
      const cr = await inserirEmLote(c, "inv_posicoes", posInserir, "id, ativo_id, conta_id, data_compra, quantidade, preco_custo");
      out.posicoes = cr.length;
      const novaPorChave = new Map<string, string>();
      for (const x of cr) novaPorChave.set(posKey(String(x.ativo_id), String(x.conta_id), String(x.data_compra), x.quantidade, x.preco_custo), String(x.id));
      for (const r of posRef) { const nid = novaPorChave.get(r.key); if (nid) { posPorChave.set(r.key, nid); if (r.oldId) posMap[r.oldId] = nid; } }
    }

    // ── 4) Operações (dedup por posição+tipo+data+qtd+valor) ──
    const opIn = arr(body.operacoes);
    const posIds = [...new Set(Object.values(posMap))];
    const opKey = (pos: string, tp: string, dt: string, q: unknown, v: unknown) => `${pos}|${tp}|${dt}|${Number(q)}|${Number(v)}`;
    const opExistSet = new Set<string>();
    for (let i = 0; i < posIds.length; i += 200) {
      const { data } = await c.from("inv_operacoes").select("posicao_id, tipo_operacao, data_operacao, quantidade, valor_total").in("posicao_id", posIds.slice(i, i + 200));
      for (const o of data ?? []) opExistSet.add(opKey(String(o.posicao_id), String(o.tipo_operacao), String(o.data_operacao), o.quantidade, o.valor_total));
    }
    const opInserir: Record<string, unknown>[] = [];
    for (const o of opIn) {
      const posId = posMap[String(o.posicao_id)];
      const contaId = novaConta(o.conta_id);
      if (!posId || !contaId || !TIPOS_OPERACAO.includes(String(o.tipo_operacao))) continue;
      const k = opKey(posId, String(o.tipo_operacao), String(o.data_operacao), o.quantidade, o.valor_total);
      if (opExistSet.has(k)) continue;
      opExistSet.add(k);
      opInserir.push({
        user_id: userId, posicao_id: posId, tipo_operacao: o.tipo_operacao, conta_id: contaId,
        quantidade: Number(o.quantidade) || 0, preco_unitario: Number(o.preco_unitario) || 0,
        valor_total: Number(o.valor_total) || 0, data_operacao: String(o.data_operacao),
      });
    }
    if (opInserir.length) out.operacoes = (await inserirEmLote(c, "inv_operacoes", opInserir)).length;

    // ── 5) Dividendos (dedup por ativo+data+valor+tipo_ativo) ──
    const divIn = arr(body.dividendos);
    const { data: divEx } = await c.from("inv_dividendos").select("ativo_id, data_pagamento, valor, tipo_ativo");
    const divKey = (av: string, dt: string, v: unknown, ta: string) => `${av}|${dt}|${Number(v)}|${ta}`;
    const divExistSet = new Set<string>();
    for (const d of divEx ?? []) divExistSet.add(divKey(String(d.ativo_id), String(d.data_pagamento), d.valor, String(d.tipo_ativo)));
    const divInserir: Record<string, unknown>[] = [];
    for (const d of divIn) {
      const ativoId = ativoMap[String(d.ativo_id)];
      const contaId = novaConta(d.conta_id);
      const valor = Number(d.valor);
      if (!ativoId || !contaId || !(valor > 0) || !TIPOS_ATIVO.includes(String(d.tipo_ativo))) continue;
      const k = divKey(ativoId, String(d.data_pagamento), valor, String(d.tipo_ativo));
      if (divExistSet.has(k)) continue;
      divExistSet.add(k);
      divInserir.push({
        user_id: userId, ativo_id: ativoId, conta_id: contaId, valor, data_pagamento: String(d.data_pagamento),
        tipo_ativo: d.tipo_ativo, descricao: d.descricao ?? null,
        tipo_dividendo_id: d.tipo_dividendo_id ? (tipoMap[String(d.tipo_dividendo_id)] ?? null) : null,
        valor_por_cota: d.valor_por_cota != null ? Number(d.valor_por_cota) : null,
        // O lançamento do extrato é restaurado em separado (não relinkamos).
      });
    }
    if (divInserir.length) out.dividendos = (await inserirEmLote(c, "inv_dividendos", divInserir, "id")).length;

    // ── 6) Histórico mensal (upsert por ativo+conta+mês) ──
    const histIn = arr(body.historico);
    const histInserir: Record<string, unknown>[] = [];
    const histVistos = new Set<string>();
    for (const h of histIn) {
      const ativoId = ativoMap[String(h.ativo_id)];
      const contaId = novaConta(h.conta_id);
      const mes = String(h.mes_ano ?? "");
      if (!ativoId || !contaId || !RE_MES_ANO.test(mes)) continue;
      const k = `${ativoId}|${contaId}|${mes}`;
      if (histVistos.has(k)) continue;
      histVistos.add(k);
      histInserir.push({
        user_id: userId, ativo_id: ativoId, conta_id: contaId, mes_ano: mes,
        valor_mercado: Number(h.valor_mercado) || 0, quantidade: Number(h.quantidade) || 0,
        preco_medio: Number(h.preco_medio) || 0,
        variacao_percentual: Number(h.variacao_percentual) || 0, rentabilidade_mes: Number(h.rentabilidade_mes) || 0,
      });
    }
    if (histInserir.length) {
      const { error } = await c.from("inv_historico_mensal").upsert(histInserir, { onConflict: "ativo_id,conta_id,mes_ano" });
      if (error) avisos.push(`Histórico: ${error.message}`); else out.historico = histInserir.length;
    }

    // ── 7) Alocações ideais (upsert por tipo) ──
    const alocIn = arr(body.alocacoes).filter((a) => TIPOS_ATIVO.includes(String(a.tipo_ativo)));
    if (alocIn.length) {
      const linhas = alocIn.map((a) => ({ user_id: userId, tipo_ativo: a.tipo_ativo, percentual_ideal: Number(a.percentual_ideal) || 0, updated_at: new Date().toISOString() }));
      const { error } = await c.from("inv_alocacoes_tipo").upsert(linhas, { onConflict: "user_id,tipo_ativo" });
      if (error) avisos.push(`Alocações: ${error.message}`); else out.alocacoes = linhas.length;
    }

    // ── 8) Questionários de avaliação custom (upsert por tipo) ──
    const questIn = arr(body.questionarios).filter((q) =>
      TIPOS_ATIVO.includes(String(q.tipo_ativo)) && !validarQuestionario(q.perguntas, q.pesos));
    if (questIn.length) {
      const linhas = questIn.map((q) => ({
        user_id:     userId,
        tipo_ativo:  q.tipo_ativo,
        perguntas:   q.perguntas,
        pesos:       q.pesos,
        origem:      q.origem === "IA" ? "IA" : "MANUAL",
        ia_provedor: q.origem === "IA" ? (q.ia_provedor ?? null) : null,
        ia_modelo:   q.origem === "IA" ? (q.ia_modelo ?? null) : null,
        ia_gerou_em: q.origem === "IA" ? (q.ia_gerou_em ?? new Date().toISOString()) : null,
        updated_at:  new Date().toISOString(),
      }));
      const { error } = await c.from("inv_questionarios").upsert(linhas, { onConflict: "user_id,tipo_ativo" });
      if (error) avisos.push(`Questionários: ${error.message}`); else out.questionarios = linhas.length;
    }

    // ── 9) Avaliações dos mentores (upsert por ativo, remapeia ativo_id) ──
    const avalIn = arr(body.avaliacoes);
    const avalLinhas: Record<string, unknown>[] = [];
    for (const a of avalIn) {
      const ativoId = ativoMap[String(a.ativo_id)];
      if (!ativoId || !a.consenso || typeof a.consenso !== "object") continue;
      avalLinhas.push({
        user_id:    userId,
        ativo_id:   ativoId,
        nota_final: a.nota_final ?? null,
        consenso:   a.consenso,
        historico:  Array.isArray(a.historico) ? a.historico : null,
        gerado_em:  a.gerado_em ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    if (avalLinhas.length) {
      const { error } = await c.from("inv_avaliacoes").upsert(avalLinhas, { onConflict: "user_id,ativo_id" });
      if (error) avisos.push(`Avaliações: ${error.message}`); else out.avaliacoes = avalLinhas.length;
    }

    logSuccess("Investimentos restaurados", out);
    return json({ dados: { ...out, avisos } }, 201);
  } catch (e) {
    logError("Restaurar investimentos", e);
    return erro(`Falha ao restaurar investimentos: ${(e as Error).message}`);
  }
}

// ============================================================
// /investimentos/dashboard — consolidação por tipo de ativo
// Agrega em JS (volume pequeno por usuário). Valor de mercado usa
// o snapshot mensal mais recente por ativo+conta; se não houver,
// cai para o valor de custo.
// ============================================================

// Mapa "ativo|conta" → valor_mercado, a partir das linhas da view
// vw_inv_ultimo_mercado (já 1 por par). Compartilhado por dashboard e ranking.
function mapaUltimoMercado(
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

type OperacaoQtd = {
  posicao_id: string; tipo_operacao: string; quantidade: number; data_operacao: string;
};
type CheckpointQtd = { data: string; qtd: number };

// Reconstrói a quantidade de cada posição ao longo do tempo.
// `ops` deve vir ordenado por (data_operacao, created_at) ascendente.
function checkpointsQtdPorPosicao(ops: OperacaoQtd[]): Map<string, CheckpointQtd[]> {
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
function qtdNaData(chk: CheckpointQtd[] | undefined, alvo: string): number {
  if (!chk?.length) return 0;
  let val = 0;
  for (const c of chk) {
    if (c.data <= alvo) val = c.qtd;
    else break;
  }
  return val;
}

async function dashboard(c: Db, params: URLSearchParams) {
  logRequest("GET", "/investimentos/dashboard", { params: Object.fromEntries(params) });
  const contaFiltro = params.get("conta_id");

  const [posRes, alocRes, histRes, divRes] = await Promise.all([
    (() => {
      let q = c.from("inv_posicoes")
        .select("id, ativo_id, conta_id, quantidade, valor_custo, status, inv_ativos(tipo_ativo)")
        .eq("status", "ATIVA");
      if (contaFiltro) q = q.eq("conta_id", contaFiltro);
      return q;
    })(),
    c.from("inv_alocacoes_tipo").select("tipo_ativo, percentual_ideal"),
    c.from("vw_inv_ultimo_mercado").select("ativo_id, conta_id, valor_mercado"),
    // tipo_ativo vem do ativo (join), não da cópia desnormalizada — assim a
    // reclassificação de um ativo reflete na hora no gráfico de proventos.
    c.from("inv_dividendos").select("valor, inv_ativos(tipo_ativo)"),
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

  // Agrupa posições por ativo+conta antes de aplicar o snapshot — o
  // snapshot mensal cobre TODAS as posições do par; somar por posição
  // contaria o mesmo valor de mercado mais de uma vez.
  const porAtivoConta = new Map<string, { tipo: string; custo: number }>();
  for (const p of posRes.data ?? []) {
    const tipo = (p.inv_ativos as { tipo_ativo?: string } | null)?.tipo_ativo;
    if (!tipo) continue;
    const k = `${p.ativo_id}|${p.conta_id}`;
    const atual = porAtivoConta.get(k) ?? { tipo, custo: 0 };
    atual.custo += Number(p.valor_custo) || 0;
    porAtivoConta.set(k, atual);
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

async function ranking(c: Db, params: URLSearchParams) {
  logRequest("GET", "/investimentos/ranking", { params: Object.fromEntries(params) });
  const contaFiltro = params.get("conta_id");
  const tipoFiltro  = params.get("tipo_ativo");

  const corte12m = new Date();
  corte12m.setMonth(corte12m.getMonth() - 12);
  const corteISO = corte12m.toISOString().split("T")[0];

  const [posRes, histRes, divRes, opsRes] = await Promise.all([
    (() => {
      let q = c.from("inv_posicoes")
        .select("id, ativo_id, conta_id, quantidade, valor_custo, data_compra, inv_ativos(ticker, nome, tipo_ativo, nota_usuario)")
        .eq("status", "ATIVA");
      if (contaFiltro) q = q.eq("conta_id", contaFiltro);
      return q;
    })(),
    c.from("vw_inv_ultimo_mercado").select("ativo_id, conta_id, valor_mercado"),
    c.from("inv_dividendos").select("ativo_id, valor, data_pagamento, valor_por_cota, tipo_dividendo_id").gte("data_pagamento", corteISO),
    // Operações de TODAS as posições do usuário (inclui ENCERRADAS): a
    // quantidade histórica precisa do ciclo completo para saber quantas cotas
    // havia na data de cada provento. Ordenado por (data, created_at) p/
    // replay determinístico.
    c.from("inv_operacoes")
      .select("posicao_id, tipo_operacao, quantidade, data_operacao")
      .order("data_operacao", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (posRes.error)  { logError("Ranking posicoes", posRes.error);   return erro(posRes.error.message); }
  if (histRes.error) { logError("Ranking historico", histRes.error); return erro(histRes.error.message); }
  if (divRes.error)  { logError("Ranking dividendos", divRes.error); return erro(divRes.error.message); }
  if (opsRes.error)  { logError("Ranking operacoes", opsRes.error);  return erro(opsRes.error.message); }

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
    const pids = posicoesPorAtivo.get(aid) ?? [];
    pids.push(String(p.id));
    posicoesPorAtivo.set(aid, pids);
    const k = `${aid}|${p.conta_id}`;
    const par = custoPorPar.get(k) ?? { ativo: porAtivo.get(aid)!, custo: 0 };
    par.custo += Number(p.valor_custo) || 0;
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

  // ativo_id → Σ dividendo_por_cota nos 12m (do FUNDO, independe da posição)
  const divPorCota = new Map<string, number>();
  for (const g of grupos.values()) {
    let rate = g.rate;
    if (rate == null) {
      // estimativa: valor recebido no dia ÷ cotas que havia na data
      const qtd = (posicoesPorAtivo.get(g.ativo) ?? []).reduce(
        (s, pid) => s + qtdNaData(checkpoints.get(pid), g.data), 0);
      rate = qtd > 0 ? g.valorTotal / qtd : 0;
    }
    if (rate > 0) divPorCota.set(g.ativo, (divPorCota.get(g.ativo) ?? 0) + rate);
  }

  const totalMercado = [...porAtivo.values()].reduce((s, a) => s + a.valor_mercado, 0);

  const ativos = [...porAtivo.values()].map((a) => ({
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
    // Padrão investidor10: dividendo-por-cota 12m do fundo × qtd atual / preço.
    // (DY usa valor de mercado; YoC usa o custo.)
    dividend_yield_pct: a.valor_mercado > 0
      ? Number((((divPorCota.get(a.ativo_id) ?? 0) * a.quantidade / a.valor_mercado) * 100).toFixed(2))
      : 0,
    yield_on_cost_pct:  a.valor_custo > 0
      ? Number((((divPorCota.get(a.ativo_id) ?? 0) * a.quantidade / a.valor_custo) * 100).toFixed(2))
      : 0,
    participacao_pct:   totalMercado > 0 ? Number(((a.valor_mercado / totalMercado) * 100).toFixed(2)) : 0,
  })).sort((x, y) => y.rentabilidade_pct - x.rentabilidade_pct);

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

interface ResultadoBusca {
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

const TD_URL = "https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsinfo.json";

function brapiToken(): string {
  const t = Deno.env.get("BRAPI_TOKEN") ?? "";
  return t ? `&token=${encodeURIComponent(t)}` : "";
}

// Monta uma URL da brapi anexando o token. `path` já inclui a query (todas
// as chamadas têm `?...`), então o token entra como `&token=...`.
function brapiUrl(path: string): string {
  return `https://brapi.dev/api/${path}${brapiToken()}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`fonte externa respondeu ${res.status}`);
  return await res.json();
}

function indexadorDoTesouro(nome: string): string {
  if (/selic/i.test(nome)) return "POS_FIXADO";
  if (/prefixado/i.test(nome)) return "PREFIXADO";
  return "HIBRIDO"; // IPCA+, Renda+, Educa+
}

// Código curto da família p/ compor o ticker legível do Tesouro.
const TESOURO_COD: Record<string, string> = { PREFIXADO: "PRE", POS_FIXADO: "SELIC", HIBRIDO: "IPCA" };
// Ticker determinístico e legível: TD-IPCA-2040, TD-IPCA-JS-2060, TD-PRE-2027,
// TD-SELIC-2029. Mantém o MESMO código entre busca, cadastro manual (frontend
// lib/tesouro.ts) e importação — evita duplicar o ativo. "" se faltar dado.
function tickerTesouro(indexador: string, vencimento: string, semestral: boolean): string {
  const ano = String(vencimento ?? "").slice(0, 4);
  const cod = TESOURO_COD[indexador];
  if (!cod || !/^\d{4}$/.test(ano)) return "";
  const js = semestral && indexador !== "POS_FIXADO" ? "-JS" : "";
  return `TD-${cod}${js}-${ano}`;
}
// Nome amigável do título (espelha FrontEnd/src/lib/tesouro.ts).
const TESOURO_NOME_FAMILIA: Record<string, string> = { PREFIXADO: "Prefixado", POS_FIXADO: "Selic", HIBRIDO: "IPCA+" };
function nomeTesouro(indexador: string, vencimento: string, semestral: boolean): string {
  const fam = TESOURO_NOME_FAMILIA[indexador];
  if (!fam) return "";
  const ano = String(vencimento ?? "").slice(0, 4);
  const js = semestral && indexador !== "POS_FIXADO" ? " com Juros Semestrais" : "";
  return `Tesouro ${fam}${js}${/^\d{4}$/.test(ano) ? ` ${ano}` : ""}`;
}
// Heurística "com juros semestrais" pelo nome (espelha puTesouro/lib tesouro).
function tesouroSemestral(nome: string): boolean {
  const s = String(nome ?? "");
  return /semestr|ntn-?f/i.test(s) || (/ntn-?b/i.test(s) && !/princ/i.test(s));
}

function taxaDoTesouro(nome: string, rate: number): string {
  const pct = `${String(rate).replace(".", ",")}%`;
  if (/selic/i.test(nome)) return `SELIC + ${pct}`;
  if (/prefixado/i.test(nome)) return `${pct} a.a.`;
  return `IPCA + ${pct}`;
}

async function buscaTesouro(q: string): Promise<ResultadoBusca[]> {
  const data = await fetchJson(TD_URL) as {
    response?: { TrsrBdTradgList?: { TrsrBd?: Record<string, unknown> }[] };
  };
  const lista = data.response?.TrsrBdTradgList ?? [];
  const termo = q.toLowerCase();
  const out: ResultadoBusca[] = [];
  for (const item of lista) {
    const bd = item.TrsrBd;
    if (!bd) continue;
    const nome  = String(bd.nm ?? "");
    const preco = Number(bd.untrInvstmtVal ?? 0);
    if (preco <= 0) continue;                       // só títulos disponíveis para compra
    if (!nome.toLowerCase().includes(termo)) continue;
    const rate = Number(bd.anulInvstmtRate ?? 0);
    const indexador  = indexadorDoTesouro(nome);
    const vencimento = String(bd.mtrtyDt ?? "").slice(0, 10) || undefined;
    const legivel    = vencimento ? tickerTesouro(indexador, vencimento, /semestr/i.test(nome)) : "";
    out.push({
      ticker:     legivel ||
        nome.replace(/tesouro\s*/i, "").replace(/[^A-Za-z0-9+]/g, "").toUpperCase().slice(0, 20),
      nome,
      preco,
      moeda:      "BRL",
      emissor:    "Governo Federal",
      taxa:       taxaDoTesouro(nome, rate),
      vencimento,
      indexador,
    });
    if (out.length >= 10) break;
  }
  return out;
}

// Busca de criptomoedas via CoinGecko (grátis, sem chave). /search devolve as
// moedas ordenadas por relevância (market cap); /coins/markets enriquece com o
// preço atual em BRL numa única chamada.
async function buscaCripto(q: string): Promise<ResultadoBusca[]> {
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

async function buscaB3(q: string): Promise<ResultadoBusca[]> {
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

async function buscaExterna(params: URLSearchParams) {
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

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const PTAX_DATA_CORTE = "2021-01-01"; // histórico a partir desta data

function hojeISO(): string { return new Date().toISOString().slice(0, 10); }
function deslocarDias(dataISO: string, n: number): string {
  const dt = new Date(`${dataISO}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const recuarDias = (d: string, n: number) => deslocarDias(d, -n);
const maiorData  = (a: string, b: string) => (a > b ? a : b);
const menorData  = (a: string, b: string) => (a < b ? a : b);

// Busca o PTAX de fechamento (1 por dia útil) na janela [ini, fim] no BCB.
// CotacaoDolarPeriodo já devolve a cotação de fechamento por dia útil.
async function buscarPtaxBCB(
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
async function sincronizarPtax(desde: string, ate: string): Promise<number> {
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

async function ultimaCotacaoPtax(c: Db): Promise<string | null> {
  const { data } = await c.from("cotacoes_ptax")
    .select("data").order("data", { ascending: false }).limit(1).maybeSingle();
  return (data as { data?: string } | null)?.data ?? null;
}

// Garante a tabela sincronizada: backfill desde o corte quando vazia;
// senão re-busca uma janela recente (trailing 3 dias) até hoje — assim a
// cotação de um lançamento feito "hoje" é atualizada quando o PTAX oficial
// daquele dia é publicado.
async function garantirSincronizado(c: Db): Promise<void> {
  const hoje = hojeISO();
  const ultima = await ultimaCotacaoPtax(c);
  if (!ultima) { await sincronizarPtax(PTAX_DATA_CORTE, hoje); return; }
  if (ultima < hoje) {
    await sincronizarPtax(maiorData(PTAX_DATA_CORTE, recuarDias(ultima, 3)), hoje);
  }
}

async function rotaPtax(c: Db, params: URLSearchParams) {
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
async function sincronizarPtaxResposta(c: Db) {
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

const INDICES_DATA_CORTE = "2020-01"; // competência mínima (YYYY-MM)
const RE_COMP = /^\d{4}-(0[1-9]|1[0-2])$/;
const SGS_SERIES = { IPCA: 433, SELIC: 4390, CDI: 4391 } as const;
type IndiceNome = keyof typeof SGS_SERIES;
const INDICES_NOMES = Object.keys(SGS_SERIES) as IndiceNome[];

const maiorComp = (a: string, b: string) => (a > b ? a : b);
function recuarMeses(comp: string, n: number): string {
  let [y, m] = comp.split("-").map(Number);
  m -= n;
  while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Busca uma série mensal do SGS na janela [desdeComp .. ateISO]. O SGS
// devolve [{ data: "DD/MM/YYYY", valor: "0,21" }] com data no 1º do mês.
async function buscarSgsMensal(
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
async function sincronizarIndice(indice: IndiceNome, desdeComp: string, ateISO: string): Promise<number> {
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

async function ultimaCompetencia(c: Db, indice: IndiceNome): Promise<string | null> {
  const { data } = await c.from("indices_economicos")
    .select("competencia").eq("indice", indice)
    .order("competencia", { ascending: false }).limit(1).maybeSingle();
  return (data as { competencia?: string } | null)?.competencia ?? null;
}

// Backfill desde o corte quando vazia; senão re-busca os 2 últimos meses
// (o BCB revisa valores recentes) até o mês corrente, para cada índice.
async function garantirIndicesSincronizados(c: Db): Promise<void> {
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

async function rotaIndices(c: Db, params: URLSearchParams) {
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
async function sincronizarIndicesResposta(c: Db) {
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

const TESOURO_DATA_CORTE = "2020-01"; // competência mínima (YYYY-MM)
// CSV oficial de preços e taxas (todos os títulos, desde 2002).
const TESOURO_CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/" +
  "resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";
// Famílias com marcação a mercado relevante (prefixado e IPCA+); inclui as
// variações "com Juros Semestrais". Tesouro Selic fica de fora (pós-fixado).
const TESOURO_FAMILIAS = ["Tesouro Prefixado", "Tesouro IPCA+"];

// "DD/MM/YYYY" → "YYYY-MM-DD" (ou "" se inválido)
function brDataISO(d: string): string {
  const mm = d.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return mm ? `${mm[3]}-${mm[2]}-${mm[1]}` : "";
}
// "1.234,56" → 1234.56
function brNumero(s: string): number {
  return Number(String(s ?? "").trim().replace(/\./g, "").replace(",", "."));
}

interface CotacaoTesouro {
  tipo_titulo: string; vencimento: string; mes_ano: string;
  data_base: string; pu_venda: number; taxa_venda: number | null;
}

// Baixa e processa o CSV em streaming, guardando por (tipo, vencimento, mês)
// a linha do ÚLTIMO dia útil disponível no mês (fechamento). Filtra pelas
// famílias prefixado/IPCA+ e por Data Base >= corte. Mantém um mapa pequeno.
async function baixarTesouroMensal(desdeComp: string): Promise<CotacaoTesouro[]> {
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
async function sincronizarTesouro(desdeComp: string): Promise<number> {
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

async function rotaTesouro(c: Db, params: URLSearchParams) {
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
async function sincronizarTesouroResposta() {
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

// Feed de preços ATUAIS do Tesouro Direto (B3): um único JSON com todos os
// títulos ofertados e o PU de resgate (marcação a mercado) do dia. É a fonte
// "como nas ações" para o mês corrente — leve e sem o CSV.
const TESOURO_B3_URL =
  "https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsinfo.json";

async function buscarTesouroAtualB3(mesCorrente: string): Promise<CotacaoTesouro[]> {
  const res = await fetch(TESOURO_B3_URL, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Tesouro Direto (B3) respondeu ${res.status}`);
  const j = await res.json() as { response?: { TrsrBdTradgList?: { TrsrBd?: Record<string, unknown> }[] } };
  const out: CotacaoTesouro[] = [];
  for (const it of j.response?.TrsrBdTradgList ?? []) {
    const bd = it.TrsrBd ?? {};
    const nm = String(bd.nm ?? "").trim();
    if (!TESOURO_FAMILIAS.some((f) => nm.startsWith(f))) continue;
    const venc = String(bd.mtrtyDt ?? "").slice(0, 10);             // "YYYY-MM-DD..."
    if (!RE_DATA.test(venc)) continue;
    const pu = Number(bd.untrRedVal);                               // PU de resgate (venda)
    if (!Number.isFinite(pu) || pu <= 0) continue;
    const taxa = Number(bd.anulRedRate);
    out.push({
      tipo_titulo: nm.replace(/\s+\d{4}$/, "").trim(),              // remove o ano → casa com o CSV
      vencimento: venc, mes_ano: mesCorrente, data_base: hojeISO(),
      pu_venda: pu, taxa_venda: Number.isFinite(taxa) ? taxa : null,
    });
  }
  return out;
}

// Garante o PU do MÊS CORRENTE para os vencimentos informados, revalidando a
// cada COTACAO_STALE_MS (igual ao cache de cotações de ações). Demand-driven:
// só busca o feed da B3 quando algum vencimento está faltando/stale.
async function garantirTesouroMesCorrente(c: Db, vencimentos: string[], mesCorrente: string): Promise<void> {
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
function familiaTesouro(indexador: string | null): string | null {
  if (indexador === "PREFIXADO") return "Tesouro Prefixado";
  if (indexador === "HIBRIDO")   return "Tesouro IPCA+";
  return null;
}

// Carrega o PU (venda) dos vencimentos informados → mapa
// `tipo_titulo|venc` → [{ mes, pu }] ordenado por mês asc.
type SerieMtM = Map<string, { mes: string; pu: number }[]>;
async function carregarTesouroMtM(c: Db, vencimentos: string[]): Promise<SerieMtM> {
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
function puTesouro(
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
type SerieIndice = Map<string, number>;

// Carrega as séries mensais reais de CDI e IPCA (arqvalor.indices_economicos,
// SGS 4391/433) a partir de `desde`. Garante a sincronização com o BCB antes
// de ler (idempotente). Usadas para acumular a rentabilidade de RF mês a mês
// com a taxa que de fato vigorou — em vez de uma única taxa atual.
async function carregarIndicesMensais(c: Db, desde: string): Promise<{ cdi: SerieIndice; ipca: SerieIndice }> {
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
function valorRFAcumulado(
  custo: number, dataCompra: string, dataRef: Date,
  indexador: string | null, taxa: string | null,
  cdiSerie: SerieIndice, ipcaSerie: SerieIndice,
  cdiAtualAa: number, ipcaAtualAa: number,
): number {
  const t = String(taxa ?? "");
  // Prefixado / sem indexador: taxa fixa composta nos dias corridos.
  if (indexador === "PREFIXADO" || !indexador) {
    return valorRF(custo, dataCompra, dataRef, primeiraTaxa(t));
  }

  const ini = new Date(`${String(dataCompra).slice(0, 10)}T00:00:00Z`).getTime();
  const fim = dataRef.getTime();
  if (!Number.isFinite(ini) || fim <= ini) return custo;

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
function valorRFPosicoes(
  posicoes: { valor_custo: number; data_compra: string }[],
  tipo: string, indexador: string | null, venc: string | null, nome: string,
  mes: string, dataRef: Date,
  taxa: string | null, cdiSerie: SerieIndice, ipcaSerie: SerieIndice,
  cdiAtualAa: number, ipcaAtualAa: number, mtm: SerieMtM,
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
    return soma + valorRFAcumulado(p.valor_custo, p.data_compra, ref, indexador, taxa, cdiSerie, ipcaSerie, cdiAtualAa, ipcaAtualAa);
  }, 0);
}
