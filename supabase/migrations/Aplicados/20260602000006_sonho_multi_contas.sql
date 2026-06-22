-- Adiciona suporte a múltiplas contas para o tipo SONHO.
-- Retrocompatível: conta_id permanece; funções usam contas_sonho quando não vazio.

ALTER TABLE arqvalor.objetivos
    ADD COLUMN IF NOT EXISTS contas_sonho UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- Migra dados existentes
UPDATE arqvalor.objetivos
SET contas_sonho = ARRAY[conta_id]
WHERE tipo = 'SONHO'
  AND conta_id IS NOT NULL
  AND array_length(contas_sonho, 1) IS NULL;

-- Atualiza view — DROP + CREATE pelo mesmo motivo da migration 005
DROP VIEW IF EXISTS arqvalor.vw_objetivos_detalhes;

CREATE VIEW arqvalor.vw_objetivos_detalhes
WITH (security_invoker = true)
AS
SELECT
    o.id, o.user_id, o.tipo, o.nome, o.descricao, o.icone, o.cor, o.ativo,
    o.valor_meta, o.valor_atingido, o.percentual, o.status,
    o.data_inicio, o.data_fim,
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
    o.atualizado_em
FROM arqvalor.objetivos o
LEFT JOIN arqvalor.contas     c   ON c.id   = o.conta_id
LEFT JOIN arqvalor.categorias cat ON cat.id = o.categoria_id;

-- ── fn_atualizar_progresso_objetivo ─────────────────────────

CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_progresso_objetivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_valor    NUMERIC  := 0;
    v_pct      SMALLINT;
    v_periodos INTEGER  := 1;
    v_ref_fim  DATE;
    v_cats     UUID[]   := ARRAY[]::UUID[];
    v_contas   UUID[]   := ARRAY[]::UUID[];
    v_bal      NUMERIC;
BEGIN
    -- ── SONHO: soma dos saldos de N contas ──────────────────────
    IF NEW.tipo = 'SONHO' THEN
        v_contas := CASE
            WHEN array_length(NEW.contas_sonho, 1) > 0 THEN NEW.contas_sonho
            WHEN NEW.conta_id IS NOT NULL              THEN ARRAY[NEW.conta_id]
            ELSE ARRAY[]::UUID[]
        END;

        IF array_length(v_contas, 1) > 0 THEN
            SELECT COALESCE(SUM(sub.saldo), 0)
            INTO v_valor
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
                      AND t.data    <= CURRENT_DATE
                WHERE c.id = ANY(v_contas)
                GROUP BY c.id, c.saldo_inicial, c.tipo
            ) sub;
        END IF;

    -- ── OBJETIVO: média por período em N categorias ────────────
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
                    (DATE_PART('year',  v_ref_fim) - DATE_PART('year',  NEW.data_inicio))::INTEGER * 12 +
                    (DATE_PART('month', v_ref_fim) - DATE_PART('month', NEW.data_inicio))::INTEGER + 1);
            ELSIF NEW.frequencia = 'ANUAL' THEN
                v_periodos := GREATEST(1,
                    (DATE_PART('year', v_ref_fim) - DATE_PART('year', NEW.data_inicio))::INTEGER + 1);
            ELSIF NEW.frequencia = 'SEMANAL' THEN
                v_periodos := GREATEST(1, ((v_ref_fim - NEW.data_inicio) / 7 + 1)::INTEGER);
            END IF;
            SELECT COALESCE(SUM(t.valor), 0) / v_periodos INTO v_valor
            FROM arqvalor.transacoes t
            WHERE t.categoria_id = ANY(v_cats) AND t.tipo = 'RECEITA'
              AND t.data >= NEW.data_inicio AND t.data <= v_ref_fim;
        END IF;

    -- ── PROJETO ────────────────────────────────────────────────
    ELSIF NEW.tipo = 'PROJETO' AND array_length(NEW.contas_projeto, 1) > 0 THEN
        SELECT COALESCE(SUM(t.valor), 0) INTO v_valor
        FROM arqvalor.transacoes t
        WHERE t.conta_id = ANY(NEW.contas_projeto) AND t.tipo = 'DESPESA'
          AND (NEW.categoria_id IS NULL OR t.categoria_id = NEW.categoria_id)
          AND t.data >= NEW.data_inicio AND t.data <= CURRENT_DATE;
    END IF;

    v_valor := COALESCE(v_valor, 0);
    v_pct   := LEAST(100, GREATEST(0,
        CASE WHEN NEW.valor_meta > 0 THEN (v_valor * 100 / NEW.valor_meta)::SMALLINT ELSE 0 END));
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

