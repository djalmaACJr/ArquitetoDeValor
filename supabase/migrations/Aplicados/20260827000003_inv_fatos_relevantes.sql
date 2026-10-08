-- ============================================================
-- Cache compartilhado de Fatos Relevantes / Comunicados ao Mercado de FIIs
-- (Fundos.NET / B3 — https://fnet.bmfbovespa.com.br), usado para dar
-- contexto factual real aos mentores de IA na avaliação de ativos
-- (ver avaliacoes.ts § "Contexto de Fatos Relevantes (FII)").
--
-- Mesmo padrão de `cotacoes_ativos`/`cotacoes_tesouro`: dado PÚBLICO de
-- referência, o mesmo documento vale para todos os usuários — sem
-- user_id, fora das rotinas de limpeza/backup por usuário. Leitura
-- liberada a todos os autenticados; escrita só via service_role (o cron
-- `fatos-relevantes-diario` popula via `investimentos/fatos-relevantes-cron`).
--
-- `id` é o id do documento no Fundos.NET (estável, não gerado por nós) —
-- serve de chave natural para dedup entre execuções do cron.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_fatos_relevantes (
    id            BIGINT      PRIMARY KEY,
    categoria     TEXT        NOT NULL,   -- 'Fato Relevante' | 'Comunicado ao Mercado'
    fundo_nome    TEXT        NOT NULL,   -- descricaoFundo (denominação social)
    fundo_pregao  TEXT,                   -- nomePregao (código/apelido de negociação)
    resumo        TEXT,                   -- informacoesAdicionais (resumo curto do fato, quando houver)
    data_entrega  TIMESTAMPTZ NOT NULL,
    url_documento TEXT        NOT NULL,
    baixado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_fatos_relevantes_pregao
    ON arqvalor.inv_fatos_relevantes (fundo_pregao, data_entrega DESC);
CREATE INDEX IF NOT EXISTS idx_inv_fatos_relevantes_data
    ON arqvalor.inv_fatos_relevantes (data_entrega DESC);

ALTER TABLE arqvalor.inv_fatos_relevantes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'inv_fatos_relevantes'
          AND policyname = 'inv_fatos_relevantes_select'
    ) THEN
        CREATE POLICY inv_fatos_relevantes_select ON arqvalor.inv_fatos_relevantes
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

-- Sem policy de INSERT/UPDATE/DELETE para authenticated → escrita só por
-- service_role (o cron usa dbAdmin()).
GRANT SELECT                         ON arqvalor.inv_fatos_relevantes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_fatos_relevantes TO service_role;

-- ── Agendamento do cron (pg_cron + pg_net) ─────────────────────────────
-- Mesmo padrão de 20260625000005_cron_rendimento_cripto.sql: idempotente,
-- não falha se pg_cron/Vault ainda não estiverem prontos no ambiente.
--
-- PRÉ-REQUISITOS (uma vez, no projeto Supabase):
--   1) pg_cron e pg_net habilitados (já estão, se os demais crons rodam).
--   2) Secret CRON_SECRET já existente (mesmo dos outros jobs).
--   3) Vault: edge_url_fatos_relevantes_cron =
--        https://<PROJECT_REF>.supabase.co/functions/v1/investimentos/fatos-relevantes-cron
--      (reusa a mesma entrada `cron_secret` do Vault já usada pelos outros jobs)
--
-- Horário: 10:45 UTC = 07:45 BRT — entre cupom-tesouro-diario (07:30) e
-- cron-saude-diario (08:00).
DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
        CREATE EXTENSION IF NOT EXISTS pg_net;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron/pg_net: habilite pelas Extensions do Dashboard (%).', SQLERRM;
    END;

    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'pg_cron ausente — agendamento NÃO criado. Reexecute após habilitar.';
        RETURN;
    END IF;

    PERFORM cron.unschedule('fatos-relevantes-diario')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fatos-relevantes-diario');

    PERFORM cron.schedule(
        'fatos-relevantes-diario',
        '45 10 * * *',
        $cron$
        SELECT net.http_post(
            url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_fatos_relevantes_cron'),
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
            ),
            body    := '{}'::jsonb,
            -- Várias páginas pequenas (WAF do Fundos.NET penaliza páginas
            -- grandes) + pausas entre chamadas: timeout amplo.
            timeout_milliseconds := 60000
        );
        $cron$
    );
    RAISE NOTICE 'Agendamento "fatos-relevantes-diario" criado (10:45 UTC = 07:45 BRT, diário).';
END $$;
