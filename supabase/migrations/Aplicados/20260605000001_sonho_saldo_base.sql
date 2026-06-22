-- 20260605000001_sonho_saldo_base.sql
--
-- Corrige o cálculo de progresso do tipo SONHO e adiciona estimativa mensal.
--
-- LÓGICA:
--   saldo_base     = saldo das contas NO DIA ANTERIOR a data_inicio
--   valor_atingido = saldo_atual  −  saldo_base          (crescimento desde o início)
--   crescimento_meta = valor_meta − saldo_base           (quanto precisa crescer no total)
--   percentual     = valor_atingido / crescimento_meta × 100
--
-- Exemplo: início R$308, meta R$354, hoje R$321
--   crescimento_meta = 354 − 308 = 46
--   valor_atingido   = 321 − 308 = 13
--   percentual       = 13 / 46   = 28 %
--
-- NOVO CAMPO:
--   crescimento_mensal_necessario = (valor_meta − saldo_atual) / meses_restantes
--   Exposto na view; não armazenado (calculado em tempo de leitura).


-- ── 1. Adicionar coluna saldo_base na tabela ──────────────────

ALTER TABLE arqvalor.objetivos
    ADD COLUMN IF NOT EXISTS saldo_base NUMERIC NOT NULL DEFAULT 0;

-- ── 2. Helper: saldo de N contas até uma data ─────────────────

CREATE OR REPLACE FUNCTION arqvalor.fn_saldo_contas_ate(
    p_contas UUID[],
    p_data   DATE
)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
    SELECT COALESCE(SUM(sub.saldo), 0)
    FROM (
        SELECT c.saldo_inicial + COALESCE(SUM(
            CASE
                WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                WHEN t.tipo = 'RECEITA' THEN  t.valor
                WHEN t.tipo = 'DESPESA' THEN -t.valor
                ELSE 0
            END
        ), 0) AS saldo
        FROM arqvalor.contas c
        LEFT JOIN arqvalor.transacoes t
               ON t.conta_id = c.id
              AND t.data    <= p_data
        WHERE c.id = ANY(p_contas)
        GROUP BY c.id, c.saldo_inicial, c.tipo
    ) sub;
$$;

-- ── 3. Trigger: fn_atualizar_progresso_objetivo ───────────────
--    Recalcula saldo_base + valor_atingido + percentual + status
--    a cada INSERT ou UPDATE no objetivo.

CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_progresso_objetivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_valor       NUMERIC  := 0;
    v_base        NUMERIC  := 0;
    v_denominador NUMERIC;
    v_pct         SMALLINT;
    v_periodos    INTEGER  := 1;
    v_ref_fim     DATE;
    v_cats        UUID[]   := ARRAY[]::UUID[];
    v_contas      UUID[]   := ARRAY[]::UUID[];
    -- CRESCIMENTO
    v_ano_base    INTEGER;
    v_ano_comp    INTEGER;
    v_base_sum    NUMERIC  := 0;
    v_comp_sum    NUMERIC  := 0;
