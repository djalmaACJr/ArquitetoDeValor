-- ============================================================
-- Fundamentos de Ações (LPA/VPA/Valor Justo) a partir da CVM (DFP + FCA,
-- dados.cvm.gov.br) — alimenta o indicador Valor Justo (fórmula de Graham:
-- raiz(22,5 × LPA × VPA)), no mesmo espírito do fii_vp/P-VP de FII
-- (20260917000002_inv_ativos_fii_vp_cvm.sql). Ver cvmAcoes.ts.
--
-- `acao_lpa`/`acao_vpa`: Lucro por Ação / Valor Patrimonial por Ação, vindos
-- do último exercício anual (DFP) dividido pelo nº de ações (FCA) — ou
-- digitados manualmente como fallback quando a CVM não encontra a empresa.
-- `acao_valor_justo`: calculado em código (Deno, não SQL) a partir dos dois
-- acima — null se LPA/VPA <= 0 (Graham não se aplica a empresa no
-- prejuízo/patrimônio líquido negativo).
-- `acao_fundamentos_origem`: 'MANUAL' (usuário digitou) | 'CVM' (preenchido
-- pelo cron/pelo cadastro). A CVM sempre tem prioridade quando encontra a
-- companhia — só fica 'MANUAL' permanentemente se o ticker não constar no
-- dataset (ex.: ação muito nova, BDR, ou empresa fechou capital).
-- `acao_fundamentos_referencia`: fim do exercício anual (DT_FIM_EXERC do
-- DFP) usado no cálculo — null quando manual (não tem "exercício de
-- referência").
-- ============================================================
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS acao_lpa NUMERIC;
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS acao_vpa NUMERIC;
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS acao_valor_justo NUMERIC;
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS acao_fundamentos_origem TEXT;
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS acao_fundamentos_referencia DATE;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_inv_ativos_acao_fundamentos_origem'
    ) THEN
        ALTER TABLE arqvalor.inv_ativos ADD CONSTRAINT chk_inv_ativos_acao_fundamentos_origem
            CHECK (acao_fundamentos_origem IS NULL OR acao_fundamentos_origem IN ('MANUAL', 'CVM'));
    END IF;
END $$;

-- ── Agendamento do cron (pg_cron + pg_net) ─────────────────────────────
-- Mesmo padrão de 20260917000002_inv_ativos_fii_vp_cvm.sql: idempotente, não
-- falha se pg_cron/Vault ainda não estiverem prontos no ambiente.
--
-- PRÉ-REQUISITOS (uma vez, no projeto Supabase):
--   1) pg_cron e pg_net habilitados (já estão, se os demais crons rodam).
--   2) Secret CRON_SECRET já existente (mesmo dos outros jobs).
--   3) Vault: edge_url_cvm_acoes_cron =
--        https://<PROJECT_REF>.supabase.co/functions/v1/investimentos/cvm-acoes-cron
--      (reusa a mesma entrada `cron_secret` do Vault já usada pelos outros jobs)
--
-- Mensal (não semanal, ao contrário do FII): a DFP é anual — muda no máximo
-- 1x/ano por empresa — e o ZIP de todas as ~450 companhias abertas (FCA +
-- DFP: 5 CSVs) é bem maior que o ZIP de FII. Todo dia 5 às 09:00 UTC = 06:00
-- BRT (dia útil qualquer, sem pressa de ser o 1º do mês).
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

    PERFORM cron.unschedule('cvm-acoes-mensal')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cvm-acoes-mensal');

    PERFORM cron.schedule(
        'cvm-acoes-mensal',
        '0 9 5 * *',
        $cron$
        SELECT net.http_post(
            url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_cvm_acoes_cron'),
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
            ),
            body    := '{}'::jsonb,
            -- Baixa+descompacta+parseia 2 ZIPs (FCA + DFP) com o ano inteiro
            -- de todas as companhias abertas — maior que o de FII, folga maior.
            timeout_milliseconds := 120000
        );
        $cron$
    );
    RAISE NOTICE 'Agendamento "cvm-acoes-mensal" criado (09:00 UTC = 06:00 BRT, todo dia 5 do mês).';
END $$;
