-- Temporário — lê net._http_response pra ver o que de fato aconteceu com a
-- chamada disparada na migration anterior (20261006000102). Removido em
-- seguida.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, status_code, content_type, left(content, 500) AS content_preview,
           error_msg, created
    FROM net._http_response
    ORDER BY id DESC
    LIMIT 5
  LOOP
    INSERT INTO arqvalor.cron_execucoes (job_nome, status, resumo)
    VALUES ('debug-http-response', 'sucesso', jsonb_build_object(
      'id', r.id, 'status_code', r.status_code, 'content_type', r.content_type,
      'content_preview', r.content_preview, 'error_msg', r.error_msg, 'created', r.created
    ));
  END LOOP;
END $$;
