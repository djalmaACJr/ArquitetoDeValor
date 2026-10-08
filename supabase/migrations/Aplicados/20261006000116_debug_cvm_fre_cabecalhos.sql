-- Temporário — inspeciona cabeçalho + 1 linha de amostra dos CSVs mais
-- promissores do FRE (capital social, classe de ação, distribuição de
-- capital/free float, posição acionária, partes relacionadas) pra avaliar
-- quais indicadores novos dá pra extrair. Removido junto com a limpeza
-- final.
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
    body    := jsonb_build_object('debug_fre_cabecalhos', true),
    timeout_milliseconds := 60000
  ) INTO v_id;
END $$;
