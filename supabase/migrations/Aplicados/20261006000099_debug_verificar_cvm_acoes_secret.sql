-- Temporário — dispara manualmente o mesmo net.http_post do cron
-- cvm-acoes-mensal, só pra confirmar que o secret recém-criado resolve a
-- URL corretamente (sem esperar o agendamento de dia 5). Removido logo em
-- seguida por uma migration de limpeza, mesmo padrão de
-- 20261004000099/20261004000100 usado antes nesta sessão.
DO $$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_cvm_acoes_cron'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_id;
  RAISE NOTICE 'net.http_post enfileirado com id=%', v_id;
END $$;
