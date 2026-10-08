-- ============================================================
-- Investimentos — Renda fixa com taxa escalonada por faixa de valor
--
-- Alguns CDBs pagam um percentual do índice até um determinado valor
-- aplicado e outro percentual (normalmente menor) sobre o excedente — ex.:
-- "até R$10.000 rende 120% do CDI; acima disso, 100% do CDI". Antes destes
-- campos, o ativo só suportava UMA taxa (rf_percentual_indice) para o valor
-- inteiro.
--
-- rf_limite_faixa         — valor (R$) até onde vale rf_percentual_indice;
--                            acima dele, passa a valer rf_percentual_indice_2
-- rf_percentual_indice_2  — % do índice acima de rf_limite_faixa
--
-- Só se aplica ao caso "% do índice" do pós-fixado (rf_indexador=POS_FIXADO
-- com rf_percentual_indice preenchido) — não à forma aditiva ("índice + X%")
-- nem a prefixado/híbrido. Ambos os campos são opcionais e nulos por padrão
-- (comportamento de taxa única, sem faixa, é o padrão inalterado).
-- ============================================================

ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS rf_limite_faixa        NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS rf_percentual_indice_2 NUMERIC(7,3);

COMMENT ON COLUMN arqvalor.inv_ativos.rf_limite_faixa IS
    'Valor (R$) até onde vale rf_percentual_indice; acima disso vale rf_percentual_indice_2. NULL = taxa única (sem faixa).';
COMMENT ON COLUMN arqvalor.inv_ativos.rf_percentual_indice_2 IS
    'Percentual do índice aplicado à parte do valor acima de rf_limite_faixa (ex.: CDB que rende 120% CDI até R$10.000 e 100% CDI acima).';

DO $$ BEGIN
    ALTER TABLE arqvalor.inv_ativos
        ADD CONSTRAINT chk_inv_ativos_rf_faixa_par
        CHECK ((rf_limite_faixa IS NULL) = (rf_percentual_indice_2 IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
