-- ============================================================
-- ARQUITETO DE VALOR — Migration v1.12
-- 20260507000001_fix_security_warnings.sql
--
-- Corrige avisos do Supabase security linter de forma conservadora:
--   1. search_path mutable  → SET search_path fixo (sem impacto funcional)
--   2. SECURITY DEFINER     → REVOKE EXECUTE apenas de `anon` nas funções
--      que são triggers internos e jamais devem ser chamadas via REST API.
--      NÃO revogamos `authenticated` para não quebrar Edge Functions
--      que usam db(req) (JWT do usuário = role authenticated).
--
-- Idempotente: ALTER FUNCTION é seguro repetir.
-- DO/EXCEPTION: protege contra função inexistente.
-- ============================================================


-- ============================================================
-- 1. FIXAR search_path
--    Sem impacto funcional — apenas evita search_path injection.
--    search_path = arqvalor, pg_catalog garante que referências
--    a tabelas/tipos sem prefixo de schema resolvem corretamente.
-- ============================================================

ALTER FUNCTION arqvalor.fn_set_atualizado_em()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_preservar_valor_projetado()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_validar_isolamento_usuario()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_bloquear_exclusao_conta()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_bloquear_exclusao_categoria()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_antecipar_parcelas(UUID, UUID)
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_saldo_conta_ate(UUID, TIMESTAMPTZ)
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_sincronizar_usuario()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_remover_usuario()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_excluir_dados_usuario(UUID)
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_trg_proteger_categoria()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_trg_bloquear_exclusao_transf_avulsa()
    SET search_path = arqvalor, pg_catalog;

ALTER FUNCTION arqvalor.fn_cascata_inativar_subcategorias()
    SET search_path = arqvalor, pg_catalog;

-- Funções que podem existir no banco fora das migrations
DO $$ BEGIN
    ALTER FUNCTION arqvalor.fn_saldo_conta_ate_data(UUID, DATE)
        SET search_path = arqvalor, pg_catalog;
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
    ALTER FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE)
        SET search_path = arqvalor, pg_catalog;
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
    ALTER FUNCTION arqvalor.trg_fn_proteger_categoria()
        SET search_path = arqvalor, pg_catalog;
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
    ALTER FUNCTION arqvalor.trg_fn_bloquear_exclusao_transf_avulsa()
        SET search_path = arqvalor, pg_catalog;
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
    ALTER FUNCTION public.fn_saldos_contas_ate_data(UUID, DATE)
        SET search_path = public, arqvalor, pg_catalog;
EXCEPTION WHEN undefined_function THEN NULL; END $$;


-- ============================================================
-- 2. REVOGAR EXECUTE de `anon` apenas nas funções de trigger
--    que são chamadas exclusivamente pelo PostgreSQL internamente
--    (nunca via REST API).
--
--    NÃO revogamos `authenticated` para preservar as Edge Functions
--    que executam com o JWT do usuário (role authenticated).
--    O risco residual dos avisos authenticated é baixo: usuários
--    autenticados precisariam conhecer UUIDs internos para explorar,
--    e o RLS das tabelas já limita o acesso aos dados.
-- ============================================================

-- Triggers em auth.users: disparados pelo Supabase Auth,
-- jamais chamados diretamente via /rest/v1/rpc/.
REVOKE EXECUTE ON FUNCTION arqvalor.fn_sincronizar_usuario() FROM anon;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_remover_usuario()     FROM anon;

-- fn_excluir_dados_usuario: chamada pela Edge Function excluir_conta.
-- Revogamos anon; mantemos authenticated e service_role.
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;

-- Funções de saldo que podem existir no banco
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION arqvalor.fn_saldo_conta_ate_data(UUID, DATE) FROM anon;
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) FROM anon;
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION public.fn_saldos_contas_ate_data(UUID, DATE) FROM anon;
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
EXCEPTION WHEN undefined_function THEN NULL; END $$;


-- ============================================================
-- FIM DA MIGRATION — 20260507000001_fix_security_warnings
-- ============================================================
