-- Fix: OBJETIVO com frequência deve comparar média por período, não total acumulado.
--
-- Problema: SUM(receitas) / valor_meta comparava o total do período inteiro contra
-- uma meta mensal, tornando atingido logo após 1 mês de recebimentos normais.
--
-- Correção: quando frequencia IS NOT NULL, divide o total pelo número de períodos
-- decorridos desde data_inicio até min(CURRENT_DATE, data_fim).
--
-- Exemplo: meta = R$500/mês, recebendo R$400/mês há 5 meses
--   Antes:  valor_atingido = 2000 → percentual = 100% (ATINGIDO) ← ERRADO
--   Depois: valor_atingido = 400  → percentual = 80% (EM_PROGRESSO) ← CORRETO
--
-- Cálculo de períodos (MENSAL):
--   periodos = (anos_decorridos * 12 + meses_decorridos) + 1
--   inclui o mês corrente (mesmo que parcial) para refletir o progresso em tempo real.

-- ── fn_atualizar_progresso_objetivo (BEFORE trigger) ────────────

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
BEGIN
    -- ── SONHO: saldo atual da conta ──────────────────────────────
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

    -- ── OBJETIVO: média de RECEITA da categoria por período ───────
    ELSIF NEW.tipo = 'OBJETIVO' AND NEW.categoria_id IS NOT NULL THEN
        v_ref_fim := LEAST(CURRENT_DATE, NEW.data_fim);

        -- Calcula períodos decorridos conforme a frequência
        IF NEW.frequencia = 'MENSAL' THEN
            v_periodos := GREATEST(1,
                (DATE_PART('year',  v_ref_fim) - DATE_PART('year',  NEW.data_inicio))::INTEGER * 12 +
                (DATE_PART('month', v_ref_fim) - DATE_PART('month', NEW.data_inicio))::INTEGER + 1
            );
        ELSIF NEW.frequencia = 'ANUAL' THEN
            v_periodos := GREATEST(1,
                (DATE_PART('year', v_ref_fim) - DATE_PART('year', NEW.data_inicio))::INTEGER + 1
            );
        ELSIF NEW.frequencia = 'SEMANAL' THEN
            v_periodos := GREATEST(1, ((v_ref_fim - NEW.data_inicio) / 7 + 1)::INTEGER);
        ELSE
            v_periodos := 1; -- DIARIA ou sem frequência: usa o total direto
        END IF;

        SELECT COALESCE(SUM(t.valor), 0) / v_periodos
        INTO v_valor
        FROM arqvalor.transacoes t
        WHERE t.categoria_id = NEW.categoria_id
          AND t.tipo         = 'RECEITA'
          AND t.data        >= NEW.data_inicio
          AND t.data        <= v_ref_fim;

    -- ── PROJETO: soma de DESPESA nas contas do projeto ────────────
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
    v          arqvalor.objetivos%ROWTYPE;
    v_periodos INTEGER := 1;
    v_ref_fim  DATE;
BEGIN
    SELECT * INTO v FROM arqvalor.objetivos WHERE id = p_objetivo_id;
    IF NOT FOUND THEN
        r_valor_atingido := 0; r_percentual := 0; r_status := 'EM_PROGRESSO';
        RETURN;
    END IF;

    r_valor_atingido := 0;

    -- ── SONHO ─────────────────────────────────────────────────────
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

    -- ── OBJETIVO ──────────────────────────────────────────────────
    ELSIF v.tipo = 'OBJETIVO' AND v.categoria_id IS NOT NULL THEN
        v_ref_fim := LEAST(CURRENT_DATE, v.data_fim);

        IF v.frequencia = 'MENSAL' THEN
            v_periodos := GREATEST(1,
                (DATE_PART('year',  v_ref_fim) - DATE_PART('year',  v.data_inicio))::INTEGER * 12 +
                (DATE_PART('month', v_ref_fim) - DATE_PART('month', v.data_inicio))::INTEGER + 1
            );
        ELSIF v.frequencia = 'ANUAL' THEN
            v_periodos := GREATEST(1,
                (DATE_PART('year', v_ref_fim) - DATE_PART('year', v.data_inicio))::INTEGER + 1
            );
        ELSIF v.frequencia = 'SEMANAL' THEN
            v_periodos := GREATEST(1, ((v_ref_fim - v.data_inicio) / 7 + 1)::INTEGER);
        ELSE
            v_periodos := 1;
        END IF;

        SELECT COALESCE(SUM(t.valor), 0) / v_periodos
        INTO r_valor_atingido
        FROM arqvalor.transacoes t
        WHERE t.categoria_id = v.categoria_id
          AND t.tipo         = 'RECEITA'
          AND t.data        >= v.data_inicio
          AND t.data        <= v_ref_fim;

    -- ── PROJETO ───────────────────────────────────────────────────
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
