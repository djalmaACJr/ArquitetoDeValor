-- Temporário — dispara cvm-acoes-cron já com a correção de sequenciar os
-- downloads/parses dos ZIPs (FCA depois DFP, e os 4 CSVs do DFP um a um)
-- em vez de Promise.all, pra validar se resolve o WORKER_RESOURCE_LIMIT.
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
    timeout_milliseconds := 120000
  ) INTO v_id;
END $$;
