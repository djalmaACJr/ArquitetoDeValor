// ============================================================
// Arquiteto de Valor — Edge Function: objetivos v1
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  json, erro, db, autenticar, extrairId,
  verificarExistencia, validarCor, camposParaAtualizar, corsPreFlight,
} from "../_shared/utils.ts";
import {
  logError, logRequest, logResponse, logSuccess,
} from "../_shared/logger.ts";

const TIPOS_OBJETIVO  = ["SONHO", "OBJETIVO", "PROJETO", "CRESCIMENTO"];
const STATUS_OBJETIVO = ["EM_PROGRESSO", "ATINGIDO", "CANCELADO"];
const FREQUENCIAS     = ["DIARIA", "SEMANAL", "MENSAL", "ANUAL"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();

  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const url    = new URL(req.url);
  const partes = url.pathname.split("/").filter(Boolean);
  const id     = extrairId(req, "objetivos");
  const m      = req.method;
  const c      = db(req);

  // Detecta rota especial /objetivos/sincronizar-progresso
  const idxRec        = partes.indexOf("objetivos");
  const proxSeg       = idxRec >= 0 ? (partes[idxRec + 1] ?? null) : null;
  const isSincronizar = proxSeg === "sincronizar-progresso";

  try {
    if (m === "GET"    && !id)          return await listar(c, url.searchParams);
    if (m === "GET"    &&  id)          return await buscarPorId(c, id);
    if (m === "POST"   && isSincronizar) return await sincronizar(c, userId);
    if (m === "POST"   && !id)          return await criar(c, await req.json(), userId);
    if (m === "PUT"    &&  id)          return await editar(c, id, await req.json());
    if (m === "DELETE" &&  id)          return await excluir(c, id);
    return erro("Rota não encontrada", 404);
  } catch (e) {
    logError("Handler principal", e);
    return erro("Erro interno", 500);
  }
});

// ── GET /objetivos ──────────────────────────────────────────

async function listar(c: ReturnType<typeof db>, params: URLSearchParams) {
  logRequest("GET", "/objetivos", { params: Object.fromEntries(params) });

  let q = c.from("vw_objetivos_detalhes")
    .select("*")
    .order("criado_em", { ascending: false });

  const tipo   = params.get("tipo");
  const status = params.get("status");
  const ativo  = params.get("ativo");

  if (tipo   && TIPOS_OBJETIVO.includes(tipo))    q = q.eq("tipo", tipo);
  if (status && STATUS_OBJETIVO.includes(status)) q = q.eq("status", status);
  if (ativo === "false")  q = q.eq("ativo", false);
  if (ativo === "true")   q = q.eq("ativo", true);

  const { data, error } = await q;
  if (error) { logError("Listar objetivos", error); return erro(error.message); }

  logResponse(200, { count: data?.length });
  return json({ dados: data });
}

// ── GET /objetivos/:id ──────────────────────────────────────

async function buscarPorId(c: ReturnType<typeof db>, id: string) {
  logRequest("GET", `/objetivos/${id}`);

  const [objRes, progRes] = await Promise.all([
    c.from("vw_objetivos_detalhes").select("*").eq("id", id).single(),
    c.from("objetivos_progresso")
      .select("data_snapshot, valor_atingido, percentual")
      .eq("objetivo_id", id)
      .order("data_snapshot", { ascending: true }),
  ]);

  if (objRes.error || !objRes.data) {
    logResponse(404);
    return erro("Objetivo não encontrado", 404);
  }

  logResponse(200, { id });
  return json({ dados: { ...objRes.data, progresso: progRes.data ?? [] } });
}

// ── POST /objetivos ─────────────────────────────────────────

