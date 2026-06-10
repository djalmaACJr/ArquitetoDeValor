-- ============================================================
-- Investimentos — Categoria de Fundos Imobiliários (FII)
--
-- Aplicável quando tipo_ativo = 'FII':
--   TIJOLO         — imóveis físicos (prédios, shoppings, galpões);
--                    lucro de aluguéis e valorização; risco moderado;
--                    proteção real contra a inflação
--   PAPEL          — títulos de dívida imobiliária (CRIs, LCIs);
--                    lucro dos juros; risco moderado; dividendos mais
--                    altos quando juros/inflação sobem
--   FOF            — cotas de outros FIIs; dividendos e venda de cotas;
--                    risco baixo a moderado; alta diversificação com
--                    investimento inicial baixo
--   DESENVOLVIMENTO— projetos na planta/terrenos em obras; lucro na
--                    venda/aluguel após concluído; risco alto; potencial
--                    de ganho muito acima da média
--
-- Metadados de exibição em FrontEnd/src/lib/constants.ts.
-- ============================================================

DO $$ BEGIN
    CREATE TYPE arqvalor.categoria_fii AS ENUM (
        'TIJOLO', 'PAPEL', 'FOF', 'DESENVOLVIMENTO', 'OUTRO'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS fii_categoria arqvalor.categoria_fii;

COMMENT ON COLUMN arqvalor.inv_ativos.fii_categoria IS
    'Categoria do FII (TIJOLO/PAPEL/FOF/DESENVOLVIMENTO/OUTRO) — só para tipo_ativo = FII';
