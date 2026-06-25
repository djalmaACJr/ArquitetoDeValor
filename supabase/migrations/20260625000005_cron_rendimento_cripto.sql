-- ============================================================
-- Job diário: materializa o rendimento (yield) das criptomoedas com
-- cripto_rendimento_aa > 0 como operações RENDIMENTO (mais tokens, custo
-- zero), para TODOS os usuários. Chama a Edge Function `investimentos` na
-- rota /rendimento-cripto-cron via pg_cron + pg_net.
--
-- A rota /rendimento-cripto-cron NÃO usa JWT de usuário: roda via
-- service_role e é protegida SÓ pelo secret CRON_SECRET (header
-- x-cron-secret). A função `investimentos` está com verify_jwt=false no
-- config.toml, então o gateway não exige JWT — a chamada só precisa do header:
--   • x-cron-secret: <CRON_SECRET>   (validação da própria função)
--
-- PRÉ-REQUISITOS (uma vez, no projeto Supabase):
--   1) Habilitar as extensões pg_cron e pg_net (Dashboard → Database →
--      Extensions). Já habilitadas se os crons de dividendos rodam.
--   2) Secret já existente: CRON_SECRET (mesmo dos jobs de dividendos).
--   3) Guardar no Vault (Dashboard → Database → Vault), com EXATAMENTE
--      estes nomes:
--        edge_url_rendimento_cripto_cron =
--          https://<PROJECT_REF>.supabase.co/functions/v1/investimentos/rendimento-cripto-cron
--        cron_secret                     = <o MESMO valor do CRON_SECRET>   (já existe)
--
-- Horário: 10:00 UTC = 07:00 BRT, todos os dias (depois dos crons de
-- dividendos para não disputar recursos). Ajuste o cron se quiser outro.
--
-- Idempotente: tudo em DO/EXCEPTION; se extensões/Vault ainda não
-- estiverem prontos, a migration NÃO falha — só emite aviso e você
-- reexecuta o agendamento depois.
-- ============================================================

DO $$
BEGIN
  -- Extensões (no-op se já existirem; ignora se faltar permissão)
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

  -- Idempotência: remove o agendamento anterior, se existir
  PERFORM cron.unschedule('rendimento-cripto-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rendimento-cripto-diario');

  -- Agenda: 10:00 UTC todos os dias (= 07:00 BRT). Lê URL/secret do Vault
  -- em tempo de execução (nada sensível fica neste arquivo).
  PERFORM cron.schedule(
    'rendimento-cripto-diario',
    '0 10 * * *',
    $cron$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_rendimento_cripto_cron'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      body    := '{}'::jsonb
    );
    $cron$
  );
  RAISE NOTICE 'Agendamento "rendimento-cripto-diario" criado (10:00 UTC = 07:00 BRT, diário).';
END $$;
