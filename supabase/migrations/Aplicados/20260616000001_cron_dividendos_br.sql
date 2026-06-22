-- ============================================================
-- Job diário: provisiona proventos FUTUROS de ativos em BRL
-- (ACOES / ETF / FII) a partir dos dados PÚBLICOS e GRATUITOS da B3.
-- Chama a Edge Function `investimentos` na rota /dividendos-cron-br
-- via pg_cron + pg_net.
--
-- Cron SEPARADO do job de USD (dividendos-diario / Polygon): isola
-- falhas e limites de cada fonte. A rota /dividendos-cron-br NÃO usa
-- JWT de usuário: roda via service_role e é protegida SÓ pelo secret
-- CRON_SECRET (header x-cron-secret). A função `investimentos` está
-- com verify_jwt=false no config.toml, então o gateway não exige JWT —
-- a chamada só precisa do header:
--   • x-cron-secret: <CRON_SECRET>   (validação da própria função)
--
-- A B3 NÃO exige API key, então NÃO há secret novo a configurar.
--
-- PRÉ-REQUISITOS (uma vez, no projeto Supabase):
--   1) Habilitar as extensões pg_cron e pg_net (Dashboard → Database →
--      Extensions). Já habilitadas se o snapshot-diario está rodando.
--   2) Secret já existente: CRON_SECRET (mesmo do job de USD).
--   3) Guardar no Vault (Dashboard → Database → Vault), com EXATAMENTE
--      estes nomes:
--        edge_url_dividendos_cron_br =
--          https://<PROJECT_REF>.supabase.co/functions/v1/investimentos/dividendos-cron-br
--        cron_secret                 = <o MESMO valor do CRON_SECRET>   (já existe)
--
-- Horário: 09:30 UTC = 06:30 BRT, todos os dias (30 min depois do job
-- de USD para não disputar recursos). Ajuste o cron se quiser outro.
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
  PERFORM cron.unschedule('dividendos-br-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dividendos-br-diario');

  -- Agenda: 09:30 UTC todos os dias (= 06:30 BRT). Lê URL/secret do Vault
  -- em tempo de execução (nada sensível fica neste arquivo).
  PERFORM cron.schedule(
    'dividendos-br-diario',
    '30 9 * * *',
    $cron$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_dividendos_cron_br'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      body    := '{}'::jsonb
    );
    $cron$
  );
  RAISE NOTICE 'Agendamento "dividendos-br-diario" criado (09:30 UTC = 06:30 BRT, diário).';
END $$;
