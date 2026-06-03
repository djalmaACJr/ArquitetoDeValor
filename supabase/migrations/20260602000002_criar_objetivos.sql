-- ============================================================
-- Módulo de Objetivos Financeiros
-- Tabelas: objetivos, objetivos_progresso
-- ENUMs:   tipo_objetivo, status_objetivo
-- Funções: fn_calcular_progresso_objetivo,
--          fn_atualizar_progresso_objetivo (trigger),
--          fn_sincronizar_progresso_objetivo (RPC)
-- View:    vw_objetivos_detalhes
-- ============================================================

-- ── ENUMs ────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE arqvalor.tipo_objetivo AS ENUM ('SONHO', 'OBJETIVO', 'PROJETO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE arqvalor.status_objetivo AS ENUM ('EM_PROGRESSO', 'ATINGIDO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tabela objetivos ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arqvalor.objetivos (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tipo           arqvalor.tipo_objetivo   NOT NULL,
    nome           VARCHAR(100)  NOT NULL,
    descricao      TEXT,
    icone          VARCHAR(50)   NOT NULL DEFAULT 'target',
    cor            VARCHAR(7)    NOT NULL DEFAULT '#3b82f6',
    ativo          BOOLEAN       NOT NULL DEFAULT true,
    valor_meta     NUMERIC(15,2) NOT NULL CHECK (valor_meta > 0),
    data_inicio    DATE          NOT NULL,
    data_fim       DATE          NOT NULL,

    -- SONHO: conta cujo saldo é monitorado
    conta_id       UUID REFERENCES arqvalor.contas(id)     ON DELETE SET NULL,
    -- OBJETIVO: categoria de receita monitorada
    categoria_id   UUID REFERENCES arqvalor.categorias(id) ON DELETE SET NULL,
    -- OBJETIVO: periodicidade da meta (opcional — DIARIA | SEMANAL | MENSAL | ANUAL)
    frequencia     VARCHAR(10) CHECK (frequencia IN ('DIARIA','SEMANAL','MENSAL','ANUAL')),
    -- PROJETO: contas vinculadas ao orçamento
    contas_projeto UUID[]        NOT NULL DEFAULT ARRAY[]::UUID[],

    -- Progresso calculado por trigger
    valor_atingido NUMERIC(15,2) NOT NULL DEFAULT 0,
    percentual     SMALLINT      NOT NULL DEFAULT 0 CHECK (percentual BETWEEN 0 AND 100),
    status         arqvalor.status_objetivo NOT NULL DEFAULT 'EM_PROGRESSO',

    -- Histórico de revisões da meta
    revisoes       JSONB         NOT NULL DEFAULT '[]'::JSONB,

    -- Auditoria
    criado_em      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    atualizado_em  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_objetivos_data CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_objetivos_user_id
    ON arqvalor.objetivos(user_id);
CREATE INDEX IF NOT EXISTS idx_objetivos_tipo
    ON arqvalor.objetivos(tipo);
CREATE INDEX IF NOT EXISTS idx_objetivos_status
    ON arqvalor.objetivos(status);
CREATE INDEX IF NOT EXISTS idx_objetivos_data_fim
    ON arqvalor.objetivos(data_fim);
CREATE INDEX IF NOT EXISTS idx_objetivos_conta_id
    ON arqvalor.objetivos(conta_id) WHERE conta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_objetivos_categoria_id
    ON arqvalor.objetivos(categoria_id) WHERE categoria_id IS NOT NULL;

-- ── RLS: objetivos ───────────────────────────────────────────

ALTER TABLE arqvalor.objetivos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='objetivos' AND policyname='obj_select') THEN
        CREATE POLICY obj_select ON arqvalor.objetivos FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='objetivos' AND policyname='obj_insert') THEN
        CREATE POLICY obj_insert ON arqvalor.objetivos FOR INSERT WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='objetivos' AND policyname='obj_update') THEN
        CREATE POLICY obj_update ON arqvalor.objetivos FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='objetivos' AND policyname='obj_delete') THEN
        CREATE POLICY obj_delete ON arqvalor.objetivos FOR DELETE USING (user_id = auth.uid());
    END IF;
