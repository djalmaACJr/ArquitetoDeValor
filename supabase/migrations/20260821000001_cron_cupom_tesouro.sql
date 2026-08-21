-- ============================================================
-- Job diário: provisiona pagamento de CUPOM SEMESTRAL de títulos do Tesouro
-- Direto "com Juros Semestrais", para TODOS os usuários. Fonte: Tesouro
-- Transparente/STN (CSV público de pagamento de cupons — mesma proveniência
-- do CSV de PU já usado pra marcação a mercado). Chama a Edge Function
-- `investimentos` na rota /cupom-tesouro-cron via pg_cron + pg_net.
--
-- Só processa eventos FUTUROS (>= hoje) — sem janela retroativa, ao
-- contrário dos crons de dividendos de ações. Motivo (pedido explícito do
-- usuário): cupons já pagos no passado o usuário já lança/lançou na mão;
-- reconciliar retroativamente aqui arriscaria sobrescrever correção manual.
-- Ver comentário completo em provisionarCupomTesouro (dividendos.ts).
--
-- A rota /cupom-tesouro-cron NÃO usa JWT de usuário: roda via service_role e
-- é protegida SÓ pelo secret CRON_SECRET (header x-cron-secret) — mesmo
-- padrão dos outros 4 crons de investimentos.
--
-- PRÉ-REQUISITOS (uma vez, no projeto Supabase):
--   1) Extensões pg_cron e pg_net já habilitadas (se os outros crons rodam).
--   2) Secret já existente: CRON_SECRET.
--   3) Guardar no Vault (Dashboard → Database → Vault), com EXATAMENTE
--      este nome (os outros dois — cron_secret e o restante — já existem):
--        edge_url_cupom_tesouro_cron =
--          https://<PROJECT_REF>.supabase.co/functions/v1/investimentos/cupom-tesouro-cron
--
-- Horário: 10:30 UTC = 07:30 BRT, todos os dias (depois dos outros 4 crons
-- de investimentos, pra não disputar recursos). Ajuste se quiser outro.
--
-- Idempotente: tudo em DO/EXCEPTION; se extensões/Vault ainda não
-- estiverem prontos, a migration NÃO falha — só emite aviso e você
-- reexecuta o agendamento depois.
-- ============================================================

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

  PERFORM cron.unschedule('cupom-tesouro-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cupom-tesouro-diario');

  PERFORM cron.schedule(
    'cupom-tesouro-diario',
    '30 10 * * *',
    $cron$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_cupom_tesouro_cron'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    $cron$
  );
  RAISE NOTICE 'Agendamento "cupom-tesouro-diario" criado (10:30 UTC = 07:30 BRT, diário).';
END $$;
