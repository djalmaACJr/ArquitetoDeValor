-- ============================================================
-- Origem do VP do FII (Valor Patrimonial por cota, fii_vp) + agendamento do
-- cron que o preenche automaticamente a partir do Informe Mensal de FII da
-- CVM (dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS — dado público,
-- gratuito, sem chave). Antes disso o campo só existia para digitação manual
-- (ver 20260917000001_inv_ativos_fii_vp.sql) — sem fonte automática à época.
--
-- `fii_vp_origem`: 'MANUAL' (usuário digitou) | 'CVM' (preenchido pelo cron/
-- pelo cadastro). A CVM sempre tem prioridade quando encontra o fundo — só
-- fica 'MANUAL' permanentemente se o ticker não constar no Informe Mensal
-- (ex.: FII muito novo, sem negociação, ou descontinuado).
-- `fii_vp_atualizado_em`: mês de referência do dado da CVM (Data_Referencia,
-- sempre dia 1 do mês) — null para valor manual (não tem "mês de referência").
-- ============================================================
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS fii_vp_origem TEXT;
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS fii_vp_atualizado_em DATE;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_inv_ativos_fii_vp_origem'
    ) THEN
        ALTER TABLE arqvalor.inv_ativos ADD CONSTRAINT chk_inv_ativos_fii_vp_origem
            CHECK (fii_vp_origem IS NULL OR fii_vp_origem IN ('MANUAL', 'CVM'));
    END IF;
END $$;

-- ── Agendamento do cron (pg_cron + pg_net) ─────────────────────────────
-- Mesmo padrão de 20260827000003_inv_fatos_relevantes.sql: idempotente, não
-- falha se pg_cron/Vault ainda não estiverem prontos no ambiente.
--
-- PRÉ-REQUISITOS (uma vez, no projeto Supabase):
--   1) pg_cron e pg_net habilitados (já estão, se os demais crons rodam).
--   2) Secret CRON_SECRET já existente (mesmo dos outros jobs).
--   3) Vault: edge_url_cvm_fii_cron =
--        https://<PROJECT_REF>.supabase.co/functions/v1/investimentos/cvm-fii-cron
--      (reusa a mesma entrada `cron_secret` do Vault já usada pelos outros jobs)
--
-- Semanal (não diário): a CVM recebe/retifica os informes mensais dos fundos
-- ao longo de várias semanas — rodar 1x/dia não traria nada de novo na
-- maioria dos dias, e o ZIP anual inteiro (~1MB, todos os FIIs) é baixado a
-- cada execução. Segunda-feira 09:00 UTC = 06:00 BRT.
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

    PERFORM cron.unschedule('cvm-fii-semanal')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cvm-fii-semanal');

    PERFORM cron.schedule(
        'cvm-fii-semanal',
        '0 9 * * 1',
        $cron$
        SELECT net.http_post(
            url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_cvm_fii_cron'),
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
            ),
            body    := '{}'::jsonb,
            -- Baixa+descompacta+parseia um ZIP de ~1MB com o ano inteiro de
            -- todos os FIIs — folga generosa de timeout.
            timeout_milliseconds := 60000
        );
        $cron$
    );
    RAISE NOTICE 'Agendamento "cvm-fii-semanal" criado (09:00 UTC = 06:00 BRT, toda segunda-feira).';
END $$;
