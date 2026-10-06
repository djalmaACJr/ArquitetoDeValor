-- Temporário — dispara o dividendos-cron-br já com o batching novo
-- (self-chaining por grupo de usuários) pra validar que completa sem
-- estourar o limite de recursos. Removido em seguida junto com a leitura.
DO $$
DECLARE
  v_id    BIGINT;
  v_url   TEXT;
  v_total INT;
BEGIN
  SELECT count(DISTINCT user_id) INTO v_total
  FROM arqvalor.inv_ativos
  WHERE moeda = 'BRL' AND tipo_ativo IN ('ACOES','ETF','FII');

  v_url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_url_dividendos_cron_br');

  INSERT INTO arqvalor.cron_execucoes (job_nome, status, resumo)
  VALUES ('debug-lote-info', 'sucesso', jsonb_build_object('total_usuarios_brl', v_total, 'url', v_url));

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
  VALUES ('debug-trigger-dividendos-br-lote', 'sucesso', jsonb_build_object('request_id', v_id));
END $$;
