-- ============================================================
-- Análise periódica de Relatórios Gerenciais de FIIs (v7.7.0)
--
-- Fonte: Fundos.NET (B3) → categoria "Relatórios", tipo "Relatório Gerencial"
-- (PDF mensal que a gestora publica). Um cron diário cacheia os metadados
-- (tabela COMPARTILHADA, mesmo padrão de inv_fatos_relevantes), baixa o PDF e
-- extrai o texto só dos fundos que algum usuário tem em carteira, e — para
-- quem ligou a análise automática — pede à IA do próprio usuário uma análise
-- estruturada (pontos fortes / pontos de atenção / inconsistências).
--
--   inv_relatorios_fii       compartilhada, sem user_id (escrita só service_role)
--   inv_analises_relatorio   por usuário (RLS user_id = auth.uid())
--   usuarios.inv_relatorios_auto  opt-in: gasta a chave de IA do usuário
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_relatorios_fii (
    id              BIGINT      PRIMARY KEY,           -- id do documento no Fundos.NET
    fundo_nome      TEXT        NOT NULL,
    fundo_pregao    TEXT,
    data_referencia DATE,                               -- competência do relatório
    data_entrega    TIMESTAMPTZ NOT NULL,
    url_documento   TEXT        NOT NULL,
    texto           TEXT,                               -- texto extraído do PDF (truncado)
    texto_status    TEXT        NOT NULL DEFAULT 'PENDENTE'
                    CHECK (texto_status IN ('PENDENTE', 'OK', 'ERRO')),
    baixado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_relatorios_fii_pregao
    ON arqvalor.inv_relatorios_fii (fundo_pregao, data_entrega DESC);
CREATE INDEX IF NOT EXISTS idx_inv_relatorios_fii_data
    ON arqvalor.inv_relatorios_fii (data_entrega DESC);

ALTER TABLE arqvalor.inv_relatorios_fii ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'inv_relatorios_fii'
          AND policyname = 'inv_relatorios_fii_select'
    ) THEN
        CREATE POLICY inv_relatorios_fii_select ON arqvalor.inv_relatorios_fii
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

GRANT SELECT                         ON arqvalor.inv_relatorios_fii TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_relatorios_fii TO service_role;

-- ── Análises por usuário ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arqvalor.inv_analises_relatorio (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ativo_id         UUID        NOT NULL REFERENCES arqvalor.inv_ativos(id) ON DELETE CASCADE,
    relatorio_id     BIGINT      NOT NULL REFERENCES arqvalor.inv_relatorios_fii(id) ON DELETE CASCADE,
    data_referencia  DATE,
    veredito         TEXT        NOT NULL CHECK (veredito IN ('POSITIVO', 'NEUTRO', 'ATENCAO', 'NEGATIVO')),
    resumo           TEXT        NOT NULL,
    pontos_fortes    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    pontos_atencao   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    inconsistencias  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    mudancas         TEXT,                               -- o que mudou vs. a análise anterior
    provedor         TEXT,
    modelo           TEXT,
    origem           TEXT        NOT NULL DEFAULT 'MANUAL' CHECK (origem IN ('CRON', 'MANUAL')),
    visto_em         TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_inv_analise_relatorio UNIQUE (user_id, ativo_id, relatorio_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_analises_relatorio_user
    ON arqvalor.inv_analises_relatorio (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_analises_relatorio_ativo
    ON arqvalor.inv_analises_relatorio (ativo_id, data_referencia DESC);

ALTER TABLE arqvalor.inv_analises_relatorio ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'inv_analises_relatorio'
          AND policyname = 'inv_analises_relatorio_dono'
    ) THEN
        CREATE POLICY inv_analises_relatorio_dono ON arqvalor.inv_analises_relatorio
            FOR ALL TO authenticated
            USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_analises_relatorio TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_analises_relatorio TO service_role;

-- ── Opt-in da análise automática (usa a chave de IA do usuário) ───────
ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS inv_relatorios_auto BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Agendamento do cron (pg_cron + pg_net) ─────────────────────────────
-- PRÉ-REQUISITO: Vault `edge_url_relatorios_fii_cron` =
--   https://<PROJECT_REF>.supabase.co/functions/v1/investimentos/relatorios-fii-cron
-- (reusa o `cron_secret` do Vault dos demais jobs). Horário: 11:15 UTC =
-- 08:15 BRT, depois de cron-saude-diario (08:00).
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

    PERFORM cron.unschedule('relatorios-fii-diario')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'relatorios-fii-diario');

    PERFORM cron.schedule(
        'relatorios-fii-diario',
        '15 11 * * *',
        $cron$
        SELECT net.http_post(
            url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_relatorios_fii_cron'),
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
            ),
            body    := '{}'::jsonb,
            -- PDF + chamadas de IA por usuário: timeout amplo.
            timeout_milliseconds := 150000
        );
        $cron$
    );
    RAISE NOTICE 'Agendamento "relatorios-fii-diario" criado (11:15 UTC = 08:15 BRT, diário).';
END $$;
