-- ============================================================
-- Análise de resultados de empresas — Ações BR (CVM) e Stocks/REITs EUA (EDGAR) (v7.8.0)
--
-- Generaliza o que a 7.7.0 fez só para FIIs. `inv_documentos_resultado` é o cache
-- COMPARTILHADO (sem user_id, escrita só service_role) dos documentos a analisar:
--   fonte 'EDGAR' → 10-Q / 10-K da SEC (texto da seção MD&A extraído do HTML);
--   fonte 'CVM'   → resumo numérico montado a partir do ITR/DFP (dados abertos da
--                   CVM; o PDF do release não é baixável sem sessão de navegador).
-- `inv_analises_relatorio` (por usuário) passa a apontar para um relatório de FII
-- (`relatorio_id`) OU para um destes documentos (`documento_id`).
--
-- Aproveita para corrigir apontamentos dos advisors do banco na tabela criada na
-- 7.7.0: policy sem `(select auth.uid())` (auth_rls_initplan) e FK sem índice.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_documentos_resultado (
    id               TEXT        PRIMARY KEY,            -- 'EDGAR:<accession>' | 'CVM:<cnpj>:<data-base>'
    fonte            TEXT        NOT NULL CHECK (fonte IN ('EDGAR', 'CVM')),
    ticker_ref       TEXT        NOT NULL,                -- EDGAR: ticker; CVM: raiz do ticker (PETR)
    emissor_chave    TEXT        NOT NULL,                -- CIK (EDGAR) ou CNPJ (CVM)
    emissor_nome     TEXT        NOT NULL,
    tipo_doc         TEXT        NOT NULL,                -- 10-Q | 10-K | ITR | DFP
    data_referencia  DATE,                                -- fim do período
    data_entrega     TIMESTAMPTZ NOT NULL,
    url_documento    TEXT,
    texto            TEXT,                                -- texto a enviar à IA (truncado)
    texto_status     TEXT        NOT NULL DEFAULT 'PENDENTE'
                     CHECK (texto_status IN ('PENDENTE', 'OK', 'ERRO')),
    baixado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_docs_resultado_ticker
    ON arqvalor.inv_documentos_resultado (ticker_ref, data_entrega DESC);
CREATE INDEX IF NOT EXISTS idx_inv_docs_resultado_fonte
    ON arqvalor.inv_documentos_resultado (fonte, baixado_em DESC);

ALTER TABLE arqvalor.inv_documentos_resultado ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'inv_documentos_resultado'
          AND policyname = 'inv_documentos_resultado_select'
    ) THEN
        CREATE POLICY inv_documentos_resultado_select ON arqvalor.inv_documentos_resultado
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

GRANT SELECT                         ON arqvalor.inv_documentos_resultado TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_documentos_resultado TO service_role;

-- ── Análises: relatório de FII OU documento de resultado ──────────────
ALTER TABLE arqvalor.inv_analises_relatorio
    ALTER COLUMN relatorio_id DROP NOT NULL;

ALTER TABLE arqvalor.inv_analises_relatorio
    ADD COLUMN IF NOT EXISTS documento_id TEXT
        REFERENCES arqvalor.inv_documentos_resultado(id) ON DELETE CASCADE;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_inv_analise_origem_doc'
    ) THEN
        ALTER TABLE arqvalor.inv_analises_relatorio
            ADD CONSTRAINT chk_inv_analise_origem_doc
            CHECK (relatorio_id IS NOT NULL OR documento_id IS NOT NULL);
    END IF;
    -- NULLs são distintos no UNIQUE: linhas de FII (documento_id nulo) nunca colidem aqui.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_inv_analise_documento'
    ) THEN
        ALTER TABLE arqvalor.inv_analises_relatorio
            ADD CONSTRAINT uq_inv_analise_documento UNIQUE (user_id, ativo_id, documento_id);
    END IF;
END $$;

-- FKs sem índice cobrindo (advisor unindexed_foreign_keys).
CREATE INDEX IF NOT EXISTS idx_inv_analises_relatorio_relatorio
    ON arqvalor.inv_analises_relatorio (relatorio_id);
CREATE INDEX IF NOT EXISTS idx_inv_analises_relatorio_documento
    ON arqvalor.inv_analises_relatorio (documento_id);

-- Policy do dono com `(select auth.uid())` (avaliado 1× por consulta, não por linha).
DROP POLICY IF EXISTS inv_analises_relatorio_dono ON arqvalor.inv_analises_relatorio;
CREATE POLICY inv_analises_relatorio_dono ON arqvalor.inv_analises_relatorio
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
