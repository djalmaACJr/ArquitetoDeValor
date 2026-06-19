-- ============================================================
-- Investimentos — Índice e taxas estruturadas da Renda Fixa
--
-- rf_indexador já dizia a FORMA de rentabilidade (PREFIXADO/POS_FIXADO/
-- HIBRIDO), mas o índice de referência (CDI/SELIC/IPCA/IGP-M) e os números
-- ficavam só em texto livre (rf_taxa), impedindo o cálculo de rendimento.
-- Estes campos estruturam isso:
--   rf_indice              — CDI | SELIC | IPCA | IGPM (NULL p/ prefixado)
--   rf_percentual_indice   — % do índice (ex.: 110.000 = 110% do CDI) — pós-fixado
--   rf_taxa_fixa           — taxa fixa a.a. em % (ex.: 6.200 = +6,2% no híbrido,
--                            ou 13.500 = 13,5% a.a. no prefixado)
-- rf_taxa (texto livre) continua existindo como rótulo amigável derivado.
-- ============================================================

DO $$ BEGIN
    CREATE TYPE arqvalor.indice_rf AS ENUM ('CDI', 'SELIC', 'IPCA', 'IGPM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS rf_indice            arqvalor.indice_rf,
    ADD COLUMN IF NOT EXISTS rf_percentual_indice NUMERIC(7,3),
    ADD COLUMN IF NOT EXISTS rf_taxa_fixa         NUMERIC(7,3);

COMMENT ON COLUMN arqvalor.inv_ativos.rf_indice IS
    'Índice de referência da renda fixa pós-fixada/híbrida: CDI, SELIC, IPCA ou IGPM. NULL no prefixado.';
COMMENT ON COLUMN arqvalor.inv_ativos.rf_percentual_indice IS
    'Percentual do índice (ex.: 110 = 110% do CDI) — usado no pós-fixado.';
COMMENT ON COLUMN arqvalor.inv_ativos.rf_taxa_fixa IS
    'Taxa fixa a.a. em % — spread do híbrido (IPCA + X%) ou a taxa do prefixado.';
