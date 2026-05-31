-- ============================================================
-- Migration: Hardening contra warnings do Supabase Security Advisor
--
-- Endereça os 23 warnings retornados em 2026-05-31. Não há ERROR
-- — todos são preventivos e melhoram defesa em profundidade.
--
-- Mudanças:
--
-- 1. SET search_path nas funções que ainda não tinham. Previne
--    "search_path hijacking" quando a função é SECURITY DEFINER OU
--    é chamada de contexto onde o atacante controla o search_path.
--
-- 2. REVOKE EXECUTE FROM PUBLIC, anon, authenticated nas funções
--    SECURITY DEFINER que servem apenas a triggers internos do
--    schema `auth` (não devem ser expostas como RPC pública).
--    Atenção: NÃO revoga de fn_excluir_dados_usuario porque ela
--    valida internamente (p_user_id = auth.uid()) e é a forma do
--    usuário apagar a própria conta.
--
-- 3. DROP da duplicata `public.fn_saldos_contas_ate_data` — a
--    versão correta vive em arqvalor (com SECURITY INVOKER + check
--    de auth.uid). A cópia em public era um resíduo de migração
--    antiga e não tem search_path setado.
--
-- Idempotente. ALTER FUNCTION ... SET é equivalente a sobrescrever
-- o config existente, então pode rodar várias vezes sem problema.
-- ============================================================

-- ── 1. SET search_path nas funções faltantes ─────────────────
ALTER FUNCTION arqvalor.fn_antecipar_parcelas(UUID, UUID)
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_bloquear_exclusao_categoria()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_bloquear_exclusao_conta()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_cascata_inativar_subcategorias()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_remover_usuario()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_saldo_conta_ate(UUID, TIMESTAMPTZ)
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_set_atualizado_em()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_sincronizar_usuario()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_trg_proteger_categoria()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_validar_isolamento_usuario()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.trg_fn_bloquear_exclusao_transf_avulsa()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.trg_fn_proteger_categoria()
    SET search_path = arqvalor, pg_catalog;

-- ── 2. REVOKE EXECUTE das funções SECURITY DEFINER internas ─
--
-- Estas funções existem apenas para serem chamadas por triggers
-- no schema `auth` (sincronização e remoção de usuários). Não
-- têm porquê estar acessíveis como RPC pelo cliente.
--
-- O role `service_role` (usado pela Edge Function quando precisa
-- de privilégios admin) continua podendo executar.
REVOKE EXECUTE ON FUNCTION arqvalor.fn_sincronizar_usuario()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_sincronizar_usuario_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_remover_usuario()            FROM PUBLIC, anon, authenticated;

-- public.rls_auto_enable é utility de bootstrap — só admins
-- devem invocar.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- ── 3. DROP duplicata public.fn_saldos_contas_ate_data ──────
--
-- A versão correta (em arqvalor, SECURITY INVOKER, valida
-- auth.uid()) já existe e é a chamada pelas RPCs do frontend.
-- A cópia em public é resíduo de migração antiga; remover
-- elimina o warning de search_path e a confusão de "qual é qual".
DROP FUNCTION IF EXISTS public.fn_saldos_contas_ate_data(UUID, DATE);

-- ── 4. Confirmação final ───────────────────────────────────
-- Após rodar esta migration, `select * from supabase.advisors`
-- (ou o painel Security Advisor) deve retornar zero warnings das
-- categorias `function_search_path_mutable`,
-- `anon_security_definer_function_executable` e
-- `authenticated_security_definer_function_executable` para
-- as funções acima.
--
-- O warning `auth_leaked_password_protection` permanece — é uma
-- configuração no Dashboard (Auth → Policies → Password security
-- → "Check passwords against HaveIBeenPwned"). Ligar é opcional
-- mas recomendado.