BEGIN
    -- ── SONHO: crescimento = saldo_atual − saldo_base ──────────
    IF NEW.tipo = 'SONHO' THEN
        v_contas := CASE
            WHEN array_length(NEW.contas_sonho, 1) > 0 THEN NEW.contas_sonho
            WHEN NEW.conta_id IS NOT NULL              THEN ARRAY[NEW.conta_id]
            ELSE ARRAY[]::UUID[]
        END;

        IF array_length(v_contas, 1) > 0 THEN
            v_base  := arqvalor.fn_saldo_contas_ate(v_contas, NEW.data_inicio - 1);
            v_valor := arqvalor.fn_saldo_contas_ate(v_contas, CURRENT_DATE) - v_base;
        END IF;

    -- ── OBJETIVO: média por período em N categorias ─────────────
    ELSIF NEW.tipo = 'OBJETIVO' THEN
        v_cats := CASE
            WHEN array_length(NEW.categorias_objetivo, 1) > 0 THEN NEW.categorias_objetivo
            WHEN NEW.categoria_id IS NOT NULL THEN ARRAY[NEW.categoria_id]
            ELSE ARRAY[]::UUID[]
        END;

        IF array_length(v_cats, 1) > 0 THEN
            v_ref_fim := LEAST(CURRENT_DATE, NEW.data_fim);
            IF NEW.frequencia = 'MENSAL' THEN
                v_periodos := GREATEST(1,
                    (DATE_PART('year',  v_ref_fim) - DATE_PART('year',  NEW.data_inicio))::INT * 12 +
                    (DATE_PART('month', v_ref_fim) - DATE_PART('month', NEW.data_inicio))::INT + 1);
            ELSIF NEW.frequencia = 'ANUAL' THEN
                v_periodos := GREATEST(1,
                    (DATE_PART('year', v_ref_fim) - DATE_PART('year', NEW.data_inicio))::INT + 1);
            ELSIF NEW.frequencia = 'SEMANAL' THEN
                v_periodos := GREATEST(1, ((v_ref_fim - NEW.data_inicio) / 7 + 1)::INT);
            END IF;
            SELECT COALESCE(SUM(t.valor), 0) / v_periodos INTO v_valor
            FROM arqvalor.transacoes t
            WHERE t.categoria_id = ANY(v_cats) AND t.tipo = 'RECEITA'
              AND t.data >= NEW.data_inicio AND t.data <= v_ref_fim;
        END IF;

    -- ── PROJETO ──────────────────────────────────────────────────
    ELSIF NEW.tipo = 'PROJETO' AND array_length(NEW.contas_projeto, 1) > 0 THEN
        SELECT COALESCE(SUM(t.valor), 0) INTO v_valor
        FROM arqvalor.transacoes t
        WHERE t.conta_id = ANY(NEW.contas_projeto) AND t.tipo = 'DESPESA'
          AND (NEW.categoria_id IS NULL OR t.categoria_id = NEW.categoria_id)
          AND t.data >= NEW.data_inicio AND t.data <= CURRENT_DATE;

    -- ── CRESCIMENTO: % de crescimento no ano atual vs ano base ─
    ELSIF NEW.tipo = 'CRESCIMENTO' THEN
        v_cats := CASE
            WHEN array_length(NEW.categorias_objetivo, 1) > 0 THEN NEW.categorias_objetivo
            WHEN NEW.categoria_id IS NOT NULL THEN ARRAY[NEW.categoria_id]
            ELSE ARRAY[]::UUID[]
        END;

        IF array_length(v_cats, 1) > 0 THEN
            v_ano_base := DATE_PART('year', NEW.data_inicio)::INTEGER;
            v_ano_comp := LEAST(
                DATE_PART('year', CURRENT_DATE)::INTEGER,
                DATE_PART('year', NEW.data_fim)::INTEGER
            );

            IF v_ano_comp > v_ano_base THEN
                SELECT COALESCE(SUM(t.valor), 0) INTO v_base_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats)
                  AND t.tipo = 'RECEITA'
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_base;

                SELECT COALESCE(SUM(t.valor), 0) INTO v_comp_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats)
                  AND t.tipo = 'RECEITA'
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_comp;

                IF v_base_sum > 0 THEN
                    v_valor := ((v_comp_sum - v_base_sum) / v_base_sum) * 100;
                END IF;
            END IF;
        END IF;
    END IF;

    v_valor := COALESCE(v_valor, 0);

    -- Denominador: SONHO usa (meta − base) como referência de crescimento
    v_denominador := CASE
        WHEN NEW.tipo = 'SONHO' THEN NULLIF(NEW.valor_meta - v_base, 0)
        ELSE                         NULLIF(NEW.valor_meta, 0)
    END;

    v_pct := LEAST(100, GREATEST(0,
        CASE WHEN v_denominador IS NOT NULL
             THEN (v_valor * 100 / v_denominador)::SMALLINT
             ELSE 0
        END));

    NEW.saldo_base     := v_base;
    NEW.valor_atingido := v_valor;
    NEW.percentual     := v_pct;
    NEW.status         := CASE
        WHEN NOT NEW.ativo  THEN 'CANCELADO'::arqvalor.status_objetivo
        WHEN v_pct >= 100   THEN 'ATINGIDO'::arqvalor.status_objetivo
        ELSE                     'EM_PROGRESSO'::arqvalor.status_objetivo
    END;
    NEW.atualizado_em := NOW();
    RETURN NEW;
