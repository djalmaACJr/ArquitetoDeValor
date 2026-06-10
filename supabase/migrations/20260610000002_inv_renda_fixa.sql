-- ============================================================
-- Investimentos — Características de Renda Fixa / Tesouro Direto
--
-- Campos aplicáveis quando tipo_ativo IN (RENDA_FIXA, TESOURO_DIRETO):
--   rf_subtipo      — TESOURO | CDB | LCI | LCA | CRI | CRA | DEBENTURE | OUTRO
--   rf_indexador    — PREFIXADO | POS_FIXADO | HIBRIDO (formas de rentabilidade)
--   rf_taxa         — texto livre: "110% CDI", "IPCA + 6,2%", "13,5% a.a."
--   rf_emissor      — Governo Federal / banco / securitizadora / empresa
--   rf_vencimento   — data de vencimento do título
--   rf_garantia_fgc — coberto pelo FGC (CDB/LCI/LCA: sim, até R$ 250 mil;
--                     Tesouro: não — garantia soberana; CRI/CRA/Deb: não)
--   rf_isento_ir    — LCI/LCA/CRI/CRA: isentos; Tesouro/CDB: tabela
--                     regressiva; Debênture: isenta apenas se incentivada
--
-- Defaults por subtipo são aplicados no frontend (lib/constants.ts) e
-- permanecem editáveis — debênture incentivada, por exemplo.
-- ============================================================

DO $$ BEGIN
    CREATE TYPE arqvalor.subtipo_rf AS ENUM (
        'TESOURO', 'CDB', 'LCI', 'LCA', 'CRI', 'CRA', 'DEBENTURE', 'OUTRO'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE arqvalor.indexador_rf AS ENUM ('PREFIXADO', 'POS_FIXADO', 'HIBRIDO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS rf_subtipo      arqvalor.subtipo_rf,
    ADD COLUMN IF NOT EXISTS rf_indexador    arqvalor.indexador_rf,
    ADD COLUMN IF NOT EXISTS rf_taxa         VARCHAR(40),
    ADD COLUMN IF NOT EXISTS rf_emissor      VARCHAR(80),
    ADD COLUMN IF NOT EXISTS rf_vencimento   DATE,
    ADD COLUMN IF NOT EXISTS rf_garantia_fgc BOOLEAN,
    ADD COLUMN IF NOT EXISTS rf_isento_ir    BOOLEAN;

COMMENT ON COLUMN arqvalor.inv_ativos.rf_subtipo IS
    'Subtipo de renda fixa (TESOURO/CDB/LCI/LCA/CRI/CRA/DEBENTURE/OUTRO) — só para RENDA_FIXA/TESOURO_DIRETO';
COMMENT ON COLUMN arqvalor.inv_ativos.rf_indexador IS
    'Forma de rentabilidade: PREFIXADO, POS_FIXADO (Selic/CDI) ou HIBRIDO (IPCA+)';