END $$;

-- ── Tabela objetivos_progresso (snapshots diários) ───────────

CREATE TABLE IF NOT EXISTS arqvalor.objetivos_progresso (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    objetivo_id    UUID          NOT NULL REFERENCES arqvalor.objetivos(id) ON DELETE CASCADE,
    data_snapshot  DATE          NOT NULL,
    valor_atingido NUMERIC(15,2) NOT NULL,
    percentual     SMALLINT      CHECK (percentual BETWEEN 0 AND 100),

    UNIQUE (objetivo_id, data_snapshot)
);

CREATE INDEX IF NOT EXISTS idx_prog_objetivo_data
    ON arqvalor.objetivos_progresso(objetivo_id, data_snapshot DESC);

ALTER TABLE arqvalor.objetivos_progresso ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='objetivos_progresso' AND policyname='prog_select') THEN
        CREATE POLICY prog_select ON arqvalor.objetivos_progresso
            FOR SELECT
            USING (objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='objetivos_progresso' AND policyname='prog_insert') THEN
        CREATE POLICY prog_insert ON arqvalor.objetivos_progresso
            FOR INSERT
            WITH CHECK (objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = auth.uid()));
    END IF;
END $$;

-- ── fn_calcular_progresso_objetivo ───────────────────────────
-- Calcula valor_atingido, percentual e status de um objetivo
-- existente (identificado pelo UUID). Usada pelo RPC de sync.
-- Lógica por tipo:
--   SONHO    → saldo atual da conta (mirrors vw_saldo_contas, sem PROJECAO em CARTAO)
--   OBJETIVO → soma das RECEITA da categoria no período
--   PROJETO  → soma das DESPESA nas contas do projeto (+ filtro opcional de categoria)