END;
$$;

-- ── 4. fn_calcular_progresso_objetivo (usado pelo sincronizar) ─
--    Lê saldo_base armazenado para calcular percentual corretamente.

CREATE OR REPLACE FUNCTION arqvalor.fn_calcular_progresso_objetivo(
    p_objetivo_id    UUID,
    OUT r_valor_atingido NUMERIC,
    OUT r_percentual     SMALLINT,
    OUT r_status         arqvalor.status_objetivo
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v             arqvalor.objetivos%ROWTYPE;
    v_denominador NUMERIC;
    v_periodos    INTEGER := 1;
    v_ref_fim     DATE;
    v_cats        UUID[]  := ARRAY[]::UUID[];
    v_contas      UUID[]  := ARRAY[]::UUID[];
    -- CRESCIMENTO
    v_ano_base    INTEGER;
    v_ano_comp    INTEGER;
    v_base_sum    NUMERIC := 0;
    v_comp_sum    NUMERIC := 0;
BEGIN
    SELECT * INTO v FROM arqvalor.objetivos WHERE id = p_objetivo_id;
    IF NOT FOUND THEN
        r_valor_atingido := 0; r_percentual := 0; r_status := 'EM_PROGRESSO'; RETURN;
    END IF;
    r_valor_atingido := 0;

    IF v.tipo = 'SONHO' THEN
        v_contas := CASE
            WHEN array_length(v.contas_sonho, 1) > 0 THEN v.contas_sonho
            WHEN v.conta_id IS NOT NULL              THEN ARRAY[v.conta_id]
            ELSE ARRAY[]::UUID[]
        END;
        IF array_length(v_contas, 1) > 0 THEN
            -- v.saldo_base já está atualizado pelo trigger
            r_valor_atingido := arqvalor.fn_saldo_contas_ate(v_contas, CURRENT_DATE) - v.saldo_base;
        END IF;

    ELSIF v.tipo = 'OBJETIVO' THEN
        v_cats := CASE
            WHEN array_length(v.categorias_objetivo, 1) > 0 THEN v.categorias_objetivo
            WHEN v.categoria_id IS NOT NULL THEN ARRAY[v.categoria_id]
            ELSE ARRAY[]::UUID[]
        END;
        IF array_length(v_cats, 1) > 0 THEN
            v_ref_fim := LEAST(CURRENT_DATE, v.data_fim);
            IF v.frequencia = 'MENSAL' THEN
                v_periodos := GREATEST(1,
                    (DATE_PART('year', v_ref_fim) - DATE_PART('year', v.data_inicio))::INT * 12 +
                    (DATE_PART('month',v_ref_fim) - DATE_PART('month',v.data_inicio))::INT + 1);
            ELSIF v.frequencia = 'ANUAL' THEN
                v_periodos := GREATEST(1,
                    (DATE_PART('year', v_ref_fim) - DATE_PART('year', v.data_inicio))::INT + 1);
            ELSIF v.frequencia = 'SEMANAL' THEN
                v_periodos := GREATEST(1, ((v_ref_fim - v.data_inicio) / 7 + 1)::INT);
            END IF;
            SELECT COALESCE(SUM(t.valor), 0) / v_periodos INTO r_valor_atingido
            FROM arqvalor.transacoes t
            WHERE t.categoria_id = ANY(v_cats) AND t.tipo = 'RECEITA'
              AND t.data >= v.data_inicio AND t.data <= v_ref_fim;
        END IF;

    ELSIF v.tipo = 'PROJETO' AND array_length(v.contas_projeto, 1) > 0 THEN
        SELECT COALESCE(SUM(t.valor), 0) INTO r_valor_atingido
        FROM arqvalor.transacoes t
        WHERE t.conta_id = ANY(v.contas_projeto) AND t.tipo = 'DESPESA'
          AND (v.categoria_id IS NULL OR t.categoria_id = v.categoria_id)
          AND t.data >= v.data_inicio AND t.data <= CURRENT_DATE;

    ELSIF v.tipo = 'CRESCIMENTO' THEN
        v_cats := CASE
            WHEN array_length(v.categorias_objetivo, 1) > 0 THEN v.categorias_objetivo
            WHEN v.categoria_id IS NOT NULL THEN ARRAY[v.categoria_id]
            ELSE ARRAY[]::UUID[]
        END;
        IF array_length(v_cats, 1) > 0 THEN
            v_ano_base := DATE_PART('year', v.data_inicio)::INTEGER;
            v_ano_comp := LEAST(
                DATE_PART('year', CURRENT_DATE)::INTEGER,
                DATE_PART('year', v.data_fim)::INTEGER
            );
            IF v_ano_comp > v_ano_base THEN
                SELECT COALESCE(SUM(t.valor), 0) INTO v_base_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats) AND t.tipo = 'RECEITA'
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_base;

                SELECT COALESCE(SUM(t.valor), 0) INTO v_comp_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats) AND t.tipo = 'RECEITA'
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_comp;

                IF v_base_sum > 0 THEN
                    r_valor_atingido := ((v_comp_sum - v_base_sum) / v_base_sum) * 100;
                END IF;
            END IF;
        END IF;
    END IF;

    r_valor_atingido := COALESCE(r_valor_atingido, 0);

    v_denominador := CASE
        WHEN v.tipo = 'SONHO' THEN NULLIF(v.valor_meta - v.saldo_base, 0)
        ELSE                        NULLIF(v.valor_meta, 0)
    END;

    r_percentual := LEAST(100, GREATEST(0,
        CASE WHEN v_denominador IS NOT NULL
             THEN (r_valor_atingido * 100 / v_denominador)::SMALLINT
             ELSE 0
        END));

    r_status := CASE
        WHEN NOT v.ativo         THEN 'CANCELADO'::arqvalor.status_objetivo
        WHEN r_percentual >= 100 THEN 'ATINGIDO'::arqvalor.status_objetivo
        ELSE                          'EM_PROGRESSO'::arqvalor.status_objetivo
    END;
