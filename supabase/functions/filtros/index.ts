// ============================================================
// Arquiteto de Valor — Edge Function: filtros v1
// CRUD de filtros salvos pelo usuário por página da aplicação
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  json, erro, db, autenticar, extrairId, corsPreFlight,
} from "../_shared/utils.ts";
import { logError, logRequest, logResponse, logSuccess } from "../_shared/logger.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id  = extrairId(req, "filtros");
  const m   = req.method;
  const c   = db(req);
  const url = new URL(req.url);

  try {
    if (m === "GET"    && !id) return await listar(c, userId, url.searchParams);
    if (m === "POST")          return await criar(c, await req.json(), userId);
    if (m === "DELETE" &&  id) return await excluir(c, id, userId);
    return erro("Rota não encontrada", 404);
  } catch (e) {
    logError("Handler principal", e);
    return erro("Erro interno", 500);
  }
});

async function listar(
  c: ReturnType<typeof db>,
  userId: string,
  params: URLSearchParams,
) {
  const pagina = params.get("pagina");
  logRequest("GET", "/filtros", { pagina, userId });

  let q = c
    .from("filtros_salvos")
    .select("*")
    .eq("user_id", userId)
    .order("criado_em", { ascending: true });

  if (pagina) q = q.eq("pagina", pagina);

  const { data, error } = await q;
  if (error) { logError("Listar filtros", error); return erro(error.message); }

  logResponse(200, { count: data?.length });
  return json({ dados: data });
}

async function criar(
  c: ReturnType<typeof db>,
  body: Record<string, unknown>,
  userId: string,
) {
  const { pagina, nome, dados } = body;
  logRequest("POST", "/filtros", { pagina, nome });

  if (!pagina || typeof pagina !== "string" || !pagina.trim())
    return erro("pagina é obrigatória");
  if (!nome || typeof nome !== "string" || !nome.trim())
    return erro("nome é obrigatório");
  if (String(nome).length > 50)
    return erro("nome deve ter no máximo 50 caracteres");

  const { data, error } = await c
    .from("filtros_salvos")
    .insert({
      user_id: userId,
      pagina:  String(pagina).trim(),
      nome:    String(nome).trim(),
      dados:   dados ?? {},
    })
    .select()
    .single();

  if (error) { logError("Criar filtro", error); return erro(error.message); }

  logSuccess("Filtro criado", { id: data.id, pagina, nome });
  logResponse(201, data);
  return json(data, 201);
}

async function excluir(
  c: ReturnType<typeof db>,
  id: string,
  userId: string,
) {
  logRequest("DELETE", `/filtros/${id}`);

  // Garante que o filtro pertence ao usuário (reforça além do RLS)
  const { error } = await c
    .from("filtros_salvos")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) { logError("Excluir filtro", error); return erro(error.message); }

  logSuccess("Filtro excluído", { id });
  logResponse(200, { mensagem: "Excluído com sucesso" });
  return json({ mensagem: "Filtro excluído com sucesso" });
}