CREATE OR REPLACE FUNCTION arqvalor.fn_calcular_progresso_objetivo(
    p_objetivo_id    UUID,
    OUT r_valor_atingido NUMERIC,
    OUT r_percentual     SMALLINT,
    OUT r_status         arqvalor.status_objetivo
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v arqvalor.objetivos%ROWTYPE;
BEGIN
    SELECT * INTO v FROM arqvalor.objetivos WHERE id = p_objetivo_id;
    IF NOT FOUND THEN
        r_valor_atingido := 0;
        r_percentual     := 0;
        r_status         := 'EM_PROGRESSO';
        RETURN;
    END IF;

    r_valor_atingido := 0;

    -- ── SONHO: saldo atual da conta vinculada ─────────────────
    IF v.tipo = 'SONHO' AND v.conta_id IS NOT NULL THEN
        SELECT c.saldo_inicial + COALESCE(SUM(
            CASE
                WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                WHEN t.tipo = 'RECEITA' THEN  t.valor
                WHEN t.tipo = 'DESPESA' THEN -t.valor
                ELSE 0
            END
        ), 0)
        INTO r_valor_atingido
        FROM arqvalor.contas c
        LEFT JOIN arqvalor.transacoes t
               ON t.conta_id = c.id
              AND t.data    <= CURRENT_DATE
        WHERE c.id = v.conta_id;

    -- ── OBJETIVO: soma de RECEITA da categoria no período ─────
    ELSIF v.tipo = 'OBJETIVO' AND v.categoria_id IS NOT NULL THEN
        SELECT COALESCE(SUM(t.valor), 0)
        INTO r_valor_atingido
        FROM arqvalor.transacoes t
        WHERE t.categoria_id = v.categoria_id
          AND t.tipo         = 'RECEITA'
          AND t.data        >= v.data_inicio
          AND t.data        <= v.data_fim;

    -- ── PROJETO: soma de DESPESA nas contas do projeto ────────
    ELSIF v.tipo = 'PROJETO' AND array_length(v.contas_projeto, 1) > 0 THEN
        SELECT COALESCE(SUM(t.valor), 0)
        INTO r_valor_atingido
        FROM arqvalor.transacoes t
        WHERE t.conta_id   = ANY(v.contas_projeto)
          AND t.tipo       = 'DESPESA'
          AND (v.categoria_id IS NULL OR t.categoria_id = v.categoria_id)
          AND t.data      >= v.data_inicio
          AND t.data      <= CURRENT_DATE;
    END IF;

    r_valor_atingido := COALESCE(r_valor_atingido, 0);

    r_percentual := LEAST(100, GREATEST(0,
        CASE WHEN v.valor_meta > 0
             THEN (r_valor_atingido * 100 / v.valor_meta)::SMALLINT
             ELSE 0
        END
    ));

    r_status := CASE
        WHEN NOT v.ativo         THEN 'CANCELADO'::arqvalor.status_objetivo
        WHEN r_percentual >= 100 THEN 'ATINGIDO'::arqvalor.status_objetivo
        ELSE                          'EM_PROGRESSO'::arqvalor.status_objetivo
    END;
END;
$$;

-- ── fn_atualizar_progresso_objetivo (BEFORE trigger) ─────────
-- Recalcula progresso quando objetivo é inserido ou editado.
-- Usa NEW.* diretamente (sem SELECT na mesma tabela) para evitar
-- o problema de chicken-and-egg no BEFORE INSERT.

CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_progresso_objetivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_valor NUMERIC  := 0;
    v_pct   SMALLINT;
BEGIN
    -- ── SONHO ──────────────────────────────────────────────────
    IF NEW.tipo = 'SONHO' AND NEW.conta_id IS NOT NULL THEN
        SELECT c.saldo_inicial + COALESCE(SUM(
            CASE
                WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                WHEN t.tipo = 'RECEITA' THEN  t.valor
                WHEN t.tipo = 'DESPESA' THEN -t.valor
                ELSE 0
            END
        ), 0)
        INTO v_valor
        FROM arqvalor.contas c
        LEFT JOIN arqvalor.transacoes t
               ON t.conta_id = c.id
              AND t.data    <= CURRENT_DATE
        WHERE c.id = NEW.conta_id;

    -- ── OBJETIVO ───────────────────────────────────────────────
    ELSIF NEW.tipo = 'OBJETIVO' AND NEW.categoria_id IS NOT NULL THEN
        SELECT COALESCE(SUM(t.valor), 0)
        INTO v_valor
        FROM arqvalor.transacoes t
        WHERE t.categoria_id = NEW.categoria_id
          AND t.tipo         = 'RECEITA'
          AND t.data        >= NEW.data_inicio
          AND t.data        <= NEW.data_fim;

    -- ── PROJETO ────────────────────────────────────────────────
    ELSIF NEW.tipo = 'PROJETO' AND array_length(NEW.contas_projeto, 1) > 0 THEN
        SELECT COALESCE(SUM(t.valor), 0)
        INTO v_valor
        FROM arqvalor.transacoes t
        WHERE t.conta_id   = ANY(NEW.contas_projeto)
          AND t.tipo       = 'DESPESA'
          AND (NEW.categoria_id IS NULL OR t.categoria_id = NEW.categoria_id)
          AND t.data      >= NEW.data_inicio
          AND t.data      <= CURRENT_DATE;
    END IF;

    v_valor := COALESCE(v_valor, 0);

    v_pct := LEAST(100, GREATEST(0,
        CASE WHEN NEW.valor_meta > 0
             THEN (v_valor * 100 / NEW.valor_meta)::SMALLINT
             ELSE 0
        END
    ));

    NEW.valor_atingido := v_valor;
    NEW.percentual     := v_pct;
    NEW.status         := CASE
        WHEN NOT NEW.ativo  THEN 'CANCELADO'::arqvalor.status_objetivo
        WHEN v_pct >= 100   THEN 'ATINGIDO'::arqvalor.status_objetivo
        ELSE                     'EM_PROGRESSO'::arqvalor.status_objetivo
    END;
    NEW.atualizado_em  := NOW();
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_atualizar_progresso_objetivo'
          AND tgrelid = 'arqvalor.objetivos'::regclass
    ) THEN
        CREATE TRIGGER trg_atualizar_progresso_objetivo
            BEFORE INSERT OR UPDATE ON arqvalor.objetivos
            FOR EACH ROW
            EXECUTE FUNCTION arqvalor.fn_atualizar_progresso_objetivo();
    END IF;
