-- ============================================================
-- Job diário: captura do valor de mercado (snapshot-auto) para TODOS os
-- usuários, ao fim do dia. Chama a Edge Function `investimentos` na rota
-- /snapshot-cron via pg_cron + pg_net.
--
-- A rota /snapshot-cron NÃO usa JWT de usuário: roda via service_role e é
-- protegida SÓ pelo secret CRON_SECRET (header x-cron-secret). Como a função
-- está com verify_jwt=false no config.toml, o gateway não exige JWT — então
-- a chamada só precisa do header:
--   • x-cron-secret: <CRON_SECRET>   (validação da própria função)
--
-- PRÉ-REQUISITOS (uma vez, no projeto Supabase):
--   1) Habilitar as extensões pg_cron e pg_net (Dashboard → Database →
--      Extensions, ou os CREATE EXTENSION abaixo se você tiver permissão).
--   2) Definir o secret da Edge Function:
--        supabase secrets set CRON_SECRET=<uma_string_aleatoria_forte>
--   3) Guardar 2 segredos no Vault (Dashboard → Database → Vault), com
--      EXATAMENTE estes nomes:
--        edge_url_snapshot_cron =
--          https://<PROJECT_REF>.supabase.co/functions/v1/investimentos/snapshot-cron
--        cron_secret            = <o MESMO valor do CRON_SECRET acima>
--
-- Horário: 01:00 UTC = 22:00 BRT (após o fechamento da B3), apenas em
-- DIAS ÚTEIS. Como 22:00 BRT cai no dia seguinte em UTC, "seg–sex BRT"
-- vira "ter–sáb UTC" → cron `0 1 * * 2-6`. Ajuste se quiser outro horário.
--
-- Tudo é guardado em bloco DO/EXCEPTION: se as extensões/Vault ainda não
-- estiverem prontos, a migration NÃO falha — só emite um aviso e você
-- reexecuta o agendamento depois (este arquivo é idempotente).
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

  -- Só agenda se o pg_cron estiver disponível
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente — agendamento NÃO criado. Reexecute após habilitar.';
    RETURN;
  END IF;

  -- Idempotência: remove o agendamento anterior, se existir
  PERFORM cron.unschedule('snapshot-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-diario');

  -- Agenda: 01:00 UTC em dias úteis (= 22:00 BRT seg–sex). Lê URL/keys do
  -- Vault em tempo de execução (nada sensível fica neste arquivo).
  PERFORM cron.schedule(
    'snapshot-diario',
    '0 1 * * 2-6',
    $cron$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_snapshot_cron'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      body    := '{}'::jsonb
    );
    $cron$
  );
  RAISE NOTICE 'Agendamento "snapshot-diario" criado (01:00 UTC ter–sáb = 22:00 BRT seg–sex).';
END $$;
