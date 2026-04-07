// ============================================================
// Arquiteto de Valor — Edge Function: categorias v6
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, extrairId,
         verificarExistencia, validarCor, camposParaAtualizar } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id = extrairId(req, "categorias");
  const m  = req.method;
  const c  = db(req);

  console.log("PATH:", new URL(req.url).pathname);
  console.log("ID extraído:", id);
  console.log("MÉTODO:", m);
  
  try {
    if (m === "GET"    && !id) return await listar(c, new URL(req.url).searchParams);
    if (m === "GET"    &&  id) return await buscarPorId(c, id);
    if (m === "POST")          return await criar(c, await req.json(), userId);
    if (m === "PUT"    &&  id) return await editar(c, id, await req.json());
    if (m === "DELETE" &&  id) return await excluir(c, id);
    return erro("Rota não encontrada", 404);
  } catch (e) { console.error(e); return erro("Erro interno", 500); }
});

async function listar(c: ReturnType<typeof db>, params: URLSearchParams) {
  const hierarquia = params.get("hierarquia") === "true";
  const apenasRaiz = params.get("apenas_pai") === "true";
  const ativa      = params.get("ativa");

  let q = c.from("categorias").select("*").order("descricao");
  if (apenasRaiz) q = q.is("id_pai", null);
  if (ativa !== null) q = q.eq("ativa", ativa === "true");

  const { data, error } = await q;
  if (error) return erro(error.message);

  if (hierarquia) {
    const pais   = (data ?? []).filter((x: Record<string,unknown>) => !x.id_pai);
    const filhos = (data ?? []).filter((x: Record<string,unknown>) =>  x.id_pai);
    return json({ dados: pais.map((p: Record<string,unknown>) => ({
      ...p,
      subcategorias: filhos.filter((f: Record<string,unknown>) => f.id_pai === p.id)
    }))});
  }
  return json({ dados: data });
}

async function buscarPorId(c: ReturnType<typeof db>, id: string) {
  const { data, error } = await c.from("categorias").select("*").eq("id", id).single();
  if (error) return erro("Categoria não encontrada", 404);
  if (!data.id_pai) {
    const { data: subs } = await c.from("categorias").select("*").eq("id_pai", id).order("descricao");
    return json({ ...data, subcategorias: subs ?? [] });
  }
  return json(data);
}

async function criar(c: ReturnType<typeof db>, body: Record<string, unknown>, userId: string) {
  // Validações de negócio
  if (!body.descricao || String(body.descricao).length < 1) return erro("descricao é obrigatória");
  if (String(body.descricao).length > 50)                   return erro("descricao deve ter no máximo 50 caracteres");
  const corInvalida = validarCor(body.cor);
  if (corInvalida) return corInvalida;

  // Regra de hierarquia — máximo 2 níveis
  if (body.id_pai) {
    const { data: pai, error: ep } = await c.from("categorias").select("id,id_pai").eq("id", body.id_pai).single();
    if (ep) return erro("Categoria pai não encontrada", 404);
    if (pai.id_pai) return erro("Máximo 2 níveis de hierarquia");
  }

  const { data, error } = await c.from("categorias").insert({
    user_id: userId, descricao: body.descricao,
    id_pai: body.id_pai ?? null, icone: body.icone ?? null,
    cor: body.cor ?? null, ativa: true,
  }).select().single();

  if (error) {
    if (error.message.includes("uq_categorias_user_pai_descricao"))
      return erro("Já existe uma categoria com este nome neste nível", 409);
    return erro(error.message);
  }
  return json(data, 201);
}

async function editar(c: ReturnType<typeof db>, id: string, body: Record<string, unknown>) {
  const naoEncontrada = await verificarExistencia(c, "categorias", id, "Categoria não encontrada");
  if (naoEncontrada) return naoEncontrada;

  // Validações de negócio
  if (body.descricao !== undefined && (String(body.descricao).length < 1 || String(body.descricao).length > 50))
    return erro("descricao deve ter entre 1 e 50 caracteres");
  const corInvalida = validarCor(body.cor);
  if (corInvalida) return corInvalida;

  const campos = camposParaAtualizar(body, ["descricao","icone","cor","ativa"]);
  const { data, error } = await c.from("categorias").update(campos).eq("id", id).select().single();
  if (error) return erro(error.message);
  return json(data);
}

async function excluir(c: ReturnType<typeof db>, id: string) {
  const naoEncontrada = await verificarExistencia(c, "categorias", id, "Categoria não encontrada");
  if (naoEncontrada) return naoEncontrada;

  const { error } = await c.from("categorias").delete().eq("id", id);
  if (error) {
    if (error.message.includes("CATEGORIA_COM_FILHOS"))
      return erro("Esta categoria possui subcategorias. Exclua as subcategorias primeiro.", 409);
    if (error.message.includes("CATEGORIA_EM_USO"))
      return erro("Esta categoria possui lançamentos vinculados e não pode ser excluída.", 409);
    return erro(error.message);
  }
  return json({ mensagem: "Categoria excluída com sucesso" });
}