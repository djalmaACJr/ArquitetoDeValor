-- ============================================================
-- Cotações do Tesouro Direto (marcação a mercado) — REFERÊNCIA COMPARTILHADA
--
-- Títulos públicos prefixados (Tesouro Prefixado / LTN / NTN-F) e indexados
-- ao IPCA (Tesouro IPCA+ / NTN-B) sofrem MARCAÇÃO A MERCADO: o preço de
-- resgate (PU de venda) oscila diariamente com a taxa de juros. Diferente
-- do Tesouro Selic (pós-fixado), cujo PU acompanha a Selic sem oscilação
-- relevante. Por isso guardamos o PU desses títulos como referência.
--
-- Mesmo padrão de cotacoes_ativos: cache MENSAL (fechamento do mês = último
-- dia útil disponível), compartilhado entre todos os usuários (sem user_id)
-- e fora das rotinas de limpeza por usuário. Populado pela Edge Function
-- `investimentos` a partir do Tesouro Transparente (dados abertos do STN).
--
-- Identidade do título: (tipo_titulo, vencimento). Ex.: ('Tesouro IPCA+',
-- 2029-05-15). `tipo_titulo` guarda o rótulo do STN, incluindo as variações
-- "com Juros Semestrais".
--
-- Leitura: liberada a todos os autenticados (dado público de referência).
-- Escrita:  apenas via service_role.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.cotacoes_tesouro (
    tipo_titulo   TEXT          NOT NULL,
    vencimento    DATE          NOT NULL,
    mes_ano       TEXT          NOT NULL CHECK (mes_ano ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    data_base     DATE          NOT NULL,  -- dia útil de referência do PU no mês
    pu_venda      NUMERIC(14,6) NOT NULL CHECK (pu_venda >= 0),  -- PU de resgate (marcação a mercado)
    taxa_venda    NUMERIC(10,4),           -- taxa de venda (% a.a.), referência
    atualizado_em TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tipo_titulo, vencimento, mes_ano)
);

-- Consulta típica: todas as cotações de um título ao longo do tempo.
CREATE INDEX IF NOT EXISTS idx_cotacoes_tesouro_titulo
    ON arqvalor.cotacoes_tesouro (tipo_titulo, vencimento, mes_ano);

ALTER TABLE arqvalor.cotacoes_tesouro ENABLE ROW LEVEL SECURITY;

-- SELECT liberado a todos os autenticados (dado público de referência).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'cotacoes_tesouro'
          AND policyname = 'cotacoes_tesouro_select'
    ) THEN
        CREATE POLICY cotacoes_tesouro_select ON arqvalor.cotacoes_tesouro
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

-- Sem policy de INSERT/UPDATE para authenticated → escrita só por
-- service_role (que ignora RLS). authenticated recebe apenas SELECT.
GRANT SELECT                         ON arqvalor.cotacoes_tesouro TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.cotacoes_tesouro TO service_role;
