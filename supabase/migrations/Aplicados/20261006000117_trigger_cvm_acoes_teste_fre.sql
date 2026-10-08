-- Trigger de teste pro fix real: cvm-acoes-mensal agora usa
-- fre_cia_aberta_capital_social_<ano>.csv (FRE) em vez do extinto
-- fca_cia_aberta_capital_social_<ano>.csv (FCA) pra nº total de ações.
-- Removido junto com a limpeza final (só o disparo, não é DDL).
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
