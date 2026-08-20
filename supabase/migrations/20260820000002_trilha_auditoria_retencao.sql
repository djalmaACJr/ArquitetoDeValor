-- ============================================================
-- Retenção rotativa da trilha de auditoria
--
-- trilha_auditoria (20260806000004 + 20260820000001) é append-only e agora
-- cobre quase todo o sistema — sem expurgo ela cresce pra sempre. Esta
-- migration adiciona um período de retenção configurável (padrão 1 ano) e
-- um job diário que apaga linhas mais antigas que o período configurado.
--
-- Diferente dos outros cron jobs do sistema (dividendos/snapshot/rendimento
-- cripto), este NÃO chama uma Edge Function via pg_net — a purga é só um
-- DELETE por data, não precisa de fonte externa nem lógica em Deno. Roda
-- direto no Postgres via pg_cron, mais simples e sem dependência de Vault.
--
-- Config em tabela (não em Vault/env) de propósito: precisa ser editável
-- pelo admin em tempo de execução, sem redeploy — GET/PUT /auditoria/config
-- na Edge Function `auditoria`.
--
-- Idempotente: CREATE TABLE/POLICY IF NOT EXISTS, DO/EXCEPTION, ON CONFLICT.
-- ============================================================

-- ── Config (tabela singleton, 1 linha fixa id=1) ───────────────
CREATE TABLE IF NOT EXISTS arqvalor.config_auditoria (
  id             SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  retencao_dias  INTEGER     NOT NULL DEFAULT 365 CHECK (retencao_dias BETWEEN 30 AND 3650),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por UUID        REFERENCES arqvalor.usuarios(id) ON DELETE SET NULL
);

INSERT INTO arqvalor.config_auditoria (id, retencao_dias)
VALUES (1, 365)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE arqvalor.config_auditoria ENABLE ROW LEVEL SECURITY;

-- Só admin lê/edita — é um parâmetro operacional do sistema, não dado do
-- usuário comum. Mesmo padrão EXISTS(...) de cron_execucoes/trilha_auditoria.
DO $$ BEGIN
  CREATE POLICY config_auditoria_admin_select ON arqvalor.config_auditoria
    FOR SELECT
    USING (EXISTS (SELECT 1 FROM arqvalor.usuarios u WHERE u.id = auth.uid() AND u.admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY config_auditoria_admin_update ON arqvalor.config_auditoria
    FOR UPDATE
    USING     (EXISTS (SELECT 1 FROM arqvalor.usuarios u WHERE u.id = auth.uid() AND u.admin = true))
    WITH CHECK(EXISTS (SELECT 1 FROM arqvalor.usuarios u WHERE u.id = auth.uid() AND u.admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sem policy de INSERT/DELETE para ninguém — é singleton, a linha já nasce
-- semeada acima e nunca é recriada/apagada pela API.
GRANT SELECT, UPDATE ON arqvalor.config_auditoria TO authenticated;

-- ── Função de purga ─────────────────────────────────────────────
-- Lê o período configurado (ou 365 dias, se a config sumir por algum
-- motivo) e apaga trilha_auditoria mais antiga que isso. Registra o
-- resultado em cron_execucoes — reaproveita a mesma tabela/tela
-- (/admin/crons) que os outros 4 jobs já usam, em vez de criar observabilidade
-- paralela. SECURITY DEFINER: roda como dono da função (bypassa RLS tanto de
-- config_auditoria quanto de trilha_auditoria, que não tem policy de DELETE
-- pra ninguém — só esta função apaga linhas antigas).
CREATE OR REPLACE FUNCTION arqvalor.fn_purgar_trilha_auditoria()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_retencao_dias INTEGER;
  v_removidos     BIGINT;
  v_inicio        TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT retencao_dias INTO v_retencao_dias FROM arqvalor.config_auditoria WHERE id = 1;
  IF v_retencao_dias IS NULL THEN v_retencao_dias := 365; END IF;

  DELETE FROM arqvalor.trilha_auditoria
   WHERE alterado_em < now() - (v_retencao_dias || ' days')::interval;
  GET DIAGNOSTICS v_removidos = ROW_COUNT;

  INSERT INTO arqvalor.cron_execucoes (job_nome, status, resumo, duracao_ms)
  VALUES (
    'trilha-auditoria-purge-diario', 'sucesso',
    jsonb_build_object('removidos', v_removidos, 'retencao_dias', v_retencao_dias),
    GREATEST(EXTRACT(MILLISECONDS FROM clock_timestamp() - v_inicio)::INTEGER, 0)
  );
EXCEPTION WHEN OTHERS THEN
  INSERT INTO arqvalor.cron_execucoes (job_nome, status, erro, duracao_ms)
  VALUES (
    'trilha-auditoria-purge-diario', 'erro', SQLERRM,
    GREATEST(EXTRACT(MILLISECONDS FROM clock_timestamp() - v_inicio)::INTEGER, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_purgar_trilha_auditoria() FROM PUBLIC, anon, authenticated;

-- ── Agendamento (pg_cron, sem pg_net — SQL puro) ────────────────
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron: habilite pelas Extensions do Dashboard (%).', SQLERRM;
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente — agendamento de purga NÃO criado. Reexecute após habilitar.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('trilha-auditoria-purge-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trilha-auditoria-purge-diario');

  -- 08:00 UTC = 05:00 BRT, todos os dias — fora do horário dos outros crons
  -- (06h/06h30/07h BRT), sem disputar recursos com eles.
  PERFORM cron.schedule(
    'trilha-auditoria-purge-diario',
    '0 8 * * *',
    $cron$SELECT arqvalor.fn_purgar_trilha_auditoria();$cron$
  );
  RAISE NOTICE 'Agendamento "trilha-auditoria-purge-diario" criado (08:00 UTC = 05:00 BRT, diário).';
END $$;

-- Roda uma vez agora — confirma que a função funciona e já aplica o
-- período padrão a qualquer dado pré-existente que porventura já esteja
-- fora da retenção. Não crítico: se falhar (ex.: pg_cron indisponível no
-- ambiente), a migration não quebra por causa disso.
DO $$ BEGIN
  PERFORM arqvalor.fn_purgar_trilha_auditoria();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Purga inicial da trilha de auditoria não executada: %', SQLERRM;
END $$;
