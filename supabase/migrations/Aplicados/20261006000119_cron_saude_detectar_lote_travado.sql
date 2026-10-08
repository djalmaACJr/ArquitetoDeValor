-- ============================================================
-- Estende fn_verificar_saude_cron() pra fechar um 2º ponto cego, irmão do
-- que a migration 20260821000002 já fechou:
--
-- - 20260821000002 detecta falha ANTES da Edge Function ser invocada
--   (secret ausente no Vault, pg_net nem consegue montar a chamada).
-- - ESTA migration detecta falha DEPOIS da Edge Function ser invocada, mas
--   NO MEIO de uma cadeia de self-chaining em lote (dispararContinuacaoCron,
--   ver _shared/utils.ts) — ex.: um lote do dividendos-br-diario/
--   dividendos-diario trava por WORKER_RESOURCE_LIMIT/timeout e nunca
--   dispara o próximo. A invocação que travou morre sem rodar seu próprio
--   catch (worker morto não termina graciosamente), então nem
--   executarComLogDeCron() grava nada pra ELA — mas o lote ANTERIOR já
--   tinha gravado com sucesso, com `resumo.lote.tem_mais = true`. Esse
--   "true" nunca vira "false" se a cadeia parou ali.
--
-- Achado real (out/2026): dividendos-br-diario ficou travado assim de
-- 02/10 a 05/10 (travava já no 1º lote, por um bug de URL diferente, hoje
-- corrigido) — nenhum dos dois pontos cegos cobria esse caso até agora.
--
-- Detecção: pega a ÚLTIMA linha de cada job que já usou o padrão de lote
-- (resumo tem a chave "lote") e verifica se `tem_mais = true` há mais de
-- 2h (bem acima do intervalo normal entre lotes, que é de segundos a
-- poucos minutos — ver histórico real: ~30-90s entre lotes do
-- dividendos-br-diario). Dedup: no máximo 1 alerta por job por dia.
--
-- Genérico de propósito (não hardcoda nomes de job) — qualquer cron futuro
-- que adote o padrão de `dispararContinuacaoCron` fica coberto de graça.
--
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_verificar_saude_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_encontradas INTEGER := 0;
  v_inicio      TIMESTAMPTZ := clock_timestamp();
  r             RECORD;
BEGIN
  -- ── Ponto cego 1 (20260821000002): falha ANTES da Edge Function ──────
  FOR r IN
    SELECT j.jobname, d.start_time, d.return_message
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
    WHERE d.status = 'failed'
      AND d.start_time >= now() - interval '26 hours'
      AND j.jobname <> 'cron-saude-diario' -- não reporta falha de si mesmo (evita loop)
  LOOP
    -- Dedup: mesma falha (job + instante exato) já reportada antes não gera
    -- linha nova, mesmo que a janela de 26h se sobreponha entre execuções.
    IF NOT EXISTS (
      SELECT 1 FROM arqvalor.cron_execucoes
      WHERE job_nome = r.jobname AND status = 'erro' AND executado_em = r.start_time
    ) THEN
      INSERT INTO arqvalor.cron_execucoes (job_nome, status, erro, executado_em)
      VALUES (
        r.jobname, 'erro',
        'Falha ANTES de chegar na Edge Function (pg_cron/pg_net) — detectado por cron-saude-diario: '
          || left(r.return_message, 1500),
        r.start_time
      );
      v_encontradas := v_encontradas + 1;
    END IF;
  END LOOP;

  -- ── Ponto cego 2 (esta migration): cadeia de lotes travada no meio ────
  FOR r IN
    SELECT t.job_nome, t.executado_em, t.resumo
    FROM (
      SELECT job_nome, executado_em, resumo,
             row_number() OVER (PARTITION BY job_nome ORDER BY executado_em DESC) AS rn
      FROM arqvalor.cron_execucoes
      WHERE job_nome NOT LIKE 'debug-%' AND resumo ? 'lote'
    ) t
    WHERE t.rn = 1
      AND (t.resumo -> 'lote' ->> 'tem_mais') = 'true'
      AND t.executado_em < now() - interval '2 hours'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM arqvalor.cron_execucoes
      WHERE job_nome = r.job_nome AND status = 'erro'
        AND executado_em::date = CURRENT_DATE
        AND erro LIKE 'Cadeia de lotes travada%'
    ) THEN
      INSERT INTO arqvalor.cron_execucoes (job_nome, status, erro)
      VALUES (
        r.job_nome,
        'erro',
        format(
          'Cadeia de lotes travada (self-chaining nunca completou) — '
            || 'último lote processado em %s, offset %s de %s, "tem_mais" ainda true. '
            || 'Provável timeout/WORKER_RESOURCE_LIMIT no lote seguinte. Detectado por cron-saude-diario.',
          r.executado_em,
          coalesce(r.resumo -> 'lote' ->> 'offset', '?'),
          coalesce(r.resumo -> 'lote' ->> 'total_usuarios', r.resumo -> 'lote' ->> 'tamanho', '?')
        )
      );
      v_encontradas := v_encontradas + 1;
    END IF;
  END LOOP;

  INSERT INTO arqvalor.cron_execucoes (job_nome, status, resumo, duracao_ms)
  VALUES (
    'cron-saude-diario', 'sucesso',
    jsonb_build_object('falhas_detectadas', v_encontradas),
    GREATEST(EXTRACT(MILLISECONDS FROM clock_timestamp() - v_inicio)::INTEGER, 0)
  );
EXCEPTION WHEN OTHERS THEN
  INSERT INTO arqvalor.cron_execucoes (job_nome, status, erro, duracao_ms)
  VALUES (
    'cron-saude-diario', 'erro', SQLERRM,
    GREATEST(EXTRACT(MILLISECONDS FROM clock_timestamp() - v_inicio)::INTEGER, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_verificar_saude_cron() FROM PUBLIC, anon, authenticated;