async function criar(c: ReturnType<typeof db>, body: Record<string, unknown>, userId: string) {
  logRequest("POST", "/objetivos", body);

  // Campos obrigatórios
  if (!body.tipo || !body.nome || body.valor_meta == null || !body.data_inicio || !body.data_fim) {
    return erro("Campos obrigatórios: tipo, nome, valor_meta, data_inicio, data_fim");
  }

  const tipo = String(body.tipo);
  if (!TIPOS_OBJETIVO.includes(tipo)) {
    return erro(`tipo inválido: ${TIPOS_OBJETIVO.join(" | ")}`);
  }

  const nome = String(body.nome).trim();
  if (nome.length < 1 || nome.length > 100) {
    return erro("nome deve ter entre 1 e 100 caracteres");
  }

  const valorMeta = Number(body.valor_meta);
  if (!Number.isFinite(valorMeta) || valorMeta <= 0) {
    return erro("valor_meta deve ser > 0");
  }

  const dataInicio = String(body.data_inicio);
  const dataFim    = String(body.data_fim);
  if (dataFim < dataInicio) {
    return erro("data_fim deve ser >= data_inicio");
  }

  // Validações específicas por tipo
  if (tipo === "SONHO") {
    const contasSonho = Array.isArray(body.contas_sonho) ? body.contas_sonho : [];
    if (contasSonho.length === 0 && !body.conta_id) {
      return erro("contas_sonho (array não vazio) é obrigatório para tipo SONHO");
    }
  }
  if (tipo === "OBJETIVO") {
    const cats = Array.isArray(body.categorias_objetivo) ? body.categorias_objetivo : [];
    if (cats.length === 0 && !body.categoria_id) {
      return erro("categorias_objetivo (array não vazio) é obrigatório para tipo OBJETIVO");
    }
  }
  if (tipo === "PROJETO") {
    const contas = body.contas_projeto;
    if (!Array.isArray(contas) || contas.length === 0) {
      return erro("contas_projeto (array não vazio) é obrigatório para tipo PROJETO");
    }
  }
  if (tipo === "CRESCIMENTO") {
    const cats = Array.isArray(body.categorias_objetivo) ? body.categorias_objetivo : [];
    if (cats.length === 0 && !body.categoria_id) {
      return erro("categorias_objetivo (array não vazio) é obrigatório para tipo CRESCIMENTO");
    }
  }

  const corErr = validarCor(body.cor);
  if (corErr) return corErr;

  if (body.frequencia && !FREQUENCIAS.includes(String(body.frequencia))) {
    return erro(`frequencia inválida: ${FREQUENCIAS.join(" | ")}`);
  }

  // Validar posse da conta (SONHO)
  if (body.conta_id) {
    const { data: conta } = await c.from("contas").select("id").eq("id", body.conta_id).single();
    if (!conta) return erro("Conta não encontrada", 404);
  }

  // Validar posse da categoria (OBJETIVO / PROJETO)
  if (body.categoria_id) {
    const { data: cat } = await c.from("categorias").select("id").eq("id", body.categoria_id).single();
    if (!cat) return erro("Categoria não encontrada", 404);
  }

  const { data, error } = await c.from("objetivos").insert({
    user_id:        userId,
    tipo,
    nome,
    descricao:      body.descricao      ?? null,
    icone:          body.icone          ?? "target",
    cor:            body.cor            ?? "#3b82f6",
    valor_meta:     valorMeta,
    data_inicio:    dataInicio,
    data_fim:       dataFim,
    conta_id:             body.conta_id       ?? null,
    categoria_id:         body.categoria_id   ?? null,
    frequencia:           body.frequencia     ?? null,
    contas_sonho:         Array.isArray(body.contas_sonho)        ? body.contas_sonho        : [],
    contas_projeto:       Array.isArray(body.contas_projeto)      ? body.contas_projeto      : [],
    categorias_objetivo:  Array.isArray(body.categorias_objetivo) ? body.categorias_objetivo : [],
    ativo: true,
  }).select().single();

  if (error) { logError("Criar objetivo", error); return erro(error.message); }

  logSuccess("Objetivo criado", { id: data.id, tipo: data.tipo });
  logResponse(201, data);
  return json({ dados: data }, 201);
}

// ── PUT /objetivos/:id ──────────────────────────────────────

