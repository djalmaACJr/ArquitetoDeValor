-- ============================================================
-- Performance Advisor do Supabase — itens seguros (sem mudança de
-- comportamento, só forma de avaliar a mesma condição)
-- ============================================================
-- 1) auth_rls_initplan (9 ocorrências): `auth.uid()` numa policy RLS é
--    reavaliado LINHA A LINHA pelo planner por padrão. Envolver em
--    `(select auth.uid())` deixa o Postgres tratar como um valor estável
--    (InitPlan, calculado 1x por statement) — mesmo resultado, mais rápido
--    em tabelas grandes. Nenhuma mudança de quem vê o quê.
-- 2) multiple_permissive_policies em trilha_auditoria: as 2 policies de
--    SELECT (dono vê a própria linha OU admin vê tudo) SEMPRE são
--    avaliadas as duas em todo SELECT (Postgres roda todas as policies
--    permissivas e faz OR). Consolidar numa só com OR explícito é
--    logicamente idêntico e mais barato.
-- 3) unindexed_foreign_keys: config_auditoria.atualizado_por não tinha
--    índice cobrindo a FK — irrelevante hoje (tabela tem 1 linha), mas
--    sem custo pra adicionar.
--
-- Idempotente (DROP POLICY IF EXISTS + CREATE POLICY, CREATE INDEX IF NOT
-- EXISTS).
-- ============================================================

-- ── idempotency_keys ──────────────────────────────────────────
DROP POLICY IF EXISTS idempotency_keys_user ON arqvalor.idempotency_keys;
CREATE POLICY idempotency_keys_user ON arqvalor.idempotency_keys
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- ── inv_indicadores ───────────────────────────────────────────
DROP POLICY IF EXISTS inv_indicadores_select ON arqvalor.inv_indicadores;
CREATE POLICY inv_indicadores_select ON arqvalor.inv_indicadores
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS inv_indicadores_insert ON arqvalor.inv_indicadores;
CREATE POLICY inv_indicadores_insert ON arqvalor.inv_indicadores
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS inv_indicadores_delete ON arqvalor.inv_indicadores;
CREATE POLICY inv_indicadores_delete ON arqvalor.inv_indicadores
  FOR DELETE USING (user_id = (select auth.uid()));

-- ── cron_execucoes ────────────────────────────────────────────
DROP POLICY IF EXISTS cron_execucoes_admin_select ON arqvalor.cron_execucoes;
CREATE POLICY cron_execucoes_admin_select ON arqvalor.cron_execucoes
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM arqvalor.usuarios u
    WHERE u.id = (select auth.uid()) AND u.admin = true
  ));

-- ── config_auditoria ──────────────────────────────────────────
DROP POLICY IF EXISTS config_auditoria_admin_select ON arqvalor.config_auditoria;
CREATE POLICY config_auditoria_admin_select ON arqvalor.config_auditoria
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM arqvalor.usuarios u WHERE u.id = (select auth.uid()) AND u.admin = true));

DROP POLICY IF EXISTS config_auditoria_admin_update ON arqvalor.config_auditoria;
CREATE POLICY config_auditoria_admin_update ON arqvalor.config_auditoria
  FOR UPDATE
  USING     (EXISTS (SELECT 1 FROM arqvalor.usuarios u WHERE u.id = (select auth.uid()) AND u.admin = true))
  WITH CHECK(EXISTS (SELECT 1 FROM arqvalor.usuarios u WHERE u.id = (select auth.uid()) AND u.admin = true));

CREATE INDEX IF NOT EXISTS idx_config_auditoria_atualizado_por
  ON arqvalor.config_auditoria(atualizado_por);

-- ── trilha_auditoria: consolida as 2 policies de SELECT numa só ──
DROP POLICY IF EXISTS trilha_auditoria_select_own   ON arqvalor.trilha_auditoria;
DROP POLICY IF EXISTS trilha_auditoria_admin_select ON arqvalor.trilha_auditoria;
CREATE POLICY trilha_auditoria_select ON arqvalor.trilha_auditoria
  FOR SELECT
  USING (
    user_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM arqvalor.usuarios u WHERE u.id = (select auth.uid()) AND u.admin = true)
  );
