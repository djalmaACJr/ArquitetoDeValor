// ============================================================
// Arquiteto de Valor — Edge Function: categorias v7
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, extrairId,
         verificarExistencia, validarCor, camposParaAtualizar, corsPreFlight } from "../_shared/utils.ts";
import { logDebug, logError, logInfo, logRequest, logResponse, logSuccess, logWarn } from "../_shared/logger.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id = extrairId(req, "categorias");
  const m  = req.method;
  const c  = db(req);
  const url = new URL(req.url);

  try {
    if (m === "GET"    && !id) return await listar(c, url.searchParams);
    if (m === "GET"    &&  id) return await buscarPorId(c, id);
    if (m === "POST")          return await criar(c, await req.json(), userId);
    if (m === "PUT"    &&  id) return await editar(c, id, await req.json());
    if (m === "DELETE" &&  id) return await excluir(c, id);
    return erro("Rota não encontrada", 404);
  } catch (e) { 
    logError("Handler principal", e);
    return erro("Erro interno", 500); 
  }
});

async function listar(c: ReturnType<typeof db>, params: URLSearchParams) {
  logRequest("GET", "/categorias", { params: Object.fromEntries(params) });
  
  const hierarquia = params.get("hierarquia") === "true";
  const apenasRaiz = params.get("apenas_pai")  === "true";
  const ativa      = params.get("ativa");

  let q = c.from("categorias").select("*").order("descricao");
  if (apenasRaiz)     q = q.is("id_pai", null);
  if (ativa !== null) q = q.eq("ativa", ativa === "true");

  const { data, error } = await q;
  if (error) {
    logError("Listar categorias", error);
    return erro(error.message);
  }

  if (hierarquia) {
    const pais   = (data ?? []).filter((x: Record<string,unknown>) => !x.id_pai);
    const filhos = (data ?? []).filter((x: Record<string,unknown>) =>  x.id_pai);
    const result = { dados: pais.map((p: Record<string,unknown>) => ({
      ...p,
      subcategorias: filhos.filter((f: Record<string,unknown>) => f.id_pai === p.id),
    }))};
    logResponse(200, { count: pais.length });
    return json(result);
  }
  
  logResponse(200, { count: data?.length });
  return json({ dados: data });
}

async function buscarPorId(c: ReturnType<typeof db>, id: string) {
  logRequest("GET", `/categorias/${id}`);
  
  const { data, error } = await c.from("categorias").select("*").eq("id", id).single();
  if (error) {
    logResponse(404);
    return erro("Categoria não encontrada", 404);
  }
  
  if (!data.id_pai) {
    const { data: subs } = await c.from("categorias").select("*").eq("id_pai", id).order("descricao");
    const result = { ...data, subcategorias: subs ?? [] };
    logResponse(200, { id, hasSubs: true });
    return json(result);
  }
  
  logResponse(200, { id, isSubcategory: true });
  return json(data);
}

async function criar(c: ReturnType<typeof db>, body: Record<string, unknown>, userId: string) {
  logRequest("POST", "/categorias", body);
  
  if (!body.descricao || String(body.descricao).length < 1) {
    logResponse(400, { erro: "descricao é obrigatória" });
    return erro("descricao é obrigatória", 400);
  }
  if (String(body.descricao).length > 20) {
    logResponse(400, { erro: "descricao deve ter no máximo 20 caracteres" });
    return erro("descricao deve ter no máximo 20 caracteres", 400);
  }
  
  const corInvalida = validarCor(body.cor);
  if (corInvalida) return corInvalida;

  // Regra de hierarquia — máximo 2 níveis
  if (body.id_pai) {
    const { data: pai, error: ep } = await c.from("categorias")
      .select("id,id_pai").eq("id", body.id_pai).single();
    if (ep) {
      logResponse(404, { erro: "Categoria pai não encontrada" });
      return erro("Categoria pai não encontrada", 404);
    }
    if (pai.id_pai) {
      logResponse(422, { erro: "Máximo 2 níveis de hierarquia" });
      return erro("Máximo 2 níveis de hierarquia");
    }
  }

  const { data, error } = await c.from("categorias").insert({
    user_id: userId, descricao: body.descricao,
    id_pai: body.id_pai ?? null, icone: body.icone ?? null,
    cor: body.cor ?? null, ativa: true,
  }).select().single();

  if (error) {
    logError("Criar categoria", error);
    if (error.message.includes("uq_categorias_user_pai_descricao")) {
      logResponse(409, { erro: "Categoria já existe neste nível" });
      return erro("Já existe uma categoria com este nome neste nível", 409);
    }
    return erro(error.message);
  }
  
  logSuccess("Categoria criada", { id: data.id, descricao: data.descricao });
  logResponse(201, data);
  return json(data, 201);
}