async function editar(c: ReturnType<typeof db>, id: string, body: Record<string, unknown>) {
  logRequest("PUT", `/objetivos/${id}`, body);

  const naoEncontrado = await verificarExistencia(c, "objetivos", id, "Objetivo não encontrado");
  if (naoEncontrado) return naoEncontrado;

  // Busca atual para histórico de revisões
  const { data: atual } = await c
    .from("objetivos")
    .select("valor_meta, revisoes")
    .eq("id", id)
    .single();

  // Validações pontuais
  if (body.nome !== undefined) {
    const nome = String(body.nome).trim();
    if (nome.length < 1 || nome.length > 100) return erro("nome deve ter entre 1 e 100 caracteres");
  }
  if (body.valor_meta !== undefined) {
    const v = Number(body.valor_meta);
    if (!Number.isFinite(v) || v <= 0) return erro("valor_meta deve ser > 0");
  }
  if (body.data_inicio !== undefined || body.data_fim !== undefined) {
    const ini = String(body.data_inicio ?? "");
    const fim = String(body.data_fim    ?? "");
    if (ini && fim && fim < ini) return erro("data_fim deve ser >= data_inicio");
  }
  const corErr = validarCor(body.cor);
  if (corErr) return corErr;

  if (body.frequencia && !FREQUENCIAS.includes(String(body.frequencia))) {
    return erro(`frequencia inválida: ${FREQUENCIAS.join(" | ")}`);
  }

  // Histórico de revisões quando o valor_meta muda
  let revisoes = (atual?.revisoes ?? []) as unknown[];
  if (body.valor_meta !== undefined && Number(body.valor_meta) !== atual?.valor_meta) {
    revisoes = [...revisoes, {
      data:                  new Date().toISOString().split("T")[0],
      valor_meta_anterior:   atual?.valor_meta,
      motivo:                body.motivo_revisao ?? "Revisão de meta",
    }];
  }

  const campos = camposParaAtualizar(body, [
    "nome", "descricao", "icone", "cor", "ativo",
    "valor_meta", "data_inicio", "data_fim",
    "conta_id", "categoria_id", "frequencia",
    "contas_sonho", "contas_projeto", "categorias_objetivo",
  ]);
  campos.revisoes = revisoes;

  const { data, error } = await c
    .from("objetivos")
    .update(campos)
    .eq("id", id)
    .select()
    .single();

  if (error) { logError("Editar objetivo", error); return erro(error.message); }

  logSuccess("Objetivo atualizado", { id });
  logResponse(200, data);
  return json({ dados: data });
}

// ── DELETE /objetivos/:id ───────────────────────────────────
// Exclusão lógica: marca ativo=false (trigger seta status=CANCELADO)

async function excluir(c: ReturnType<typeof db>, id: string) {
  logRequest("DELETE", `/objetivos/${id}`);

  const naoEncontrado = await verificarExistencia(c, "objetivos", id, "Objetivo não encontrado");
  if (naoEncontrado) return naoEncontrado;

  const { error } = await c
    .from("objetivos")
    .update({ ativo: false })
    .eq("id", id);

  if (error) { logError("Cancelar objetivo", error); return erro(error.message); }

  logSuccess("Objetivo cancelado", { id });
  logResponse(200, { mensagem: "Objetivo cancelado" });
  return json({ mensagem: "Objetivo cancelado com sucesso" });
}

// ── POST /objetivos/sincronizar-progresso ───────────────────

async function sincronizar(c: ReturnType<typeof db>, userId: string) {
  logRequest("POST", "/objetivos/sincronizar-progresso");

  const { data, error } = await c.rpc("fn_sincronizar_progresso_objetivo", {
    p_user_id: userId,
  });

  if (error) { logError("Sincronizar progresso", error); return erro(error.message); }

  const count = Array.isArray(data) ? (data[0]?.objetivos_atualizados ?? 0) : 0;
  logSuccess("Progresso sincronizado", { count });
  logResponse(200, { count });
  return json({ dados: { sincronizados: count } });
}
