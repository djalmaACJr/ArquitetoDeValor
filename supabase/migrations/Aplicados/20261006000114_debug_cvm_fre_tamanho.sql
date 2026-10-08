-- Temporário — checa o tamanho (content-length via HEAD) dos ZIPs do FRE
-- (ano corrente e anterior) antes de arriscar um download completo. FRE é
-- descrito como bem maior que FCA/DFP, que já estouraram
-- WORKER_RESOURCE_LIMIT quando baixados em paralelo. Removido junto com a
-- limpeza final.
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
    body    := jsonb_build_object('debug_fre_tamanho', true),
    timeout_milliseconds := 60000
  ) INTO v_id;
END $$;
