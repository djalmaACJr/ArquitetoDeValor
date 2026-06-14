-- ============================================================
-- Cotações de ativos (cache mensal) — tabela de REFERÊNCIA COMPARTILHADA
--
-- O preço de um ticker é o MESMO para todos os usuários, então a cotação
-- não deve ser atrelada a um user nem refetchada por usuário. Esta tabela
-- funciona como cache compartilhado: a Edge Function `investimentos`
-- popula a partir das fontes externas (brapi / Yahoo Finance / CoinGecko)
-- e todos os usuários reusam o mesmo valor.
--
-- Chave (ticker, mes_ano):
--   • mês corrente  → preço "atual" (atualizado_em controla a validade);
--   • meses passados → fechamento mensal (imutável, reusado para sempre).
--
-- NÃO tem user_id → fora das rotinas de limpeza por usuário (limpar /
-- fn_excluir_dados_usuario só apagam linhas com user_id = auth.uid()).
--
-- Leitura: liberada a todos os autenticados (dado público de referência).
-- Escrita:  apenas via service_role (a Edge Function popula o cache).
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.cotacoes_ativos (
    ticker        TEXT          NOT NULL,
    mes_ano       TEXT          NOT NULL CHECK (mes_ano ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    preco         NUMERIC(20,8) NOT NULL CHECK (preco >= 0),
    moeda         TEXT          NOT NULL DEFAULT 'BRL',
    atualizado_em TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, mes_ano)
);

ALTER TABLE arqvalor.cotacoes_ativos ENABLE ROW LEVEL SECURITY;

-- SELECT liberado a todos os autenticados (dado público de referência).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'cotacoes_ativos'
          AND policyname = 'cotacoes_ativos_select'
    ) THEN
        CREATE POLICY cotacoes_ativos_select ON arqvalor.cotacoes_ativos
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

-- Sem policy de INSERT/UPDATE para authenticated → escrita só por
-- service_role (que ignora RLS). authenticated recebe apenas SELECT.
GRANT SELECT                         ON arqvalor.cotacoes_ativos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.cotacoes_ativos TO service_role;
