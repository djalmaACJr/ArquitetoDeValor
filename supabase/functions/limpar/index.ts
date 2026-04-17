// supabase/functions/limpar/index.ts
// Arquiteto de Valor — Edge Function: limpar v1
// DELETE /limpar?entidade=transacoes|categorias|contas
// Limpa dados do usuário autenticado em ordem segura
import { json, erro, db, autenticar, corsPreFlight } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  if (req.method !== "DELETE") return erro("Método não permitido", 405);

  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const params   = new URL(req.url).searchParams;
  const entidade = params.get("entidade"); // transacoes | categorias | contas

  const c = db(req);

  try {
    // ── Limpar TUDO (sem ?entidade) ──────────────────────────────
    if (!entidade) {
      return await limparTudo(c, userId);
    }

    // ── Limpar entidade específica ───────────────────────────────
    switch (entidade) {
      case "transacoes":  return await limparTransacoes(c, userId);
      case "categorias":  return await limparCategorias(c, userId);
      case "contas":      return await limparContas(c, userId);
      default:            return erro("entidade inválida: use transacoes | categorias | contas", 422);
    }
  } catch (e) {
    console.error("[limpar] Erro inesperado:", e);
    return erro("Erro interno", 500);
  }
});

// ── Limpar tudo em ordem (transações → transferências → categorias → contas) ──
async function limparTudo(c: ReturnType<typeof db>, userId: string) {
  const logs: { entidade: string; excluidos: number }[] = [];

  // 1. Transferências (par das transações)
  const { count: cntTrf } = await c
    .from("transferencias")
    .delete({ count: "exact" })
    .eq("user_id", userId);
  logs.push({ entidade: "transferencias", excluidos: cntTrf ?? 0 });

  // 2. Transações
  const { count: cntTx } = await c
    .from("transacoes")
    .delete({ count: "exact" })
    .eq("user_id", userId);
  logs.push({ entidade: "transacoes", excluidos: cntTx ?? 0 });

  // 3. Categorias não protegidas
  const { count: cntCat } = await c
    .from("categorias")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("protegida", false);
  logs.push({ entidade: "categorias", excluidos: cntCat ?? 0 });

  // 4. Contas
  const { count: cntConta } = await c
    .from("contas")
    .delete({ count: "exact" })
    .eq("user_id", userId);
  logs.push({ entidade: "contas", excluidos: cntConta ?? 0 });

  return json({ ok: true, logs });
}

// ── Limpar só transações (+ transferências) ──────────────────────
async function limparTransacoes(c: ReturnType<typeof db>, userId: string) {
  await c.from("transferencias").delete().eq("user_id", userId);

  const { count, error } = await c
    .from("transacoes")
    .delete({ count: "exact" })
    .eq("user_id", userId);

  if (error) return erro(error.message);
  return json({ ok: true, excluidos: count ?? 0, entidade: "transacoes" });
}

// ── Limpar só categorias (não protegidas) ────────────────────────
async function limparCategorias(c: ReturnType<typeof db>, userId: string) {
  const { count, error } = await c
    .from("categorias")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("protegida", false);

  if (error) return erro(error.message);
  return json({ ok: true, excluidos: count ?? 0, entidade: "categorias", obs: "Categorias protegidas mantidas" });
}

// ── Limpar só contas ─────────────────────────────────────────────
async function limparContas(c: ReturnType<typeof db>, userId: string) {
  const { count, error } = await c
    .from("contas")
    .delete({ count: "exact" })
    .eq("user_id", userId);

  if (error) return erro(error.message);
  return json({ ok: true, excluidos: count ?? 0, entidade: "contas" });
}
