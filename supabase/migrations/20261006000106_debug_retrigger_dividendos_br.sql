-- Temporário — redispara dividendos-cron-br após instrumentar
-- dispararContinuacaoCron (grava o resultado do fetch de auto-continuação
-- em cron_execucoes). Removido junto com a limpeza final.
DO $$
DECLARE
  v_id  BIGINT;
  v_url TEXT;
BEGIN
  v_url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_dividendos_cron_br');
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_id;
END $$;
