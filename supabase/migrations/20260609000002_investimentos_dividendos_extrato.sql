-- ============================================================
-- Módulo de Investimentos — Dividendos × Extrato (Fase 5)
-- ============================================================
-- Decisões (definidas com o usuário):
--   • Tipos de dividendo são EDITÁVEIS por usuário → tabela
--     inv_tipos_dividendo (CRUD), seedada com 4 padrões:
--     'Aluguel de FII', 'JSCP', 'Dividendos', 'Rend. Trib.'
--   • Mapeamento tipo → categoria é GRANULAR (1 categoria por tipo)
--     e REUTILIZÁVEL: o categoria_id fica na própria linha do tipo.
--   • A criação da categoria (informando pai ou como pai) reaproveita
--     a Edge Function `categorias` existente — aqui só guardamos o
--     categoria_id escolhido/criado.
--   • O lançamento do dividendo no extrato (transação RECEITA, com
--     status PROJECAO quando futuro) é feito na Edge Function
--     `investimentos` (espelha o padrão de `transferencias`).
-- ============================================================

-- ── Tabela: inv_tipos_dividendo ─────────────────────────────

CREATE TABLE IF NOT EXISTS arqvalor.inv_tipos_dividendo (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nome         VARCHAR(40)  NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 40),
    -- Categoria do extrato em que esse tipo de dividendo é lançado.
    -- NULL = ainda não mapeado (bloqueia o lançamento até configurar).
    categoria_id UUID         REFERENCES arqvalor.categorias(id) ON DELETE SET NULL,
    ativo        BOOLEAN      NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inv_tipos_div_user_nome UNIQUE (user_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_inv_tipos_div_user
    ON arqvalor.inv_tipos_dividendo(user_id);

ALTER TABLE arqvalor.inv_tipos_dividendo ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_tipos_dividendo' AND policyname='inv_tipos_dividendo_select') THEN
        CREATE POLICY inv_tipos_dividendo_select ON arqvalor.inv_tipos_dividendo FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_tipos_dividendo' AND policyname='inv_tipos_dividendo_insert') THEN
        CREATE POLICY inv_tipos_dividendo_insert ON arqvalor.inv_tipos_dividendo FOR INSERT WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_tipos_dividendo' AND policyname='inv_tipos_dividendo_update') THEN
        CREATE POLICY inv_tipos_dividendo_update ON arqvalor.inv_tipos_dividendo FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_tipos_dividendo' AND policyname='inv_tipos_dividendo_delete') THEN
        CREATE POLICY inv_tipos_dividendo_delete ON arqvalor.inv_tipos_dividendo FOR DELETE USING (user_id = auth.uid());
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_tipos_dividendo TO authenticated;

-- ── inv_dividendos: vínculo ao tipo de dividendo ────────────

ALTER TABLE arqvalor.inv_dividendos
    ADD COLUMN IF NOT EXISTS tipo_dividendo_id UUID
        REFERENCES arqvalor.inv_tipos_dividendo(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inv_dividendos_tipo_div
    ON arqvalor.inv_dividendos(tipo_dividendo_id) WHERE tipo_dividendo_id IS NOT NULL;

-- ── Seed dos 4 tipos padrão para novos usuários ─────────────
-- Trigger separado (não mexe na fn_sincronizar_usuario, preservando
-- o hardening de search_path já aplicado lá).

CREATE OR REPLACE FUNCTION arqvalor.fn_seed_tipos_dividendo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
    INSERT INTO arqvalor.inv_tipos_dividendo (user_id, nome)
    SELECT NEW.id, t.nome
    FROM (VALUES ('Aluguel de FII'), ('JSCP'), ('Dividendos'), ('Rend. Trib.')) AS t(nome)
    ON CONFLICT (user_id, nome) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_tipos_dividendo ON auth.users;
CREATE TRIGGER trg_seed_tipos_dividendo
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_seed_tipos_dividendo();

-- ── Backfill: usuários existentes recebem os 4 tipos ────────

INSERT INTO arqvalor.inv_tipos_dividendo (user_id, nome)
SELECT u.id, t.nome
FROM auth.users u
CROSS JOIN (VALUES ('Aluguel de FII'), ('JSCP'), ('Dividendos'), ('Rend. Trib.')) AS t(nome)
ON CONFLICT (user_id, nome) DO NOTHING;

-- ── fn_excluir_dados_usuario: incluir inv_tipos_dividendo ───
-- (recriação completa mantendo a lógica de auth da versão anterior)

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
