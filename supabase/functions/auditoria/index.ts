// ============================================================
// Arquiteto de Valor — Edge Function: auditoria v1
//
// GET /auditoria — consulta a trilha de auditoria (arqvalor.trilha_auditoria,
// ver migrations 20260806000004 e 20260820000001). A proteção de dado real é
// a RLS da tabela: usuário comum só enxerga a própria trilha
// (trilha_auditoria_select_own); admin (usuarios.admin = true) enxerga a de
// TODOS (trilha_auditoria_admin_select) — este handler só formata a resposta
// e aplica os filtros da querystring, mesmo padrão de
// investimentos/admin.ts::rotaCronExecucoes.
//
// Filtros aceitos (todos opcionais): tabela, operacao (INSERT|UPDATE|DELETE),
// registro_id, user_id (só tem efeito prático para quem é admin — RLS já
// restringe o resto), desde/ate (YYYY-MM-DD, sobre alterado_em), limit (<=500),
// conta_id (casa contra dados_novos.conta_id OU dados_antigos.conta_id — útil
// pro card "Últimas alterações" do Dashboard filtrar por conta mesmo incluindo
// DELETEs, onde a linha já não existe mais em transacoes pra filtrar por lá).
//
// GET/PUT /auditoria/config — período de retenção da trilha (dias). A
// tabela config_auditoria (20260820000002) só libera SELECT/UPDATE pra
// admin via RLS — este handler também só formata a resposta; um não-admin
// recebe { dados: null } no GET e um erro de "nenhuma linha afetada" no PUT
// (a RLS filtrou o UPDATE inteiro, mesma lógica de qualquer mutação
// escopada por RLS que não encontra a linha). A purga de fato roda 1x/dia
// via pg_cron (fn_purgar_trilha_auditoria), não por chamada desta rota.
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, corsPreFlight, registrarOrigem } from "../_shared/utils.ts";
import { logError, logRequest, logResponse } from "../_shared/logger.ts";

const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 500;
const RETENCAO_MIN_DIAS = 30;
const RETENCAO_MAX_DIAS = 3650;

Deno.serve(async (req: Request) => {
  registrarOrigem(req);
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = await autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const c = db(req);
  const url = new URL(req.url);
  const ehConfig = url.pathname.replace(/\/+$/, "").endsWith("/config");

  if (ehConfig) {
    if (req.method === "GET")  return await obterConfig(c, userId);
    if (req.method === "PUT")  return await atualizarConfig(c, req, userId);
    return erro("Método não permitido", 405);
  }

  if (req.method !== "GET") return erro("Método não permitido", 405);
  return await listarTrilha(c, req, userId);
});

async function listarTrilha(c: ReturnType<typeof db>, req: Request, userId: string) {
  const params = new URL(req.url).searchParams;

  const tabela        = params.get("tabela");
  const operacao       = params.get("operacao");
  const registroId     = params.get("registro_id");
  const filtroUserId   = params.get("user_id");
  const contaId         = params.get("conta_id");
  const desde          = params.get("desde");
  const ate            = params.get("ate");
  const limitParam     = Number(params.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, LIMITE_MAXIMO) : LIMITE_PADRAO;

  logRequest("GET", "/auditoria", { userId, tabela, operacao, filtroUserId, contaId, desde, ate, limit });

  if (operacao && !["INSERT", "UPDATE", "DELETE"].includes(operacao)) {
    return erro("operacao inválida: use INSERT, UPDATE ou DELETE");
  }

  let q = c.from("trilha_auditoria")
    .select("id, user_id, tabela, operacao, registro_id, dados_antigos, dados_novos, alterado_em, usuarios(email, nome)")
    .order("alterado_em", { ascending: false })
    .limit(limit);

  if (tabela)       q = q.eq("tabela", tabela);
  if (operacao)     q = q.eq("operacao", operacao);
  if (registroId)   q = q.eq("registro_id", registroId);
  if (filtroUserId) q = q.eq("user_id", filtroUserId);
  if (desde)        q = q.gte("alterado_em", desde);
  if (ate)          q = q.lte("alterado_em", `${ate}T23:59:59.999`);
  // Casa contra QUALQUER um dos dois snapshots — um DELETE não tem
  // dados_novos, um INSERT não tem dados_antigos.
  if (contaId)      q = q.or(`dados_novos->>conta_id.eq.${contaId},dados_antigos->>conta_id.eq.${contaId}`);

  const { data, error } = await q;
  if (error) { logError("Listar trilha de auditoria", error); return erro("Erro ao buscar auditoria"); }

  logResponse(200, { count: data?.length });
  return json({ dados: data ?? [] });
}

async function obterConfig(c: ReturnType<typeof db>, userId: string) {
  logRequest("GET", "/auditoria/config", { userId });

  const { data, error } = await c.from("config_auditoria")
    .select("retencao_dias, atualizado_em, atualizado_por")
    .eq("id", 1)
    .maybeSingle();
  if (error) { logError("Obter config de auditoria", error); return erro("Erro ao buscar configuração"); }

  // RLS filtra a linha inteira pra quem não é admin — null é o resultado
  // esperado nesse caso, não um erro (mesma lógica de cron_execucoes vazio).
  logResponse(200, data);
  return json({ dados: data ?? null });
}

async function atualizarConfig(c: ReturnType<typeof db>, req: Request, userId: string) {
  const body = await req.json().catch(() => ({}));
  logRequest("PUT", "/auditoria/config", { userId, body });

  const dias = Number(body.retencao_dias);
  if (!Number.isInteger(dias) || dias < RETENCAO_MIN_DIAS || dias > RETENCAO_MAX_DIAS) {
    return erro(`retencao_dias deve ser um inteiro entre ${RETENCAO_MIN_DIAS} e ${RETENCAO_MAX_DIAS}`);
  }

  const { data, error } = await c.from("config_auditoria")
    .update({ retencao_dias: dias, atualizado_em: new Date().toISOString(), atualizado_por: userId })
    .eq("id", 1)
    .select("retencao_dias, atualizado_em, atualizado_por")
    .maybeSingle();
  if (error) { logError("Atualizar config de auditoria", error); return erro("Erro ao salvar configuração"); }
  // 0 linhas afetadas = RLS bloqueou (quem chamou não é admin) — a policy
  // de UPDATE já garante isso, aqui só traduzimos pra uma mensagem clara.
  if (!data) return erro("Sem permissão para alterar a retenção da auditoria", 403);

  logResponse(200, data);
  return json({ dados: data });
}
