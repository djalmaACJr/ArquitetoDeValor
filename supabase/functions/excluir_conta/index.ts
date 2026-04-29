// ============================================================
// Arquiteto de Valor — Edge Function: excluir_conta v1
// POST /excluir_conta
// Exclui todos os dados do usuário e remove a conta de autenticação.
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json, erro, autenticar, corsPreFlight, CORS_HEADERS } from "../_shared/utils.ts";
import { logError, logInfo } from "../_shared/logger.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  if (req.method !== "POST") return erro("Método não permitido", 405);

  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  try {
    // Cliente admin (service_role) para chamadas privilegiadas
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "arqvalor" } }
    );

    // 1. Apaga todos os dados do usuário via função SECURITY DEFINER
    const { error: errDados } = await admin.rpc("fn_excluir_dados_usuario", {
      p_user_id: userId,
    });

    if (errDados) {
      logError("excluir_conta: fn_excluir_dados_usuario", errDados);
      return erro("Falha ao excluir dados do usuário: " + errDados.message, 500);
    }

    logInfo("excluir_conta: dados excluídos", { userId });

    // 2. Remove a conta de autenticação
    const authAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: errAuth } = await authAdmin.auth.admin.deleteUser(userId);

    if (errAuth) {
      logError("excluir_conta: deleteUser", errAuth);
      return erro("Dados excluídos, mas falha ao remover conta de autenticação: " + errAuth.message, 500);
    }

    logInfo("excluir_conta: conta removida", { userId });

    return json({ dados: { mensagem: "Conta excluída com sucesso." } }, 200);
  } catch (e) {
    logError("excluir_conta: erro inesperado", e);
    return erro("Erro interno", 500);
  }
});
