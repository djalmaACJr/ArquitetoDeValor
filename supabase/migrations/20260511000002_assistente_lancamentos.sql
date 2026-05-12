-- Migration: Assistente de Lançamentos
-- Armazena "lançamentos padrão" do usuário para sugestão automática:
-- dado um termo digitado na descrição, retorna o registro com descrição
-- mais semelhante e atualizado_em mais recente, com categoria/conta/par de
-- transferência pré-cadastrados.

CREATE TABLE IF NOT EXISTS arqvalor.assistente_lancamentos (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES arqvalor.usuarios(id) ON DELETE CASCADE,
  descricao         TEXT        NOT NULL CHECK (char_length(descricao) BETWEEN 2 AND 200),
  categoria_id      UUID                 REFERENCES arqvalor.categorias(id) ON DELETE SET NULL,
  conta_origem_id   UUID                 REFERENCES arqvalor.contas(id)     ON DELETE SET NULL,
  conta_destino_id  UUID                 REFERENCES arqvalor.contas(id)     ON DELETE SET NULL,
  is_transferencia  BOOLEAN     NOT NULL DEFAULT FALSE,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Coerência: par de contas obrigatório quando transferência.
  CONSTRAINT chk_assistente_transf
    CHECK (
      (is_transferencia = FALSE)
      OR (is_transferencia = TRUE AND conta_origem_id IS NOT NULL AND conta_destino_id IS NOT NULL AND conta_origem_id <> conta_destino_id)
    )
);

-- Uniqueness por usuário + descrição (case-insensitive) — base do upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assistente_user_descricao
  ON arqvalor.assistente_lancamentos (user_id, lower(descricao));

-- Busca por LIKE com prefixo: índice em lower(descricao) acelera substring.
CREATE INDEX IF NOT EXISTS idx_assistente_user_descricao_trgm
  ON arqvalor.assistente_lancamentos (user_id, lower(descricao));

CREATE INDEX IF NOT EXISTS idx_assistente_user_atualizado
  ON arqvalor.assistente_lancamentos (user_id, atualizado_em DESC);

ALTER TABLE arqvalor.assistente_lancamentos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'arqvalor'
      AND tablename  = 'assistente_lancamentos'
      AND policyname = 'assistente_user_isolado'
  ) THEN
    CREATE POLICY assistente_user_isolado ON arqvalor.assistente_lancamentos
      USING      (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Trigger para manter atualizado_em.
DROP TRIGGER IF EXISTS trg_assistente_atualizado_em ON arqvalor.assistente_lancamentos;
CREATE TRIGGER trg_assistente_atualizado_em
  BEFORE UPDATE ON arqvalor.assistente_lancamentos
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_set_atualizado_em();
