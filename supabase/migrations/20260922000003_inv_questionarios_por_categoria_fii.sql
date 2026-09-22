-- ============================================================
-- inv_questionarios — questionário custom passa a poder ser específico
-- por CATEGORIA de FII (Tijolo/Papel/FoF/Desenvolvimento/FIAGRO/Outro),
-- não só por tipo_ativo. Um FII de papel (CRI/CRA) não tem os mesmos
-- riscos de um FII de tijolo (vacância de imóveis) — ver
-- FrontEnd/src/lib/questionarioAtivos.ts (PERGUNTAS_FII_POR_CATEGORIA).
--
-- fii_categoria = '' (string vazia, NOT NULL) significa:
--   - para tipo_ativo <> 'FII': sempre '' (não se aplica).
--   - para tipo_ativo = 'FII': o questionário "genérico" do usuário para
--     FII, usado quando não há um custom mais específico para a
--     categoria do ativo. Uma categoria concreta (ex.: 'PAPEL') SOBREPÕE
--     o genérico só para ativos daquela categoria.
--
-- TEXT simples (não o enum arqvalor.categoria_fii) de propósito: um enum
-- nullable quebraria a unicidade (NULL nunca conflita em UNIQUE/ON
-- CONFLICT), então cada upsert criaria uma linha nova em vez de
-- atualizar. String vazia é um valor real e concreto, então a chave
-- (user_id, tipo_ativo, fii_categoria) funciona com ON CONFLICT normal.
-- ============================================================

ALTER TABLE arqvalor.inv_questionarios
    ADD COLUMN IF NOT EXISTS fii_categoria TEXT NOT NULL DEFAULT '';

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_inv_questionarios_fii_categoria'
          AND conrelid = 'arqvalor.inv_questionarios'::regclass
    ) THEN
        ALTER TABLE arqvalor.inv_questionarios
            ADD CONSTRAINT chk_inv_questionarios_fii_categoria
            CHECK (fii_categoria = ANY (ARRAY['', 'TIJOLO', 'PAPEL', 'FOF', 'DESENVOLVIMENTO', 'AGRO', 'OUTRO']));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_inv_questionarios_fii_categoria_so_fii'
          AND conrelid = 'arqvalor.inv_questionarios'::regclass
    ) THEN
        ALTER TABLE arqvalor.inv_questionarios
            ADD CONSTRAINT chk_inv_questionarios_fii_categoria_so_fii
            CHECK (tipo_ativo = 'FII' OR fii_categoria = '');
    END IF;
END $$;

-- Troca a unicidade de (user_id, tipo_ativo) para (user_id, tipo_ativo,
-- fii_categoria) — permite 1 linha genérica + 1 por categoria de FII.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_inv_questionarios_user_tipo'
          AND conrelid = 'arqvalor.inv_questionarios'::regclass
    ) THEN
        ALTER TABLE arqvalor.inv_questionarios
            DROP CONSTRAINT uq_inv_questionarios_user_tipo;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_inv_questionarios_user_tipo_categoria'
          AND conrelid = 'arqvalor.inv_questionarios'::regclass
    ) THEN
        ALTER TABLE arqvalor.inv_questionarios
            ADD CONSTRAINT uq_inv_questionarios_user_tipo_categoria
            UNIQUE (user_id, tipo_ativo, fii_categoria);
    END IF;
END $$;
