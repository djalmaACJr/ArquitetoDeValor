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
export async function rotaCronExecucoes(c: Db, m: string, userId: string) {
  if (m !== "GET") return erro("Método não permitido", 405);
  logRequest("GET", "/investimentos/cron-execucoes", { userId });

  const { data, error } = await c.from("cron_execucoes")
    .select("id, job_nome, status, resumo, erro, duracao_ms, executado_em")
    .order("executado_em", { ascending: false })
    .limit(100);
  if (error) { logError("cron-execucoes", error); return erro("Erro ao buscar execuções"); }

  return json({ dados: data ?? [] });
}
