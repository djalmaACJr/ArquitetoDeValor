-- ============================================================
-- Composição (holdings) de ETFs — cache de REFERÊNCIA COMPARTILHADA
--
-- A composição de um ETF (quais ativos ele carrega e com que peso) é a
-- MESMA para todos os usuários, então não deve ter user_id nem ser
-- refetchada por usuário. Esta tabela funciona como cache compartilhado:
-- a Edge Function `investimentos` (rota /etf-holdings) popula a partir de
-- fontes externas e todos os usuários reusam o mesmo valor.
--
-- Fontes:
--   • B3  → carteira teórica do índice que o ETF replica (GetPortfolioDay)
--   • FMP → Financial Modeling Prep (etf-holder), p/ ETFs internacionais
--
-- `atualizado_em` controla a validade (holdings mudam pouco — recarrega
-- a cada ~30 dias).
--
-- NÃO tem user_id → fora das rotinas de limpeza e de backup/restore por
-- usuário (igual arqvalor.cotacoes_ativos).
--
-- Leitura: liberada a todos os autenticados (dado público de referência).
-- Escrita:  apenas via service_role (a Edge Function popula o cache).
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_etf_holdings (
    etf_ticker     TEXT          NOT NULL,
    holding_ticker TEXT          NOT NULL,
    holding_nome   TEXT,
    peso           NUMERIC(9,4)  NOT NULL DEFAULT 0 CHECK (peso >= 0),  -- % do ETF (0..100)
    fonte          TEXT          NOT NULL,                              -- 'B3' | 'FMP'
    atualizado_em  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (etf_ticker, holding_ticker)
);

-- Busca por ETF (a rota lê todos os holdings de um etf_ticker de uma vez).
CREATE INDEX IF NOT EXISTS idx_inv_etf_holdings_etf
    ON arqvalor.inv_etf_holdings (etf_ticker);

ALTER TABLE arqvalor.inv_etf_holdings ENABLE ROW LEVEL SECURITY;

-- SELECT liberado a todos os autenticados (dado público de referência).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'inv_etf_holdings'
          AND policyname = 'inv_etf_holdings_select'
    ) THEN
        CREATE POLICY inv_etf_holdings_select ON arqvalor.inv_etf_holdings
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

-- Sem policy de INSERT/UPDATE/DELETE para authenticated → escrita só por
-- service_role (que ignora RLS). authenticated recebe apenas SELECT.
GRANT SELECT                         ON arqvalor.inv_etf_holdings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_etf_holdings TO service_role;