-- ── fn_calcular_progresso_objetivo ──────────────────────────

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
    v          arqvalor.objetivos%ROWTYPE;
    v_periodos INTEGER := 1;
    v_ref_fim  DATE;
    v_cats     UUID[]  := ARRAY[]::UUID[];
    v_contas   UUID[]  := ARRAY[]::UUID[];
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
            SELECT COALESCE(SUM(sub.saldo), 0) INTO r_valor_atingido
            FROM (
                SELECT c.saldo_inicial + COALESCE(SUM(
                    CASE WHEN c.tipo='CARTAO' AND t.status='PROJECAO' THEN 0
                         WHEN t.tipo='RECEITA' THEN  t.valor
                         WHEN t.tipo='DESPESA' THEN -t.valor
                         ELSE 0 END
                ), 0) AS saldo
                FROM arqvalor.contas c
                LEFT JOIN arqvalor.transacoes t ON t.conta_id=c.id AND t.data<=CURRENT_DATE
                WHERE c.id = ANY(v_contas)
                GROUP BY c.id, c.saldo_inicial, c.tipo
            ) sub;
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
                    (DATE_PART('year',v_ref_fim)-DATE_PART('year',v.data_inicio))::INTEGER*12+
                    (DATE_PART('month',v_ref_fim)-DATE_PART('month',v.data_inicio))::INTEGER+1);
            ELSIF v.frequencia = 'ANUAL' THEN
                v_periodos := GREATEST(1,
                    (DATE_PART('year',v_ref_fim)-DATE_PART('year',v.data_inicio))::INTEGER+1);
            ELSIF v.frequencia = 'SEMANAL' THEN
                v_periodos := GREATEST(1, ((v_ref_fim-v.data_inicio)/7+1)::INTEGER);
            END IF;
            SELECT COALESCE(SUM(t.valor),0)/v_periodos INTO r_valor_atingido
            FROM arqvalor.transacoes t
            WHERE t.categoria_id=ANY(v_cats) AND t.tipo='RECEITA'
              AND t.data>=v.data_inicio AND t.data<=v_ref_fim;
        END IF;

    ELSIF v.tipo = 'PROJETO' AND array_length(v.contas_projeto, 1) > 0 THEN
        SELECT COALESCE(SUM(t.valor),0) INTO r_valor_atingido
        FROM arqvalor.transacoes t
        WHERE t.conta_id=ANY(v.contas_projeto) AND t.tipo='DESPESA'
          AND (v.categoria_id IS NULL OR t.categoria_id=v.categoria_id)
          AND t.data>=v.data_inicio AND t.data<=CURRENT_DATE;
    END IF;

    r_valor_atingido := COALESCE(r_valor_atingido, 0);
    r_percentual := LEAST(100, GREATEST(0,
        CASE WHEN v.valor_meta>0 THEN (r_valor_atingido*100/v.valor_meta)::SMALLINT ELSE 0 END));
    r_status := CASE
        WHEN NOT v.ativo         THEN 'CANCELADO'::arqvalor.status_objetivo
        WHEN r_percentual >= 100 THEN 'ATINGIDO'::arqvalor.status_objetivo
        ELSE                          'EM_PROGRESSO'::arqvalor.status_objetivo
    END;
END;
$$;
