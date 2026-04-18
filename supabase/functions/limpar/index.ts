// supabase/functions/limpar/index.ts
// Arquiteto de Valor — Edge Function: limpar v5
import { json, erro, db, autenticar, corsPreFlight } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  if (req.method !== "DELETE") return erro("Método não permitido", 405);

  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const params   = new URL(req.url).searchParams;
  const entidade = params.get("entidade");
  const c = db(req);

  try {
    if (!entidade)                 return await limparTudo(c, userId);
    if (entidade === "transacoes") return await limparTransacoes(c, userId);
    if (entidade === "categorias") return await limparCategorias(c, userId);
    if (entidade === "contas")     return await limparContas(c, userId);
    return erro("entidade inválida: use transacoes | categorias | contas", 422);
  } catch (e) {
    console.error("[limpar] Erro:", e);
    return erro("Erro interno", 500);
  }
});

async function limparTransacoes(c: ReturnType<typeof db>, userId: string) {
  // Excluir todas as transações direto no banco (bypassa trigger de endpoint /transacoes)
  const { count, error } = await c
    .from("transacoes")
    .delete({ count: "exact" })
    .eq("user_id", userId);
  if (error) { console.error("[limpar] transacoes:", error.message); return erro(error.message); }
  return json({ ok: true, excluidos: count ?? 0, entidade: "transacoes" });
}

async function limparCategorias(c: ReturnType<typeof db>, userId: string) {
  // Subcategorias primeiro (filhas), depois pais — evita FK constraint
  await c.from("categorias")
    .delete()
    .eq("user_id", userId)
    .eq("protegida", false)
    .not("id_pai", "is", null);

  const { count, error } = await c
    .from("categorias")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("protegida", false);
  if (error) { console.error("[limpar] categorias:", error.message); return erro(error.message); }
  return json({ ok: true, excluidos: count ?? 0, entidade: "categorias" });
}

async function limparContas(c: ReturnType<typeof db>, userId: string) {
  const { count, error } = await c
    .from("contas")
    .delete({ count: "exact" })
    .eq("user_id", userId);
  if (error) { console.error("[limpar] contas:", error.message); return erro(error.message); }
  return json({ ok: true, excluidos: count ?? 0, entidade: "contas" });
}

async function limparTudo(c: ReturnType<typeof db>, userId: string) {
  const logs: { entidade: string; excluidos: number }[] = [];

  // 1. Todas as transações (direto no banco, bypassa trigger de endpoint)
  const { count: cntTx } = await c
    .from("transacoes").delete({ count: "exact" }).eq("user_id", userId);
  logs.push({ entidade: "transacoes", excluidos: cntTx ?? 0 });

  // 2. Categorias: filhas primeiro, depois pais
  await c.from("categorias").delete()
    .eq("user_id", userId).eq("protegida", false).not("id_pai", "is", null);
  const { count: cntCat } = await c
    .from("categorias").delete({ count: "exact" })
    .eq("user_id", userId).eq("protegida", false);
  logs.push({ entidade: "categorias", excluidos: cntCat ?? 0 });

  // 3. Contas
  const { count: cntConta } = await c
    .from("contas").delete({ count: "exact" }).eq("user_id", userId);
  logs.push({ entidade: "contas", excluidos: cntConta ?? 0 });

  return json({ ok: true, logs });
}