async function editar(c: ReturnType<typeof db>, id: string, body: Record<string, unknown>) {
  logRequest("PUT", `/categorias/${id}`, body);

  // Buscar a categoria atual para checar `protegida`
  const { data: atual, error: eAtual } = await c.from("categorias")
    .select("protegida").eq("id", id).single();
  if (eAtual || !atual) {
    logResponse(404, { erro: "Categoria não encontrada" });
    return erro("Categoria não encontrada", 404);
  }

  // Categoria protegida: somente `cor` e `icone` podem ser alterados.
  if (atual.protegida === true) {
    const camposBloqueados = ["descricao", "ativa", "id_pai"];
    const tentaAlterarBloqueado = camposBloqueados.some(k => body[k] !== undefined);
    if (tentaAlterarBloqueado) {
      logResponse(400, { erro: "Categoria protegida: apenas cor e ícone podem ser alterados" });
      return erro("Categoria protegida: apenas cor e ícone podem ser alterados", 400);
    }
  }

  if (body.descricao !== undefined &&
     (String(body.descricao).length < 1 || String(body.descricao).length > 20)) {
    logResponse(400, { erro: "descricao deve ter entre 1 e 20 caracteres" });
    return erro("descricao deve ter entre 1 e 20 caracteres", 400);
  }

  const corInvalida = validarCor(body.cor);
  if (corInvalida) return corInvalida;

  const campos = camposParaAtualizar(body, ["descricao","icone","cor","ativa"]);
  const { data, error } = await c.from("categorias").update(campos).eq("id", id).select().single();
  
  if (error) {
    logError("Editar categoria", error);
    if (error.message.includes("CATEGORIA_PROTEGIDA")) {
      logResponse(400, { erro: "Apenas cor e ícone podem ser alterados" });
      return erro("Apenas cor e ícone podem ser alterados nesta categoria.", 400);
    }
    return erro(error.message);
  }
  
  logSuccess("Categoria atualizada", { id });
  logResponse(200, data);
  return json(data);
}

async function excluir(c: ReturnType<typeof db>, id: string) {
  logRequest("DELETE", `/categorias/${id}`);

  // Buscar a categoria atual para checar `protegida` e existência
  const { data: atual, error: eAtual } = await c.from("categorias")
    .select("protegida").eq("id", id).single();
  if (eAtual || !atual) {
    logResponse(404, { erro: "Categoria não encontrada" });
    return erro("Categoria não encontrada", 404);
  }

  if (atual.protegida === true) {
    logResponse(400, { erro: "Categoria protegida não pode ser excluída" });
    return erro("Categoria protegida não pode ser excluída", 400);
  }

  const { error } = await c.from("categorias").delete().eq("id", id);
  if (error) {
    logError("Excluir categoria", error);
    if (error.message.includes("CATEGORIA_PROTEGIDA")) {
      logResponse(400, { erro: "Categoria protegida não pode ser excluída" });
      return erro("Esta categoria não pode ser excluída.", 400);
    }
    if (error.message.includes("CATEGORIA_COM_FILHOS")) {
      logResponse(409, { erro: "Categoria possui subcategorias" });
      return erro("Esta categoria possui subcategorias. Exclua as subcategorias primeiro.", 409);
    }
    if (error.message.includes("CATEGORIA_EM_USO")) {
      logResponse(409, { erro: "Categoria possui lançamentos" });
      return erro("Esta categoria possui lançamentos vinculados e não pode ser excluída.", 409);
    }
    return erro(error.message);
  }
  
  logSuccess("Categoria excluída", { id });
  logResponse(200, { mensagem: "Excluída com sucesso" });
  return json({ mensagem: "Categoria excluída com sucesso" });
}