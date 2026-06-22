-- Migration: Tabela de Lembretes
-- Lembretes avulsos ou vinculados a lançamentos futuros

CREATE TABLE IF NOT EXISTS arqvalor.lembretes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES arqvalor.usuarios(id) ON DELETE CASCADE,
  data          DATE        NOT NULL,
  descricao     TEXT        NOT NULL CHECK (char_length(descricao) BETWEEN 1 AND 200),
  status        TEXT        NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'CONCLUIDO')),
  lancamento_id UUID        REFERENCES arqvalor.transacoes(id) ON DELETE CASCADE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lembretes_user_data
  ON arqvalor.lembretes (user_id, data);

ALTER TABLE arqvalor.lembretes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'arqvalor'
      AND tablename  = 'lembretes'
      AND policyname = 'lembretes_user'
  ) THEN
    CREATE POLICY lembretes_user ON arqvalor.lembretes
      USING     (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_lembrete_ts()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = arqvalor AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atualizar_lembrete ON arqvalor.lembretes;
CREATE TRIGGER trg_atualizar_lembrete
  BEFORE UPDATE ON arqvalor.lembretes
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_atualizar_lembrete_ts();
