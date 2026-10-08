-- ============================================================
-- Job de saúde dos crons — fecha um ponto cego real encontrado em produção
-- (ago/2026): rendimento-cripto-diario ficou falhando TODO DIA por pelo
-- menos 9 dias (secret edge_url_rendimento_cripto_cron ausente do Vault)
-- sem UMA linha sequer em arqvalor.cron_execucoes — porque a falha acontece
-- em cron.job_run_details (pg_cron tentando montar a chamada via pg_net,
-- URL nula) ANTES da Edge Function ser invocada. executarComLogDeCron()
-- só grava DE DENTRO da function — nunca chegou a rodar, nunca logou nada.
--
-- Este job lê cron.job_run_details (log nativo do pg_cron, já existe,
-- independente de tudo que construímos) e replica qualquer falha das
-- últimas ~26h pra arqvalor.cron_execucoes — mesma tabela/tela (/admin/crons)
-- que já existe, sem lugar novo pra olhar. Dedup por (job_nome,
-- executado_em) — não gera linha duplicada se o próprio job rodar de novo
-- numa janela que já cobriu aquela falha.
--
-- De propósito, SQL PURO (sem pg_net/Vault) — não queremos que o job que
-- detecta "cron não conseguiu nem começar por causa do pg_net/Vault" tenha
-- a MESMA classe de dependência frágil. Mesmo padrão de
-- trilha-auditoria-purge-diario.
--
-- Idempotente: CREATE OR REPLACE, DO/EXCEPTION.
-- ============================================================

-- ── Aviso de login pros admins ──────────────────────────────────
-- "Visto até": cada admin dispensa por conta própria (não é uma coluna
-- system-wide) — comparação client-side entre isso e cron_execucoes.status
-- = 'erro' decide o que é novidade pra aquele admin. NULL = nunca visto
-- ainda (o frontend trata como "últimos 7 dias" pra não despejar o
-- histórico inteiro na primeira vez que a coluna existir).
ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS cron_avisos_vistos_em TIMESTAMPTZ;

COMMENT ON COLUMN arqvalor.usuarios.cron_avisos_vistos_em IS
    'Timestamp até onde este admin já viu os avisos de falha de cron '
    '(cron_execucoes.status = erro) — exibidos como notificação no login.';

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

-- ── Agendamento (pg_cron, sem pg_net — SQL puro) ────────────────
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron: habilite pelas Extensions do Dashboard (%).', SQLERRM;
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente — agendamento NÃO criado. Reexecute após habilitar.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('cron-saude-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-saude-diario');

  -- 11:00 UTC = 08:00 BRT — depois de todos os outros crons do dia
  -- (05h/06h/06h30/07h/07h30 BRT), pra já pegar qualquer falha da manhã.
  PERFORM cron.schedule(
    'cron-saude-diario',
    '0 11 * * *',
    $cron$SELECT arqvalor.fn_verificar_saude_cron();$cron$
  );
  RAISE NOTICE 'Agendamento "cron-saude-diario" criado (11:00 UTC = 08:00 BRT, diário).';
END $$;

-- Roda uma vez agora — já reporta as falhas recentes existentes (ex.: o
-- rendimento-cripto-diario que ficou sem secret até hoje) sem esperar até
-- amanhã de manhã.
DO $$ BEGIN
  PERFORM arqvalor.fn_verificar_saude_cron();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Verificação inicial de saúde do cron não executada: %', SQLERRM;
END $$;
