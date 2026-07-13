-- ============================================================
-- Investimentos — config do rendimento de cripto: início e periodicidade
--
-- Complementa cripto_rendimento_aa (20260625000004):
--   • cripto_rendimento_inicio       — desde quando o ativo rende (DATE).
--     NULL = começa no 1º aporte/compra.
--   • cripto_rendimento_periodicidade — base de composição do yield
--     (DIARIA | SEMANAL | MENSAL). NULL = MENSAL.
--
-- Materialização das operações RENDIMENTO é SEMANAL (1 op/semana), com
-- juros compostos na periodicidade escolhida. Ver provisionarRendimentoCripto.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CHECK via DO/EXCEPTION.
-- ============================================================

ALTER TABLE arqvalor.inv_ativos
  ADD COLUMN IF NOT EXISTS cripto_rendimento_inicio       DATE;

ALTER TABLE arqvalor.inv_ativos
  ADD COLUMN IF NOT EXISTS cripto_rendimento_periodicidade TEXT;

DO $$ BEGIN
  ALTER TABLE arqvalor.inv_ativos
    ADD CONSTRAINT chk_cripto_periodicidade
    CHECK (cripto_rendimento_periodicidade IS NULL
        OR cripto_rendimento_periodicidade IN ('DIARIA', 'SEMANAL', 'MENSAL'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN arqvalor.inv_ativos.cripto_rendimento_inicio IS
  'Data a partir da qual a cripto rende (NULL = 1º aporte).';
COMMENT ON COLUMN arqvalor.inv_ativos.cripto_rendimento_periodicidade IS
  'Base de composição do yield: DIARIA | SEMANAL | MENSAL (NULL = MENSAL). '
  'A materialização das operações RENDIMENTO é sempre semanal.';
