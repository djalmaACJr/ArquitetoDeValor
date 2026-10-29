-- ============================================================
-- Hardening dos advisors do Supabase (release 7.4.1)
--
-- Corrige 3 itens do `supabase db advisors --linked`:
--   1. function_search_path_mutable — fn_default_criado_por
--   2. auth_rls_initplan            — pol_objetivos_agregado_insert
--   3. unindexed_foreign_keys       — 5 FKs sem índice de cobertura
--
-- Fora de escopo (decisão registrada): extension_in_public (pg_net,
-- ver 20260709000001), unused_index, multiple_permissive_policies
-- (desenho dos agregados) e SECURITY DEFINER expostos (usados pelo app).
-- Idempotente.
-- ============================================================

-- 1. search_path fixo (a função só mexe em NEW; não resolve nenhum objeto
--    de schema, então '' é seguro).
CREATE OR REPLACE FUNCTION arqvalor.fn_default_criado_por()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.criado_por IS NULL THEN NEW.criado_por := NEW.user_id; END IF;
  RETURN NEW;
END; $$;

-- 2. auth.uid() avaliado uma vez por query (initplan), não por linha.
DROP POLICY IF EXISTS pol_objetivos_agregado_insert ON arqvalor.objetivos;
CREATE POLICY pol_objetivos_agregado_insert ON arqvalor.objetivos
  FOR INSERT WITH CHECK (
    arqvalor.fn_agregado_pode_ver_objetivo(user_id, tipo, conta_id, contas_sonho, contas_projeto, true)
    AND criado_por = (SELECT auth.uid())
  );

-- 3. Índices nas FKs (acelera o ON DELETE SET NULL de usuarios e joins por
--    "lançado por"; agregados_contas.conta_id acelera o CASCADE de contas e
--    a checagem de escopo por conta).
CREATE INDEX IF NOT EXISTS idx_transacoes_criado_por       ON arqvalor.transacoes (criado_por);
CREATE INDEX IF NOT EXISTS idx_objetivos_criado_por        ON arqvalor.objetivos (criado_por);
CREATE INDEX IF NOT EXISTS idx_inv_operacoes_criado_por    ON arqvalor.inv_operacoes (criado_por);
CREATE INDEX IF NOT EXISTS idx_inv_dividendos_criado_por   ON arqvalor.inv_dividendos (criado_por);
CREATE INDEX IF NOT EXISTS idx_agregados_contas_conta_id   ON arqvalor.agregados_contas (conta_id);
