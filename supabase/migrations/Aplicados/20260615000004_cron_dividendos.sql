-- ============================================================
-- Job diário: provisiona proventos FUTUROS de ativos em USD a partir
-- da Polygon.io, para TODOS os usuários. Chama a Edge Function
-- `investimentos` na rota /dividendos-cron via pg_cron + pg_net.
--
-- A rota /dividendos-cron NÃO usa JWT de usuário: roda via service_role
-- e é protegida SÓ pelo secret CRON_SECRET (header x-cron-secret). A
-- função está com verify_jwt=false no config.toml, então o gateway não
-- exige JWT — a chamada só precisa do header:
--   • x-cron-secret: <CRON_SECRET>   (validação da própria função)
--
-- PRÉ-REQUISITOS (uma vez, no projeto Supabase):
--   1) Habilitar as extensões pg_cron e pg_net (Dashboard → Database →
--      Extensions). Já habilitadas se o snapshot-diario está rodando.
--   2) Definir os secrets da Edge Function:
--        supabase secrets set CRON_SECRET=<string_aleatoria_forte>     (já existe)
--        supabase secrets set POLYGON_API_KEY=<sua_api_key_da_polygon>
--   3) Guardar no Vault (Dashboard → Database → Vault), com EXATAMENTE
--      estes nomes:
--        edge_url_dividendos_cron =
--          https://<PROJECT_REF>.supabase.co/functions/v1/investimentos/dividendos-cron
--        cron_secret              = <o MESMO valor do CRON_SECRET>   (já existe)
--
-- Horário: 09:00 UTC = 06:00 BRT, todos os dias (proventos pagam em
-- qualquer dia útil; rodar de manhã folga no limite de 5 req/min da
-- Polygon). Ajuste o cron se quiser outro horário.
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
  PERFORM cron.unschedule('dividendos-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dividendos-diario');

  -- Agenda: 09:00 UTC todos os dias (= 06:00 BRT). Lê URL/keys do Vault
  -- em tempo de execução (nada sensível fica neste arquivo).
  PERFORM cron.schedule(
    'dividendos-diario',
    '0 9 * * *',
    $cron$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_dividendos_cron'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      body    := '{}'::jsonb
    );
    $cron$
  );
  RAISE NOTICE 'Agendamento "dividendos-diario" criado (09:00 UTC = 06:00 BRT, diário).';
END $$;
