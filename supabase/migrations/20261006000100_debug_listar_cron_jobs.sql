-- Temporário — lista todos os jobs atualmente agendados no pg_cron, pra
-- auditar se algum sumiu do agendamento (diferente de "falhou ao rodar",
-- que é o que cron-saude-diario já cobre). Removido em seguida.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname LOOP
    RAISE NOTICE '% | % | schedule=% | active=%', r.jobid, r.jobname, r.schedule, r.active;
  END LOOP;
END $$;
