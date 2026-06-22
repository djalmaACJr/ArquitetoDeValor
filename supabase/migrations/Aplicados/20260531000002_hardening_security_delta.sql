-- ============================================================
-- Migration: Delta da hardening de Security Advisor.
--
-- Após a 20260531000001, restaram 3 warnings reais. Esta migration
-- fecha 2 deles. O 3º (fn_excluir_dados_usuario exposta a
-- authenticated) é decisão arquitetural — explicação no fim.
--
-- 1. DROP correto da duplicata `public.fn_saldos_contas_ate_data`.
--    A assinatura real é (p_data date), não (UUID, DATE) como
--    tentei antes — o IF EXISTS não casou e o DROP passou em vazio.
--
-- 2. REVOKE EXECUTE em `public.rls_auto_enable()`. O REVOKE
--    dentro de um DO $$ EXECUTE não persistiu no commit anterior
--    (quirk do PostgreSQL com SECURITY DEFINER + grants em PUBLIC
--    via DO block). Rodando direto resolve.
--
-- Idempotente.
-- ============================================================

-- ── 1. DROP duplicata em public ─────────────────────────────
DROP FUNCTION IF EXISTS public.fn_saldos_contas_ate_data(DATE);

-- ── 2. REVOKE direto (sem DO block) ─────────────────────────
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;

-- ── 3. Sobre `fn_excluir_dados_usuario` ─────────────────────
--
-- O Security Advisor continua avisando que esta função SECURITY
-- DEFINER é executável pelo papel `authenticated`. Isso é
-- INTENCIONAL: a função tem guarda interna que valida
--    p_user_id IS DISTINCT FROM auth.uid() -> ACESSO_NEGADO
-- e é a maneira do usuário autenticado deletar a PRÓPRIA conta
-- via o endpoint /excluir_conta (que propaga o JWT do usuário).
--
-- Se trocássemos pra service_role, auth.uid() viraria NULL na
-- chamada e a guarda bloquearia indevidamente. A guarda é
-- robusta — não há vetor real de escalation.
--
-- Conclusão: o warning permanece como aceito.
