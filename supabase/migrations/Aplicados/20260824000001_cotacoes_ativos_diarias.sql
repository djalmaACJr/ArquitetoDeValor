-- ============================================================
-- Cotações de ativos (cache DIÁRIO) — tabela de REFERÊNCIA COMPARTILHADA
--
-- Mesma natureza de arqvalor.cotacoes_ativos (cache mensal, ver migration
-- 20260613000001), mas com granularidade de DIA — usada pelo filtro de
-- período (Semana/Mês/Semestre/Ano) do ranking de "Destaques" da carteira
-- (GET /investimentos/ranking), que precisa do preço num ponto exato do
-- passado, não só do fechamento do mês.
--
-- O preço de um ticker é o MESMO para todos os usuários → cache
-- compartilhado, sem user_id, fora das rotinas de limpeza por usuário.
--
-- Alimentação:
--   • cron `snapshot-diario` grava o preço do dia corrente pra todo ticker
--     que já busca (mesma cotação que ele já resolve pro snapshot mensal —
--     ver executarSnapshotMes em snapshot.ts);
--   • busca sob demanda (resolverValorDiarioCotado em mercado.ts) faz
--     backfill da série histórica completa (Yahoo/CoinGecko) na 1ª vez que
--     falta cobertura pra uma data pedida, e fica cacheado depois.
--
-- Leitura: liberada a todos os autenticados (dado público de referência).
-- Escrita:  apenas via service_role.
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
