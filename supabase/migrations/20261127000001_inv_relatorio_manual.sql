-- ============================================================
-- Relatório enviado manualmente (PDF) — v8.2.0
--
-- Quando a fonte automática não tem o relatório (ex.: FII que o Fundos.NET não
-- devolve), o usuário sobe o PDF na página do ativo / Análise de Relatórios. O
-- texto extraído vira uma linha de `inv_documentos_resultado` com fonte 'MANUAL'
-- e `user_id` do dono — ao contrário dos documentos de EDGAR/CVM (compartilhados,
-- user_id nulo), esta linha é PRIVADA: só o dono a enxerga.
-- ============================================================

ALTER TABLE arqvalor.inv_documentos_resultado
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_inv_docs_resultado_user
    ON arqvalor.inv_documentos_resultado (user_id) WHERE user_id IS NOT NULL;

-- Amplia o CHECK de `fonte` (nome gerado pelo Postgres: localiza pela definição).
DO $$
DECLARE v_nome TEXT;
BEGIN
    SELECT conname INTO v_nome
      FROM pg_constraint
     WHERE conrelid = 'arqvalor.inv_documentos_resultado'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%EDGAR%'
       AND pg_get_constraintdef(oid) NOT LIKE '%MANUAL%';
    IF v_nome IS NOT NULL THEN
        EXECUTE format('ALTER TABLE arqvalor.inv_documentos_resultado DROP CONSTRAINT %I', v_nome);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inv_docs_resultado_fonte') THEN
        ALTER TABLE arqvalor.inv_documentos_resultado
            ADD CONSTRAINT chk_inv_docs_resultado_fonte CHECK (fonte IN ('EDGAR', 'CVM', 'MANUAL'));
    END IF;
END $$;

-- Linha MANUAL sempre tem dono; as demais, nunca.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inv_docs_resultado_manual_dono') THEN
        ALTER TABLE arqvalor.inv_documentos_resultado
            ADD CONSTRAINT chk_inv_docs_resultado_manual_dono
            CHECK ((fonte = 'MANUAL') = (user_id IS NOT NULL));
    END IF;
END $$;

-- SELECT: compartilhados (user_id nulo) + os próprios.
DROP POLICY IF EXISTS inv_documentos_resultado_select ON arqvalor.inv_documentos_resultado;
CREATE POLICY inv_documentos_resultado_select ON arqvalor.inv_documentos_resultado
    FOR SELECT TO authenticated
    USING (user_id IS NULL OR user_id = (SELECT auth.uid()));

-- Hash do texto do PDF: impede o mesmo usuário de enviar o mesmo relatório duas vezes.
ALTER TABLE arqvalor.inv_documentos_resultado
    ADD COLUMN IF NOT EXISTS hash_conteudo TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_docs_resultado_manual_hash
    ON arqvalor.inv_documentos_resultado (user_id, hash_conteudo)
    WHERE hash_conteudo IS NOT NULL;