END $$;

-- ── fn_sincronizar_progresso_objetivo (RPC) ──────────────────
-- Recalcula progresso de todos os objetivos ativos do usuário
-- e gera snapshot de hoje se não existir.
-- Chamada via POST /objetivos/sincronizar-progresso.

CREATE OR REPLACE FUNCTION arqvalor.fn_sincronizar_progresso_objetivo(
    p_user_id UUID
)
RETURNS TABLE(objetivos_atualizados INT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_obj    RECORD;
    v_valor  NUMERIC;
    v_pct    SMALLINT;
    v_stat   arqvalor.status_objetivo;
    v_count  INT := 0;
BEGIN
    -- Valida que o usuário está sincronizando os próprios objetivos
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'ACESSO_NEGADO'
            USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
    END IF;

    FOR v_obj IN
        SELECT id FROM arqvalor.objetivos
        WHERE user_id = auth.uid() AND ativo = true
    LOOP
        SELECT r_valor_atingido, r_percentual, r_status
        INTO v_valor, v_pct, v_stat
        FROM arqvalor.fn_calcular_progresso_objetivo(v_obj.id);

        UPDATE arqvalor.objetivos
        SET valor_atingido = v_valor,
            percentual     = v_pct,
            status         = v_stat,
            atualizado_em  = NOW()
        WHERE id = v_obj.id;

        v_count := v_count + 1;
    END LOOP;

    -- Snapshot de hoje (ON CONFLICT ignora duplicatas)
    INSERT INTO arqvalor.objetivos_progresso (objetivo_id, data_snapshot, valor_atingido, percentual)
    SELECT id, CURRENT_DATE, valor_atingido, percentual
    FROM arqvalor.objetivos
    WHERE user_id = auth.uid() AND ativo = true
    ON CONFLICT (objetivo_id, data_snapshot) DO NOTHING;

    RETURN QUERY SELECT v_count;
END;
$$;

-- ── vw_objetivos_detalhes ────────────────────────────────────
-- Enriquece objetivos com dias_restantes, nome da conta e
-- descrição da categoria (joins opcionais).

CREATE OR REPLACE VIEW arqvalor.vw_objetivos_detalhes
WITH (security_invoker = true)
AS
SELECT
    o.id,
    o.user_id,
    o.tipo,
    o.nome,
    o.descricao,
    o.icone,
    o.cor,
    o.ativo,
    o.valor_meta,
    o.valor_atingido,
    o.percentual,
    o.status,
    o.data_inicio,
    o.data_fim,
    GREATEST(0, (o.data_fim - CURRENT_DATE)::INT) AS dias_restantes,
    o.conta_id,
    c.nome       AS conta_nome,
    o.categoria_id,
    cat.descricao AS categoria_descricao,
    o.frequencia,
    o.contas_projeto,
    o.revisoes,
    o.criado_em,
    o.atualizado_em
FROM arqvalor.objetivos o
LEFT JOIN arqvalor.contas     c   ON c.id   = o.conta_id
LEFT JOIN arqvalor.categorias cat ON cat.id = o.categoria_id;

-- ── Grants ───────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE
    ON arqvalor.objetivos
    TO authenticated;

GRANT SELECT, INSERT
    ON arqvalor.objetivos_progresso
    TO authenticated;

GRANT EXECUTE
    ON FUNCTION arqvalor.fn_sincronizar_progresso_objetivo(UUID)
    TO authenticated;
