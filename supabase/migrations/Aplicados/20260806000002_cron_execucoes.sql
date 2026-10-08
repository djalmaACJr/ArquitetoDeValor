-- ============================================================
-- cron_execucoes — histórico de execução dos 4 cron jobs do sistema
-- (dividendos-diario, dividendos-br-diario, snapshot-diario,
-- rendimento-cripto-diario).
--
-- Motivação (auditoria 2026-08-06): o job dividendos-diario ficou 19 dias
-- falhando 100% das vezes (segredo de URL ausente no Vault, depois timeout
-- curto demais) sem NENHUM sinal em lugar nenhum que um usuário pudesse
-- checar — só apareceu porque um usuário notou dividendos faltando e foi
-- investigado manualmente via SQL/Logs Explorer. Esta tabela é o registro
-- que faltava, gravado pela própria Edge Function a cada execução (sucesso
-- OU erro), consultável pela tela /admin/crons no frontend.
--
-- Sem user_id: não é dado de usuário, é metadado operacional do sistema
-- (mesma categoria de app_releases). RLS restringe leitura a quem tem
-- usuarios.admin = true — a única fonte da verdade de quem é admin.
-- Escrita só via service_role (dbAdmin(), chamado de dentro da própria
-- Edge Function após cada execução de cron) — nunca pela API pública.
--
-- Idempotente: CREATE TABLE/POLICY/INDEX IF NOT EXISTS, DO/EXCEPTION.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.cron_execucoes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_nome     TEXT        NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('sucesso', 'erro')),
  resumo       JSONB,
  erro         TEXT,
  duracao_ms   INTEGER,
  executado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_execucoes_job_data
  ON arqvalor.cron_execucoes(job_nome, executado_em DESC);

ALTER TABLE arqvalor.cron_execucoes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY cron_execucoes_admin_select ON arqvalor.cron_execucoes
    FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM arqvalor.usuarios u
      WHERE u.id = auth.uid() AND u.admin = true
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sem policy de INSERT/UPDATE/DELETE para anon/authenticated — só
-- service_role (dbAdmin, que ignora RLS) grava, a partir da própria
-- Edge Function logo após cada execução de cron.
GRANT SELECT ON arqvalor.cron_execucoes TO authenticated;
