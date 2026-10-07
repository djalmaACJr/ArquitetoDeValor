// supabase/functions/investimentos/admin.ts
// Rotas admin-only. A proteção de verdade é a RLS de cron_execucoes (só
// libera SELECT pra usuarios.admin = true) — este handler só formata a
// resposta; um usuário não-admin recebe { dados: [] } (RLS filtra tudo),
// nunca um 403 que revelasse a existência de dados.
import { json, erro } from "../_shared/utils.ts";
import { logRequest, logError } from "../_shared/logger.ts";
import { Db } from "./shared.ts";

// GET /investimentos/cron-execucoes — histórico das últimas execuções dos
// 4 cron jobs do sistema (dividendos-diario, dividendos-br-diario,
// snapshot-diario, rendimento-cripto-diario). Ver cron_execucoes na
// migration 20260806000002 — nasceu da auditoria 2026-08-06 (cron ficou
// 19 dias falhando sem nenhum sinal visível em lugar nenhum).
export async function rotaCronExecucoes(c: Db, m: string, userId: string, params = new URLSearchParams()) {
  // DELETE /investimentos/cron-execucoes?dias=30[&simular=true] — limpeza manual do histórico
  // (botão "Limpar logs antigos" em /admin/crons). Quem manda é a RPC fn_limpar_cron_execucoes:
  // exige usuarios.admin e RECUSA período < 30 dias (regra "nunca apagar menos de 1 mês" no
  // banco, não só na tela). simular=true só conta quantas seriam apagadas.
  if (m === "DELETE") {
    const dias = Number(params.get("dias") ?? "30");
    if (!Number.isInteger(dias) || dias < 30) {
      return erro("dias deve ser um inteiro ≥ 30 — não é possível limpar execuções com menos de 30 dias", 400);
    }
    const simular = params.get("simular") === "true";
    logRequest("DELETE", "/investimentos/cron-execucoes", { userId, dias, simular });
    const { data, error } = await c.rpc("fn_limpar_cron_execucoes", { p_dias: dias, p_simular: simular });
    if (error) {
      logError("cron-execucoes (limpar)", error);
      if (/ACESSO_NEGADO/.test(error.message)) return erro("Acesso restrito a administradores", 403);
      if (/PERIODO_MINIMO/.test(error.message)) return erro(error.message, 400);
      return erro("Erro ao limpar execuções");
    }
    return json({ dados: { removidas: Number(data) || 0, simulado: simular, dias } });
  }
  if (m !== "GET") return erro("Método não permitido", 405);
  logRequest("GET", "/investimentos/cron-execucoes", { userId });

  const { data, error } = await c.from("cron_execucoes")
    .select("id, job_nome, status, resumo, erro, duracao_ms, executado_em")
    .order("executado_em", { ascending: false })
    .limit(100);
  if (error) { logError("cron-execucoes", error); return erro("Erro ao buscar execuções"); }

  return json({ dados: data ?? [] });
}
