-- Fix: fn_atualizar_progresso_objetivo e fn_calcular_progresso_objetivo
-- O SELECT do tipo SONHO combinava c.saldo_inicial (coluna não-agregada) com
-- SUM(...) sem GROUP BY — erro PostgreSQL "must appear in GROUP BY clause".
-- Solução: GROUP BY c.id (PK) implica dependência funcional de todas as outras
-- colunas da tabela (comportamento padrão do PostgreSQL 9.1+).

-- ── fn_atualizar_progresso_objetivo (BEFORE trigger) ────────────

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
        WHERE c.id = NEW.conta_id
        GROUP BY c.id;

    ELSIF NEW.tipo = 'OBJETIVO' AND NEW.categoria_id IS NOT NULL THEN
        SELECT COALESCE(SUM(t.valor), 0)
        INTO v_valor
        FROM arqvalor.transacoes t
        WHERE t.categoria_id = NEW.categoria_id
          AND t.tipo         = 'RECEITA'
          AND t.data        >= NEW.data_inicio
          AND t.data        <= NEW.data_fim;

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

-- ── fn_calcular_progresso_objetivo (sync / RPC) ─────────────────

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
        WHERE c.id = v.conta_id
        GROUP BY c.id;

    ELSIF v.tipo = 'OBJETIVO' AND v.categoria_id IS NOT NULL THEN
        SELECT COALESCE(SUM(t.valor), 0)
        INTO r_valor_atingido
        FROM arqvalor.transacoes t
        WHERE t.categoria_id = v.categoria_id
          AND t.tipo         = 'RECEITA'
          AND t.data        >= v.data_inicio
          AND t.data        <= v.data_fim;

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
