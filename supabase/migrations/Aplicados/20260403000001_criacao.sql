-- ============================================================
-- ARQUITETO DE VALOR — Migration idempotente v1.6
-- Seguro para reexecutar: não gera erro se objetos já existem.
--
-- Técnicas usadas:
--   ENUMs        → DO $$ BEGIN ... EXCEPTION WHEN duplicate_object
--   TABELAs      → CREATE TABLE IF NOT EXISTS
--   ÍNDICEs      → CREATE INDEX IF NOT EXISTS
--   TRIGGERs     → DROP TRIGGER IF EXISTS antes de CREATE
--   FUNÇÕEs      → CREATE OR REPLACE FUNCTION
--   VIEWs        → CREATE OR REPLACE VIEW
--   POLICIEs     → DROP POLICY IF EXISTS antes de CREATE
--   RLS          → ALTER TABLE ... ENABLE ROW LEVEL SECURITY
--                  (seguro repetir — já habilitado não muda nada)
-- ============================================================

-- ------------------------------------------------------------
-- SCHEMA
-- ------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS arqvalor;

SELECT set_config('search_path', 'arqvalor, public', false);

-- ------------------------------------------------------------
-- EXTENSOES
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- TIPOS ENUMERADOS
-- Protegidos com bloco DO/EXCEPTION para reexecução segura.
-- ------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE arqvalor.tipo_conta AS ENUM (
        'CORRENTE', 'REMUNERACAO', 'CARTAO', 'INVESTIMENTO', 'CARTEIRA'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE arqvalor.tipo_transacao AS ENUM ('RECEITA', 'DESPESA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE arqvalor.status_transacao AS ENUM ('PAGO', 'PENDENTE', 'PROJECAO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE arqvalor.tipo_recorrencia AS ENUM ('PARCELA', 'PROJECAO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE arqvalor.intervalo_recorr AS ENUM ('DIA', 'SEMANA', 'MES', 'ANO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE arqvalor.escopo_recorr AS ENUM (
        'SOMENTE_ESTE', 'ESTE_E_SEGUINTES', 'TODOS'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- TABELA: usuarios
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arqvalor.usuarios (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL UNIQUE,
    nome        TEXT        NOT NULL,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TABELA: contas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arqvalor.contas (
    id             UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID                    NOT NULL REFERENCES arqvalor.usuarios(id) ON DELETE RESTRICT,
    nome           TEXT                    NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 100),
    tipo           arqvalor.tipo_conta     NOT NULL,
    saldo_inicial  NUMERIC(15,2)           NOT NULL DEFAULT 0,
    icone          TEXT,
    cor            TEXT                    CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
    ativa          BOOLEAN                 NOT NULL DEFAULT TRUE,
    criado_em      TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    atualizado_em  TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contas_user_id ON arqvalor.contas (user_id);
CREATE INDEX IF NOT EXISTS idx_contas_ativa   ON arqvalor.contas (user_id, ativa);

-- ------------------------------------------------------------
-- TABELA: categorias
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arqvalor.categorias (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES arqvalor.usuarios(id)    ON DELETE RESTRICT,
    id_pai          UUID                 REFERENCES arqvalor.categorias(id)  ON DELETE RESTRICT,
    descricao       TEXT        NOT NULL CHECK (char_length(descricao) BETWEEN 1 AND 20),
    icone           TEXT,
    cor             TEXT        CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
    ativa           BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categorias_user_id ON arqvalor.categorias (user_id);
CREATE INDEX IF NOT EXISTS idx_categorias_pai     ON arqvalor.categorias (id_pai);
CREATE INDEX IF NOT EXISTS idx_categorias_ativa   ON arqvalor.categorias (user_id, ativa);

-- ------------------------------------------------------------
-- TABELA: transacoes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arqvalor.transacoes (
    id               UUID                         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID                         NOT NULL REFERENCES arqvalor.usuarios(id)   ON DELETE RESTRICT,
    conta_id         UUID                         NOT NULL REFERENCES arqvalor.contas(id)     ON DELETE RESTRICT,
    categoria_id     UUID                                  REFERENCES arqvalor.categorias(id) ON DELETE RESTRICT,
    data             DATE                         NOT NULL,
    ano_tx           SMALLINT                     GENERATED ALWAYS AS (EXTRACT(YEAR  FROM data)::SMALLINT) STORED,
    mes_tx           SMALLINT                     GENERATED ALWAYS AS (EXTRACT(MONTH FROM data)::SMALLINT) STORED,
    descricao        TEXT                         NOT NULL CHECK (char_length(descricao) BETWEEN 2 AND 200),
    valor            NUMERIC(15,2)                NOT NULL CHECK (valor > 0),
    tipo             arqvalor.tipo_transacao      NOT NULL,
    status           arqvalor.status_transacao    NOT NULL DEFAULT 'PENDENTE',
    valor_projetado  NUMERIC(15,2)                CHECK (valor_projetado > 0),
    id_recorrencia   UUID,
    nr_parcela       INTEGER                      CHECK (nr_parcela >= 1),
    total_parcelas   INTEGER                      CHECK (total_parcelas >= 1),
    tipo_recorrencia arqvalor.tipo_recorrencia,
    observacao       TEXT,
    criado_em        TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
    atualizado_em    TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_parcela_consistente CHECK (
        (id_recorrencia IS NULL AND nr_parcela IS NULL AND total_parcelas IS NULL)
        OR
        (id_recorrencia IS NOT NULL AND nr_parcela IS NOT NULL AND total_parcelas IS NOT NULL)
    ),
    CONSTRAINT chk_nr_parcela_range CHECK (
        nr_parcela IS NULL OR nr_parcela <= total_parcelas
    )
);

CREATE INDEX IF NOT EXISTS idx_tx_user_id        ON arqvalor.transacoes (user_id);
CREATE INDEX IF NOT EXISTS idx_tx_conta_id       ON arqvalor.transacoes (conta_id);
CREATE INDEX IF NOT EXISTS idx_tx_categoria_id   ON arqvalor.transacoes (categoria_id);
CREATE INDEX IF NOT EXISTS idx_tx_data           ON arqvalor.transacoes (data);
CREATE INDEX IF NOT EXISTS idx_tx_status         ON arqvalor.transacoes (status);
CREATE INDEX IF NOT EXISTS idx_tx_id_recorrencia ON arqvalor.transacoes (id_recorrencia);
CREATE INDEX IF NOT EXISTS idx_tx_criado_em      ON arqvalor.transacoes (criado_em);
CREATE INDEX IF NOT EXISTS idx_tx_listagem       ON arqvalor.transacoes (user_id, conta_id, data ASC, criado_em ASC);
CREATE INDEX IF NOT EXISTS idx_tx_ano_mes        ON arqvalor.transacoes (user_id, ano_tx, mes_tx);

-- ------------------------------------------------------------
-- TABELA: auditoria
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arqvalor.auditoria (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL,
    tabela      TEXT        NOT NULL,
    registro_id UUID        NOT NULL,
    acao        TEXT        NOT NULL CHECK (acao IN ('INSERT','UPDATE','DELETE','ANTECIPAR')),
    payload_old JSONB,
    payload_new JSONB,
    ip          TEXT,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_user_id   ON arqvalor.auditoria (user_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_registro  ON arqvalor.auditoria (registro_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_criado_em ON arqvalor.auditoria (criado_em DESC);

-- ============================================================
-- FUNÇÕES (CREATE OR REPLACE — sempre seguro reexecutar)
-- ============================================================

-- ------------------------------------------------------------
-- FUNÇÃO: atualizado_em automático
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION arqvalor.fn_set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: preservar valor_projetado ao confirmar PROJECAO → PAGO
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION arqvalor.fn_preservar_valor_projetado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'PROJECAO' AND NEW.status = 'PAGO' AND NEW.valor_projetado IS NULL THEN
        NEW.valor_projetado = OLD.valor;
    END IF;
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: validar isolamento de usuário na transação
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION arqvalor.fn_validar_isolamento_usuario()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM arqvalor.contas
        WHERE id = NEW.conta_id AND user_id = NEW.user_id AND ativa = TRUE
    ) THEN
        RAISE EXCEPTION 'CONTA_INVALIDA: A conta nao pertence ao usuario ou esta inativa.';
    END IF;

    IF NEW.categoria_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM arqvalor.categorias
        WHERE id = NEW.categoria_id AND user_id = NEW.user_id AND ativa = TRUE
    ) THEN
        RAISE EXCEPTION 'CATEGORIA_INVALIDA: A categoria nao pertence ao usuario ou esta inativa.';
    END IF;

    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: bloquear exclusão de conta com lançamentos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION arqvalor.fn_bloquear_exclusao_conta()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_total INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM arqvalor.transacoes WHERE conta_id = OLD.id;
    IF v_total > 0 THEN
        RAISE EXCEPTION 'CONTA_EM_USO: A conta "%" possui % lancamento(s) e nao pode ser excluida.', OLD.nome, v_total;
    END IF;
    RETURN OLD;
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: bloquear exclusão de categoria com filhos ou lançamentos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION arqvalor.fn_bloquear_exclusao_categoria()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_filhos      INTEGER;
    v_lancamentos INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_filhos      FROM arqvalor.categorias  WHERE id_pai       = OLD.id;
    SELECT COUNT(*) INTO v_lancamentos FROM arqvalor.transacoes   WHERE categoria_id = OLD.id;

    IF v_filhos > 0 THEN
        RAISE EXCEPTION 'CATEGORIA_COM_FILHOS: "%" possui % subcategoria(s). Exclua as subcategorias primeiro.', OLD.descricao, v_filhos;
    END IF;
    IF v_lancamentos > 0 THEN
        RAISE EXCEPTION 'CATEGORIA_EM_USO: "%" possui % lancamento(s) vinculado(s) e nao pode ser excluida.', OLD.descricao, v_lancamentos;
    END IF;

    RETURN OLD;
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: fn_antecipar_parcelas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION arqvalor.fn_antecipar_parcelas(p_transacao_id UUID, p_user_id UUID)
RETURNS TABLE (novo_valor NUMERIC(15,2), valor_projetado_salvo NUMERIC(15,2), parcelas_excluidas INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_tx             arqvalor.transacoes%ROWTYPE;
    v_soma_seguintes NUMERIC(15,2);
    v_count          INTEGER;
BEGIN
    SELECT * INTO v_tx FROM arqvalor.transacoes WHERE id = p_transacao_id AND user_id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TRANSACAO_NAO_ENCONTRADA';
    END IF;
    IF v_tx.tipo_recorrencia <> 'PARCELA' THEN
        RAISE EXCEPTION 'NOT_INSTALLMENT';
    END IF;
    IF v_tx.nr_parcela >= v_tx.total_parcelas THEN
        RAISE EXCEPTION 'LAST_INSTALLMENT';
    END IF;

    SELECT COALESCE(SUM(valor), 0), COUNT(*) INTO v_soma_seguintes, v_count
    FROM arqvalor.transacoes
    WHERE id_recorrencia = v_tx.id_recorrencia
      AND nr_parcela > v_tx.nr_parcela
      AND user_id = p_user_id;

    DELETE FROM arqvalor.transacoes
    WHERE id_recorrencia = v_tx.id_recorrencia
      AND nr_parcela > v_tx.nr_parcela
      AND user_id = p_user_id;

    UPDATE arqvalor.transacoes SET
        valor_projetado = v_tx.valor,
        valor           = v_tx.valor + v_soma_seguintes,
        total_parcelas  = v_tx.nr_parcela,
        atualizado_em   = NOW()
    WHERE id = p_transacao_id;

    RETURN QUERY SELECT
        (v_tx.valor + v_soma_seguintes)::NUMERIC(15,2),
        v_tx.valor::NUMERIC(15,2),
        v_count::INTEGER;
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: fn_saldo_conta_ate
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION arqvalor.fn_saldo_conta_ate(p_conta_id UUID, p_ate TIMESTAMPTZ DEFAULT NOW())
RETURNS NUMERIC(15,2) LANGUAGE sql STABLE AS $$
    SELECT (SELECT saldo_inicial FROM arqvalor.contas WHERE id = p_conta_id)
        + COALESCE(SUM(CASE WHEN tipo = 'RECEITA' THEN valor ELSE -valor END), 0)
    FROM arqvalor.transacoes
    WHERE conta_id = p_conta_id AND criado_em <= p_ate;
$$;

-- ============================================================
-- TRIGGERS
-- DROP IF EXISTS antes de CREATE garante reexecução segura.
-- ============================================================

DROP TRIGGER IF EXISTS trg_contas_atualizado_em      ON arqvalor.contas;
DROP TRIGGER IF EXISTS trg_categorias_atualizado_em  ON arqvalor.categorias;
DROP TRIGGER IF EXISTS trg_transacoes_atualizado_em  ON arqvalor.transacoes;
DROP TRIGGER IF EXISTS trg_preservar_valor_projetado ON arqvalor.transacoes;
DROP TRIGGER IF EXISTS trg_validar_isolamento_usuario ON arqvalor.transacoes;
DROP TRIGGER IF EXISTS trg_bloquear_exclusao_conta   ON arqvalor.contas;
DROP TRIGGER IF EXISTS trg_bloquear_exclusao_categoria ON arqvalor.categorias;

CREATE TRIGGER trg_contas_atualizado_em
    BEFORE UPDATE ON arqvalor.contas
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_set_atualizado_em();

CREATE TRIGGER trg_categorias_atualizado_em
    BEFORE UPDATE ON arqvalor.categorias
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_set_atualizado_em();

CREATE TRIGGER trg_transacoes_atualizado_em
    BEFORE UPDATE ON arqvalor.transacoes
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_set_atualizado_em();

CREATE TRIGGER trg_preservar_valor_projetado
    BEFORE UPDATE ON arqvalor.transacoes
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_preservar_valor_projetado();

CREATE TRIGGER trg_validar_isolamento_usuario
    BEFORE INSERT OR UPDATE ON arqvalor.transacoes
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_validar_isolamento_usuario();

CREATE TRIGGER trg_bloquear_exclusao_conta
    BEFORE DELETE ON arqvalor.contas
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_bloquear_exclusao_conta();

CREATE TRIGGER trg_bloquear_exclusao_categoria
    BEFORE DELETE ON arqvalor.categorias
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_bloquear_exclusao_categoria();

-- ============================================================
-- VIEWS (CREATE OR REPLACE — sempre seguro reexecutar)
-- ============================================================

CREATE OR REPLACE VIEW arqvalor.vw_saldo_contas AS
SELECT
    c.id AS conta_id, c.user_id, c.nome, c.tipo, c.icone, c.cor, c.ativa, c.saldo_inicial,
    COALESCE(SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor WHEN t.tipo = 'DESPESA' THEN -t.valor END), 0) AS movimentacao,
    c.saldo_inicial + COALESCE(SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor WHEN t.tipo = 'DESPESA' THEN -t.valor END), 0) AS saldo_atual
FROM arqvalor.contas c
LEFT JOIN arqvalor.transacoes t ON t.conta_id = c.id
GROUP BY c.id, c.user_id, c.nome, c.tipo, c.icone, c.cor, c.ativa, c.saldo_inicial;

CREATE OR REPLACE VIEW arqvalor.vw_transacoes_com_saldo AS
SELECT
    t.id, t.user_id, t.conta_id, t.categoria_id, t.data, t.descricao,
    t.valor, t.valor_projetado, t.tipo, t.status,
    t.id_recorrencia, t.nr_parcela, t.total_parcelas, t.tipo_recorrencia,
    t.observacao, t.criado_em, t.atualizado_em,
    cat.descricao     AS categoria_nome,
    cat.icone         AS categoria_icone,
    cat.cor           AS categoria_cor,
    cat_pai.descricao AS categoria_pai_nome,
    con.nome          AS conta_nome,
    con.icone         AS conta_icone,
    con.cor           AS conta_cor,
    con.saldo_inicial + SUM(
        CASE WHEN t.tipo = 'RECEITA' THEN t.valor WHEN t.tipo = 'DESPESA' THEN -t.valor END
    ) OVER (
        PARTITION BY t.conta_id
        ORDER BY t.data ASC, t.criado_em ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS saldo_acumulado
FROM arqvalor.transacoes t
JOIN  arqvalor.contas     con     ON con.id     = t.conta_id
LEFT JOIN arqvalor.categorias cat     ON cat.id     = t.categoria_id
LEFT JOIN arqvalor.categorias cat_pai ON cat_pai.id = cat.id_pai;

CREATE OR REPLACE VIEW arqvalor.vw_resumo_mensal AS
SELECT
    user_id,
    DATE_TRUNC('month', data)                                           AS mes,
    SUM(CASE WHEN tipo = 'RECEITA' THEN valor ELSE 0 END)              AS total_entradas,
    SUM(CASE WHEN tipo = 'DESPESA' THEN valor ELSE 0 END)              AS total_saidas,
    SUM(CASE WHEN tipo = 'RECEITA' THEN valor ELSE -valor END)         AS resultado
FROM arqvalor.transacoes
GROUP BY user_id, DATE_TRUNC('month', data);

CREATE OR REPLACE VIEW arqvalor.vw_despesas_por_categoria AS
SELECT
    t.user_id,
    DATE_TRUNC('month', t.data)                AS mes,
    COALESCE(cat_pai.id, t.categoria_id)       AS categoria_id,
    COALESCE(cat_pai.descricao, cat.descricao) AS categoria_nome,
    COALESCE(cat_pai.icone, cat.icone)         AS categoria_icone,
    COALESCE(cat_pai.cor, cat.cor)             AS categoria_cor,
    SUM(t.valor)                               AS total,
    ROUND(SUM(t.valor) * 100.0 / NULLIF(SUM(SUM(t.valor)) OVER (
        PARTITION BY t.user_id, DATE_TRUNC('month', t.data)
    ), 0), 2)                                  AS percentual
FROM arqvalor.transacoes t
LEFT JOIN arqvalor.categorias cat     ON cat.id     = t.categoria_id
LEFT JOIN arqvalor.categorias cat_pai ON cat_pai.id = cat.id_pai
WHERE t.tipo = 'DESPESA'
GROUP BY t.user_id, DATE_TRUNC('month', t.data),
    COALESCE(cat_pai.id, t.categoria_id),
    COALESCE(cat_pai.descricao, cat.descricao),
    COALESCE(cat_pai.icone, cat.icone),
    COALESCE(cat_pai.cor, cat.cor);

-- ============================================================
-- ROW LEVEL SECURITY
-- ENABLE ROW LEVEL SECURITY é seguro repetir (sem efeito se já ativo).
-- DROP POLICY IF EXISTS antes de CREATE evita erro de duplicidade.
-- ============================================================
ALTER TABLE arqvalor.contas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqvalor.categorias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqvalor.transacoes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqvalor.auditoria   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_contas_user      ON arqvalor.contas;
DROP POLICY IF EXISTS pol_categorias_user  ON arqvalor.categorias;
DROP POLICY IF EXISTS pol_transacoes_user  ON arqvalor.transacoes;
DROP POLICY IF EXISTS pol_auditoria_user   ON arqvalor.auditoria;

CREATE POLICY pol_contas_user ON arqvalor.contas
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY pol_categorias_user ON arqvalor.categorias
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY pol_transacoes_user ON arqvalor.transacoes
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY pol_auditoria_user ON arqvalor.auditoria
    USING (user_id = auth.uid());

-- ============================================================
-- FIM DA MIGRATION — 20260403000001_criacao_idempotente
-- ============================================================