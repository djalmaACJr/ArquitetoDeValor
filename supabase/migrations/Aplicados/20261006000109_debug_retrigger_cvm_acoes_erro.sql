-- Temporário — redispara cvm-acoes-cron com captura de erro de fetch
-- exposta na resposta (cron_execucoes.resumo.erro_fetch_debug).
-- Removido junto com a limpeza final.
DO $$
DECLARE
  v_id  BIGINT;
  v_url TEXT;
BEGIN
  v_url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_cvm_acoes_cron');
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  ) INTO v_id;
END $$;
