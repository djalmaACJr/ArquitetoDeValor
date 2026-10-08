-- ============================================================
-- Recria arqvalor.cotacoes_ativos_diarias (revertida pela migration
-- 20260824000002 em favor do snapshot MENSAL já existente).
--
-- Motivo da volta: granularidade de MÊS não representa "Semana" de jeito
-- nenhum — dentro do mês corrente, o filtro "Semana" e o snapshot do mês
-- corrente são a MESMA linha (o cron `snapshot-diario` fica reescrevendo
-- essa linha com o preço de HOJE toda vez que roda), então o retorno dava
-- sempre ~0% (achado real, "tudo zerado"). Semana volta a precisar de um
-- ponto no tempo de verdade, dia a dia.
--
-- Desta vez o backfill sob demanda (ver resolverValorDiarioCotado em
-- mercado.ts) busca só uma JANELA ESTREITA (~3 semanas) ao redor da data
-- pedida, não a série histórica inteira — é essa mudança (e não a tabela em
-- si) que evita o estouro de recursos (WORKER_RESOURCE_LIMIT / "Erro 546")
-- que aconteceu na primeira tentativa. Usada só pelo filtro "Semana";
-- Mês/Semestre/Ano continuam no snapshot mensal (inv_historico_mensal).
--
-- Mesmo DDL idempotente da migration original (20260824000001) — sem dado
-- de usuário a preservar entre as duas passagens.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.cotacoes_ativos_diarias (
    ticker        TEXT          NOT NULL,
    data          DATE          NOT NULL,
    preco         NUMERIC(20,8) NOT NULL CHECK (preco >= 0),
    moeda         TEXT          NOT NULL DEFAULT 'BRL',
    atualizado_em TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, data)
);

-- Busca típica é "última cotação <= data alvo" por ticker — index composto
-- na ordem (ticker, data DESC) acelera esse padrão de range scan.
CREATE INDEX IF NOT EXISTS ix_cotacoes_ativos_diarias_ticker_data
    ON arqvalor.cotacoes_ativos_diarias (ticker, data DESC);

ALTER TABLE arqvalor.cotacoes_ativos_diarias ENABLE ROW LEVEL SECURITY;

-- SELECT liberado a todos os autenticados (dado público de referência).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'cotacoes_ativos_diarias'
          AND policyname = 'cotacoes_ativos_diarias_select'
    ) THEN
        CREATE POLICY cotacoes_ativos_diarias_select ON arqvalor.cotacoes_ativos_diarias
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

-- Sem policy de INSERT/UPDATE para authenticated → escrita só por
-- service_role (que ignora RLS). authenticated recebe apenas SELECT.
GRANT SELECT                         ON arqvalor.cotacoes_ativos_diarias TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.cotacoes_ativos_diarias TO service_role;
