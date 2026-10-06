-- Temporário — investiga onde ficou a Quantidade_Total_Acoes no FCA 2026
-- (fca_cia_aberta_capital_social_<ano>.csv sumiu do ZIP). Baixa o ZIP real
-- e devolve só o cabeçalho (1ª linha) dos CSVs candidatos. Removido junto
-- com a limpeza final.
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
    body    := jsonb_build_object('debug_listar_cabecalhos', true),
    timeout_milliseconds := 60000
  ) INTO v_id;
END $$;
