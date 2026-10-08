-- Temporário — dispara manualmente o mesmo net.http_post do cron
-- dividendos-br-diario, pra diagnosticar por que parou de gerar linhas em
-- cron_execucoes desde 02/10. Removido em seguida.
DO $$
DECLARE
  v_id  BIGINT;
  v_url TEXT;
BEGIN
  v_url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_dividendos_cron_br');
  INSERT INTO arqvalor.cron_execucoes (job_nome, status, resumo)
  VALUES ('debug-url-dividendos-br', 'sucesso', jsonb_build_object('url', v_url));

  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_id;

  INSERT INTO arqvalor.cron_execucoes (job_nome, status, resumo)
  VALUES ('debug-trigger-dividendos-br', 'sucesso', jsonb_build_object('request_id', v_id));
END $$;
