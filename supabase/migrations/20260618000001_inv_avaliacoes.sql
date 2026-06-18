-- ============================================================
-- inv_avaliacoes — avaliação da carteira feita pelos MENTORES (IAs
-- configuradas em arqvalor.usuarios.ia_configs).
--
-- A pedido do usuário, cada mentor configurado avalia cada ativo da
-- carteira respondendo o questionário do tipo daquele ativo (o mesmo
-- questionário efetivo usado na avaliação manual — custom de
-- inv_questionarios ou o padrão do app). As respostas são planilhadas
-- (mentor × pergunta), tira-se a média por pergunta e a NOTA FINAL do
-- ativo = média das notas dos mentores.
--
-- Esta tabela guarda 1 linha por (user_id, ativo_id) — re-rodar faz
-- upsert (sobrescreve a avaliação anterior do ativo). Além disso, o
-- consenso é gravado em inv_ativos.nota_usuario + questionario_respostas
-- (decisão do usuário: o consenso vira a nota oficial do ativo).
--
-- consenso (JSONB):
--   {
--     "pesos": { "FUNDAMENTOS": int, "CRESCIMENTO": int, "DIVIDENDOS": int, "VALUATION": int },
--     "perguntas": [ { "id": "...", "media_indice": 0..4, "media_nota": 0..10 } ],
--     "mentores": [
--       { "config_id": "...", "nome": "...", "provedor": "claude",
--         "modelo": "...", "nota": 0..10, "respostas": { "<id>": 0..4 },
--         "erro": null }
--     ]
--   }
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_avaliacoes (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ativo_id     UUID        NOT NULL REFERENCES arqvalor.inv_ativos(id) ON DELETE CASCADE,
    nota_final   NUMERIC(4,2) CHECK (nota_final IS NULL OR nota_final BETWEEN 0 AND 10),
    consenso     JSONB       NOT NULL,
    gerado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inv_avaliacoes_user_ativo UNIQUE (user_id, ativo_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_avaliacoes_user_id
    ON arqvalor.inv_avaliacoes(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_avaliacoes_ativo_id
    ON arqvalor.inv_avaliacoes(ativo_id);

-- updated_at automático (reusa o padrão dos demais módulos inv_*)
CREATE OR REPLACE FUNCTION arqvalor.fn_inv_avaliacao_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_inv_avaliacao_touch'
          AND tgrelid = 'arqvalor.inv_avaliacoes'::regclass
    ) THEN
        CREATE TRIGGER trg_inv_avaliacao_touch
            BEFORE UPDATE ON arqvalor.inv_avaliacoes
            FOR EACH ROW
            EXECUTE FUNCTION arqvalor.fn_inv_avaliacao_touch();
    END IF;
END $$;

-- ── RLS — user_id = auth.uid() ────────────────────────────────
ALTER TABLE arqvalor.inv_avaliacoes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_avaliacoes' AND policyname='inv_avaliacoes_select') THEN
        CREATE POLICY inv_avaliacoes_select ON arqvalor.inv_avaliacoes FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_avaliacoes' AND policyname='inv_avaliacoes_insert') THEN
        CREATE POLICY inv_avaliacoes_insert ON arqvalor.inv_avaliacoes FOR INSERT WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_avaliacoes' AND policyname='inv_avaliacoes_update') THEN
        CREATE POLICY inv_avaliacoes_update ON arqvalor.inv_avaliacoes FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_avaliacoes' AND policyname='inv_avaliacoes_delete') THEN
        CREATE POLICY inv_avaliacoes_delete ON arqvalor.inv_avaliacoes FOR DELETE USING (user_id = auth.uid());
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_avaliacoes TO authenticated;

-- ============================================================
-- fn_excluir_dados_usuario — incluir inv_avaliacoes.
-- Redefinição completa (espelha 20260616000006), acrescentando a
-- nova tabela na seção de investimentos (antes de inv_ativos, pois
-- referencia inv_ativos).
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_dados_usuario(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_role TEXT := current_user;
  v_auth_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
BEGIN
  IF v_role NOT IN ('postgres','supabase_admin') AND v_auth_role <> 'service_role' THEN
    IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'ACESSO_NEGADO'
        USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
    END IF;
  END IF;

  SET LOCAL session_replication_role = replica;

  -- Investimentos (filhos → pais)
  DELETE FROM arqvalor.inv_historico_mensal WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_dividendos       WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_operacoes        WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_posicoes         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_alocacoes_tipo   WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_avaliacoes       WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_questionarios    WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_tipos_dividendo  WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_ativos           WHERE user_id = p_user_id;

  -- Objetivos
  DELETE FROM arqvalor.objetivos_progresso
    WHERE objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = p_user_id);
  DELETE FROM arqvalor.objetivos            WHERE user_id = p_user_id;

  -- Dependentes
  DELETE FROM arqvalor.lembretes              WHERE user_id = p_user_id;
  DELETE FROM arqvalor.filtros_salvos         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.assistente_lancamentos WHERE user_id = p_user_id;

  -- Domínio principal
  DELETE FROM arqvalor.transacoes WHERE user_id = p_user_id;
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id;
  DELETE FROM arqvalor.contas     WHERE user_id = p_user_id;

  DELETE FROM arqvalor.usuarios WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;