END;
$$;

-- ── 5. View: adiciona saldo_base e crescimento_mensal_necessario ─
--    DROP + CREATE porque ALTER VIEW não permite reordenar colunas.

DROP VIEW IF EXISTS arqvalor.vw_objetivos_detalhes;

CREATE VIEW arqvalor.vw_objetivos_detalhes
WITH (security_invoker = true)
AS
SELECT
    o.id, o.user_id, o.tipo, o.nome, o.descricao, o.icone, o.cor, o.ativo,
    o.valor_meta,
    o.saldo_base,
    o.valor_atingido,
    o.percentual,
    o.status,
    o.data_inicio,
    o.data_fim,
    GREATEST(0, (o.data_fim - CURRENT_DATE)::INT) AS dias_restantes,
    o.conta_id,
    c.nome        AS conta_nome,
    o.categoria_id,
    cat.descricao AS categoria_descricao,
    o.frequencia,
    o.contas_projeto,
    o.contas_sonho,
    o.categorias_objetivo,
    o.revisoes,
    o.criado_em,
    o.atualizado_em,
    -- Estimativa mensal: quanto precisa crescer por mês para atingir a meta
    -- Fórmula: (valor_meta − saldo_atual) / meses_restantes
    -- Apenas para SONHO em progresso com prazo futuro.
    CASE
        WHEN o.tipo = 'SONHO' AND o.status = 'EM_PROGRESSO' THEN
            GREATEST(0, o.valor_meta - o.saldo_base - o.valor_atingido) /
            NULLIF(
                GREATEST(1,
                    (DATE_PART('year',  o.data_fim) - DATE_PART('year',  CURRENT_DATE))::INT * 12 +
                    (DATE_PART('month', o.data_fim) - DATE_PART('month', CURRENT_DATE))::INT
                ),
            0)
        ELSE NULL
    END AS crescimento_mensal_necessario
FROM arqvalor.objetivos o
LEFT JOIN arqvalor.contas     c   ON c.id   = o.conta_id
LEFT JOIN arqvalor.categorias cat ON cat.id = o.categoria_id;

-- ── 6. Forçar recálculo de todos os sonhos existentes ────────────

UPDATE arqvalor.objetivos
SET atualizado_em = NOW()
WHERE tipo = 'SONHO';
