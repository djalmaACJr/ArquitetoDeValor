-- ============================================================
-- Cotações PTAX do dólar (USD/BRL) — tabela de REFERÊNCIA COMPARTILHADA
--
-- Usada para converter ativos em moeda estrangeira (inv_ativos.moeda
-- != 'BRL') para reais no frontend. A tabela NÃO tem user_id: a cotação
-- é a mesma para todos, então é compartilhada (sem duplicidade).
--
-- Leitura: liberada a todos os usuários autenticados.
-- Escrita:  apenas via service_role (a Edge Function `investimentos`
--           popula a partir do PTAX do Banco Central — Olinda/BCB).
--
-- Convenção: `data` é a data de referência da cotação (dia útil). Para
-- uma data sem cotação (fim de semana/feriado), o consumidor usa a
-- cotação do último dia útil anterior (data <= alvo).
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.cotacoes_ptax (
    data           DATE          PRIMARY KEY,
    cotacao_compra NUMERIC(10,4) NOT NULL CHECK (cotacao_compra >= 0),
    cotacao_venda  NUMERIC(10,4) NOT NULL CHECK (cotacao_venda  >= 0),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE arqvalor.cotacoes_ptax ENABLE ROW LEVEL SECURITY;

-- SELECT liberado a todos os autenticados (dado público de referência).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'cotacoes_ptax'
          AND policyname = 'cotacoes_ptax_select'
    ) THEN
        CREATE POLICY cotacoes_ptax_select ON arqvalor.cotacoes_ptax
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

-- Sem policy de INSERT/UPDATE para authenticated → escrita só por
-- service_role (que ignora RLS). authenticated recebe apenas SELECT.
GRANT SELECT                         ON arqvalor.cotacoes_ptax TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.cotacoes_ptax TO service_role;
