-- ============================================================
-- Módulo de Investimentos — Fundação (Fase 1)
-- Tabelas: inv_ativos, inv_alocacoes_tipo, inv_posicoes,
--          inv_operacoes, inv_dividendos, inv_historico_mensal
-- ENUMs:   tipo_ativo_inv, status_posicao_inv, tipo_operacao_inv
--
-- Convenção: o roadmap descreve um schema "investimentos.*", mas
-- todo o projeto opera no schema arqvalor (helper db() e grants
-- fixos). Para manter consistência e isolamento de RLS, as tabelas
-- ficam em arqvalor com prefixo inv_.
-- ============================================================

-- ── ENUMs ────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE arqvalor.tipo_ativo_inv AS ENUM (
        'ACOES', 'ETF', 'FII', 'STOCKS',
        'ETF_INTERNACIONAL', 'RENDA_FIXA', 'CRIPTOMOEDAS', 'TESOURO_DIRETO'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE arqvalor.status_posicao_inv AS ENUM ('ATIVA', 'ENCERRADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE arqvalor.tipo_operacao_inv AS ENUM (
        'COMPRA', 'VENDA', 'APORTE', 'RESGATE', 'DIVIDENDO'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Tabela: inv_ativos — cartela de ativos do usuário
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_ativos (
    id            UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID                      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ticker        VARCHAR(20)               NOT NULL,
    nome          VARCHAR(120)              NOT NULL,
    tipo_ativo    arqvalor.tipo_ativo_inv   NOT NULL,
    moeda         VARCHAR(3)                NOT NULL DEFAULT 'BRL',
    descricao     TEXT,
    -- Nota pessoal do ativo (0..10). Derivada do questionário (Fase futura)
    -- mas editável diretamente; nullable enquanto não avaliado.
    nota_usuario  NUMERIC(4,2)              CHECK (nota_usuario IS NULL OR nota_usuario BETWEEN 0 AND 10),
    -- Agrupamento opcional (ex.: ativo "guarda-chuva")
    ativo_pai     UUID                      REFERENCES arqvalor.inv_ativos(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ               NOT NULL DEFAULT NOW(),

    -- Mesmo ticker não se repete por usuário (case-insensitive tratado na API)
    CONSTRAINT uq_inv_ativos_user_ticker UNIQUE (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_inv_ativos_user_id
    ON arqvalor.inv_ativos(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_ativos_tipo
    ON arqvalor.inv_ativos(user_id, tipo_ativo);
CREATE INDEX IF NOT EXISTS idx_inv_ativos_pai
    ON arqvalor.inv_ativos(ativo_pai) WHERE ativo_pai IS NOT NULL;

-- ============================================================
-- Tabela: inv_alocacoes_tipo — alocação ideal por tipo de ativo
-- Regra: a soma de percentual_ideal por usuário deve ser 100%
-- (validada na API; a tabela só garante o range por linha).
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_alocacoes_tipo (
    id               UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID                    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tipo_ativo       arqvalor.tipo_ativo_inv NOT NULL,
    percentual_ideal NUMERIC(5,2)            NOT NULL DEFAULT 0
                       CHECK (percentual_ideal BETWEEN 0 AND 100),
    created_at       TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inv_alocacoes_user_tipo UNIQUE (user_id, tipo_ativo)
);

CREATE INDEX IF NOT EXISTS idx_inv_alocacoes_user_id
    ON arqvalor.inv_alocacoes_tipo(user_id);

-- ============================================================
-- Tabela: inv_posicoes — posições (lotes) por ativo + conta
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_posicoes (
    id          UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID                        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ativo_id    UUID                        NOT NULL REFERENCES arqvalor.inv_ativos(id) ON DELETE CASCADE,
    -- conta_id obrigatório (regra de negócio do módulo)
    conta_id    UUID                        NOT NULL REFERENCES arqvalor.contas(id) ON DELETE RESTRICT,
    quantidade  NUMERIC(20,8)               NOT NULL CHECK (quantidade >= 0),
    preco_custo NUMERIC(20,8)               NOT NULL CHECK (preco_custo >= 0),
    -- valor_custo = quantidade * preco_custo (calculado por trigger)
    valor_custo NUMERIC(20,2)               NOT NULL DEFAULT 0 CHECK (valor_custo >= 0),
    data_compra DATE                        NOT NULL,
    status      arqvalor.status_posicao_inv NOT NULL DEFAULT 'ATIVA',
    created_at  TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_posicoes_user_id
    ON arqvalor.inv_posicoes(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_posicoes_ativo
    ON arqvalor.inv_posicoes(ativo_id);
CREATE INDEX IF NOT EXISTS idx_inv_posicoes_conta
    ON arqvalor.inv_posicoes(conta_id);
CREATE INDEX IF NOT EXISTS idx_inv_posicoes_status
    ON arqvalor.inv_posicoes(user_id, status);

-- ============================================================
-- Tabela: inv_operacoes — histórico de movimentações
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_operacoes (
    id             UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID                       NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    posicao_id     UUID                       NOT NULL REFERENCES arqvalor.inv_posicoes(id) ON DELETE CASCADE,
    tipo_operacao  arqvalor.tipo_operacao_inv NOT NULL,
    conta_id       UUID                       NOT NULL REFERENCES arqvalor.contas(id) ON DELETE RESTRICT,
    quantidade     NUMERIC(20,8)              NOT NULL CHECK (quantidade >= 0),
    preco_unitario NUMERIC(20,8)              NOT NULL DEFAULT 0 CHECK (preco_unitario >= 0),
    valor_total    NUMERIC(20,2)              NOT NULL DEFAULT 0,
    data_operacao  DATE                       NOT NULL,
    created_at     TIMESTAMPTZ                NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_operacoes_user_id
    ON arqvalor.inv_operacoes(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_operacoes_posicao
    ON arqvalor.inv_operacoes(posicao_id);
CREATE INDEX IF NOT EXISTS idx_inv_operacoes_data
    ON arqvalor.inv_operacoes(user_id, data_operacao DESC);

-- ============================================================
-- Tabela: inv_dividendos — proventos, integrados ao extrato
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_dividendos (
    id                   UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID                    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ativo_id             UUID                    NOT NULL REFERENCES arqvalor.inv_ativos(id) ON DELETE CASCADE,
    conta_id             UUID                    NOT NULL REFERENCES arqvalor.contas(id) ON DELETE RESTRICT,
    valor                NUMERIC(20,2)           NOT NULL CHECK (valor >= 0),
    data_pagamento       DATE                    NOT NULL,
    tipo_ativo           arqvalor.tipo_ativo_inv NOT NULL,
    descricao            TEXT,
    -- Vínculo com a transação gerada no extrato (Fase 5).
    -- ON DELETE SET NULL: apagar a transação não apaga o dividendo.
    transacao_extrato_id UUID                    REFERENCES arqvalor.transacoes(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_dividendos_user_id
    ON arqvalor.inv_dividendos(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_dividendos_ativo
    ON arqvalor.inv_dividendos(ativo_id);
CREATE INDEX IF NOT EXISTS idx_inv_dividendos_data
    ON arqvalor.inv_dividendos(user_id, data_pagamento DESC);
CREATE INDEX IF NOT EXISTS idx_inv_dividendos_transacao
    ON arqvalor.inv_dividendos(transacao_extrato_id) WHERE transacao_extrato_id IS NOT NULL;

-- ============================================================
-- Tabela: inv_historico_mensal — snapshot de valor por mês
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_historico_mensal (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ativo_id            UUID          NOT NULL REFERENCES arqvalor.inv_ativos(id) ON DELETE CASCADE,
    conta_id            UUID          NOT NULL REFERENCES arqvalor.contas(id) ON DELETE RESTRICT,
    mes_ano             CHAR(7)       NOT NULL CHECK (mes_ano ~ '^\d{4}-\d{2}$'),  -- YYYY-MM
    valor_mercado       NUMERIC(20,2) NOT NULL DEFAULT 0,
    quantidade          NUMERIC(20,8) NOT NULL DEFAULT 0,
    preco_medio         NUMERIC(20,8) NOT NULL DEFAULT 0,
    variacao_percentual NUMERIC(10,4) NOT NULL DEFAULT 0,
    rentabilidade_mes   NUMERIC(20,2) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inv_hist_ativo_conta_mes UNIQUE (ativo_id, conta_id, mes_ano)
);

CREATE INDEX IF NOT EXISTS idx_inv_hist_user_mes
    ON arqvalor.inv_historico_mensal(user_id, mes_ano);
CREATE INDEX IF NOT EXISTS idx_inv_hist_ativo
    ON arqvalor.inv_historico_mensal(ativo_id, mes_ano);

-- ============================================================
-- Trigger: recalcula valor_custo e updated_at em inv_posicoes
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_inv_posicao_valor_custo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
    NEW.valor_custo := ROUND(NEW.quantidade * NEW.preco_custo, 2);
    NEW.updated_at  := NOW();
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_inv_posicao_valor_custo'
          AND tgrelid = 'arqvalor.inv_posicoes'::regclass
    ) THEN
        CREATE TRIGGER trg_inv_posicao_valor_custo
            BEFORE INSERT OR UPDATE ON arqvalor.inv_posicoes
            FOR EACH ROW
            EXECUTE FUNCTION arqvalor.fn_inv_posicao_valor_custo();
    END IF;
END $$;

-- ============================================================
-- RLS — todas as tabelas: USING/WITH CHECK user_id = auth.uid()
-- ============================================================

DO $$
DECLARE
    t TEXT;
    tabelas TEXT[] := ARRAY[
        'inv_ativos', 'inv_alocacoes_tipo', 'inv_posicoes',
        'inv_operacoes', 'inv_dividendos', 'inv_historico_mensal'
    ];
BEGIN
    FOREACH t IN ARRAY tabelas LOOP
        EXECUTE format('ALTER TABLE arqvalor.%I ENABLE ROW LEVEL SECURITY', t);

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename=t AND policyname=t||'_select') THEN
            EXECUTE format('CREATE POLICY %I ON arqvalor.%I FOR SELECT USING (user_id = auth.uid())', t||'_select', t);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename=t AND policyname=t||'_insert') THEN
            EXECUTE format('CREATE POLICY %I ON arqvalor.%I FOR INSERT WITH CHECK (user_id = auth.uid())', t||'_insert', t);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename=t AND policyname=t||'_update') THEN
            EXECUTE format('CREATE POLICY %I ON arqvalor.%I FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t||'_update', t);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename=t AND policyname=t||'_delete') THEN
            EXECUTE format('CREATE POLICY %I ON arqvalor.%I FOR DELETE USING (user_id = auth.uid())', t||'_delete', t);
        END IF;
    END LOOP;
END $$;

-- ============================================================
-- Grants — authenticated (RLS continua filtrando por usuário)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_ativos           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_alocacoes_tipo    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_posicoes          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_operacoes         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_dividendos        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_historico_mensal  TO authenticated;

-- ============================================================
-- fn_excluir_dados_usuario — incluir tabelas inv_* (e objetivos)
-- A função usa session_replication_role = replica, que IGNORA
-- cascades de FK; por isso cada tabela precisa ser apagada
-- explicitamente, senão sobram órfãos após "excluir conta".
-- (objetivos/objetivos_progresso estavam faltando desde que o
--  módulo de objetivos foi adicionado — corrigido aqui também.)
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

  -- Usuário (ia_configs/layout etc. são JSONB inline)
  DELETE FROM arqvalor.usuarios WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;
