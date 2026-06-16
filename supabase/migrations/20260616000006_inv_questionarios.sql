-- ============================================================
-- inv_questionarios — questionário de avaliação por tipo de ativo
-- customizado por usuário.
--
-- O app já tem um questionário ESTÁTICO padrão por tipo
-- (FrontEnd/src/lib/questionarioAtivos.ts). Esta tabela guarda uma
-- versão CUSTOMIZADA por (usuário, tipo_ativo) que SOBREPÕE o padrão:
--   - editada à mão pelo usuário, ou
--   - gerada pelo Mentor (IA) — registra-se qual provedor/modelo gerou.
-- Tipo sem linha aqui → frontend usa o padrão estático.
--
-- perguntas (JSONB): array de
--   { "id": "...", "texto": "...",
--     "criterio": "FUNDAMENTOS" | "CRESCIMENTO" | "DIVIDENDOS",
--     "opcoes": [5 strings ordenadas pior→melhor] }
-- pesos (JSONB): { "FUNDAMENTOS": int, "CRESCIMENTO": int, "DIVIDENDOS": int }
--   (somam 100; a nota é a média ponderada por critério).
-- origem: 'MANUAL' | 'IA'.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_questionarios (
    id           UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID                    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tipo_ativo   arqvalor.tipo_ativo_inv NOT NULL,
    perguntas    JSONB                   NOT NULL,
    pesos        JSONB                   NOT NULL,
    origem       TEXT                    NOT NULL DEFAULT 'MANUAL'
                   CHECK (origem IN ('MANUAL', 'IA')),
    ia_provedor  TEXT,
    ia_modelo    TEXT,
    ia_gerou_em  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inv_questionarios_user_tipo UNIQUE (user_id, tipo_ativo)
);

CREATE INDEX IF NOT EXISTS idx_inv_questionarios_user_id
    ON arqvalor.inv_questionarios(user_id);

-- updated_at automático (reusa o padrão dos demais módulos inv_*)
CREATE OR REPLACE FUNCTION arqvalor.fn_inv_questionario_touch()
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
        WHERE tgname = 'trg_inv_questionario_touch'
          AND tgrelid = 'arqvalor.inv_questionarios'::regclass
    ) THEN
        CREATE TRIGGER trg_inv_questionario_touch
            BEFORE UPDATE ON arqvalor.inv_questionarios
            FOR EACH ROW
            EXECUTE FUNCTION arqvalor.fn_inv_questionario_touch();
    END IF;
END $$;

-- ── RLS — user_id = auth.uid() ────────────────────────────────
ALTER TABLE arqvalor.inv_questionarios ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_questionarios' AND policyname='inv_questionarios_select') THEN
        CREATE POLICY inv_questionarios_select ON arqvalor.inv_questionarios FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_questionarios' AND policyname='inv_questionarios_insert') THEN
        CREATE POLICY inv_questionarios_insert ON arqvalor.inv_questionarios FOR INSERT WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_questionarios' AND policyname='inv_questionarios_update') THEN
        CREATE POLICY inv_questionarios_update ON arqvalor.inv_questionarios FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_questionarios' AND policyname='inv_questionarios_delete') THEN
        CREATE POLICY inv_questionarios_delete ON arqvalor.inv_questionarios FOR DELETE USING (user_id = auth.uid());
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_questionarios TO authenticated;

-- ============================================================
-- fn_excluir_dados_usuario — incluir inv_questionarios.
-- Redefinição completa (espelha 20260609000002), acrescentando a
-- nova tabela na seção de investimentos.
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
