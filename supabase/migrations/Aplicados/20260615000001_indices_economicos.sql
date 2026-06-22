-- ============================================================
-- Índices econômicos (IPCA e SELIC) — tabela de REFERÊNCIA COMPARTILHADA
--
-- Guarda as taxas mensais publicadas pelo Banco Central (séries SGS):
--   • IPCA  → variação mensal (%)            — série SGS 433
--   • SELIC → taxa acumulada no mês (% a.m.) — série SGS 4390
--   • CDI   → taxa acumulada no mês (% a.m.) — série SGS 4391
--
-- Mesmo padrão de cotacoes_ptax / cotacoes_ativos: o valor é o MESMO para
-- todos os usuários, então a tabela NÃO tem user_id (compartilhada, sem
-- duplicidade) e fica FORA das rotinas de limpeza por usuário (limpar /
-- fn_excluir_dados_usuario só apagam linhas com user_id = auth.uid()).
--
-- Leitura: liberada a todos os autenticados (dado público de referência).
-- Escrita:  apenas via service_role (a Edge Function `investimentos` popula
--           a partir do BCB/SGS, com data de corte 2020-01).
--
-- Convenção: `competencia` é o mês de referência no formato 'YYYY-MM'.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.indices_economicos (
    indice        TEXT          NOT NULL CHECK (indice IN ('IPCA', 'SELIC', 'CDI')),
    competencia   TEXT          NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    valor         NUMERIC(12,6) NOT NULL,  -- % no mês (IPCA pode ser negativo)
    atualizado_em TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (indice, competencia)
);

ALTER TABLE arqvalor.indices_economicos ENABLE ROW LEVEL SECURITY;

-- SELECT liberado a todos os autenticados (dado público de referência).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'indices_economicos'
          AND policyname = 'indices_economicos_select'
    ) THEN
        CREATE POLICY indices_economicos_select ON arqvalor.indices_economicos
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

-- Sem policy de INSERT/UPDATE para authenticated → escrita só por
-- service_role (que ignora RLS). authenticated recebe apenas SELECT.
GRANT SELECT                         ON arqvalor.indices_economicos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.indices_economicos TO service_role;
