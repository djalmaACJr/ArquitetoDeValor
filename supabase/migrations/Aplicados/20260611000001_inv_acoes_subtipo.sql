-- ============================================================
-- Investimentos — Subtipo de Ações
--
-- Aplicável quando tipo_ativo = 'ACOES':
--   ON   — ação ordinária (dá direito a voto)
--   PN   — ação preferencial (prioridade em dividendos)
--   UNIT — pacote de ações (ON + PN) negociado como uma unidade
--   BDR  — Brazilian Depositary Receipt (recibo de ação estrangeira
--          negociado na B3)
--
-- NULL = não especificado. Metadados de exibição em
-- FrontEnd/src/lib/constants.ts.
-- ============================================================

DO $$ BEGIN
    CREATE TYPE arqvalor.acoes_subtipo AS ENUM (
        'ON', 'PN', 'UNIT', 'BDR'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS acoes_subtipo arqvalor.acoes_subtipo;

COMMENT ON COLUMN arqvalor.inv_ativos.acoes_subtipo IS
    'Subtipo da ação (ON/PN/UNIT/BDR) — só para tipo_ativo = ACOES';
