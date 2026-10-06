-- Temporário — grava a listagem de cron.job em cron_execucoes (consultável
-- via REST), já que RAISE NOTICE não aparece na saída de `supabase db push`
-- e `cron`/`vault` não são schemas expostos via PostgREST. Removido em
-- seguida por uma migration de limpeza.
INSERT INTO arqvalor.cron_execucoes (job_nome, status, resumo)
SELECT 'debug-listagem-cron-jobs', 'sucesso',
  jsonb_agg(jsonb_build_object('jobid', jobid, 'jobname', jobname, 'schedule', schedule, 'active', active) ORDER BY jobname)
FROM cron.job;
