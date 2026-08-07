-- 20260806000006_crescimento_comp_ytd_reconciliado.sql
--
-- AUD-03 (auditoria 06/08/2026): reconcilia o cálculo de CRESCIMENTO no
-- banco com o que a tela ObjetivoDetalhe.tsx já calcula no client.
--
-- ORIGEM DA DIVERGÊNCIA:
--   20260603000006_crescimento_comp_ytd.sql introduziu a versão completa
--   do cálculo (YoY + YTD + NET + corte proporcional em CURRENT_DATE nos
--   dois anos comparados). Depois, 20260605000001_sonho_saldo_base.sql
--   recriou as MESMAS duas funções (fn_atualizar_progresso_objetivo /
--   fn_calcular_progresso_objetivo) para adicionar saldo_base ao SONHO —
--   mas usou como base um CREATE OR REPLACE anterior à v2 do CRESCIMENTO,
--   reintroduzindo sem intenção a versão v1 (ano-base fixo, só receita,
--   sem proporcionalidade YTD). Documentado como divergência conhecida em
--   BUSINESS_RULES.md § "Cálculo de CRESCIMENTO".
--
-- EFEITO PRÁTICO: objetivos.valor_atingido/percentual/status (usados no
-- card da listagem e no RPC de sincronização em massa) ficavam
-- desatualizados/desproporcionais em relação ao gráfico da tela de
-- detalhe, que sempre recalculou a versão correta a partir das
-- transações brutas.
--
-- ESTA MIGRATION: recria as duas funções unindo o que há de mais atual
-- em cada uma — saldo_base para SONHO (de 20260605000001) + YoY/YTD/NET/
-- COMP_YTD para CRESCIMENTO (de 20260603000006). OBJETIVO e PROJETO não
-- mudam. Idempotente (CREATE OR REPLACE) e sem alteração de schema.

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
    -- CRESCIMENTO (YoY/YTD/NET/COMP_YTD)
    v_ano_base    INTEGER;
    v_ano_comp    INTEGER;
    v_ano_prev    INTEGER;
    v_prev_sum    NUMERIC  := 0;
    v_comp_sum    NUMERIC  := 0;
    v_cutoff_prev DATE;
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

    -- ── CRESCIMENTO: líquido (receita − despesa) por categoria,
    --    ano corrente (parcial, cortado em CURRENT_DATE) vs. mesmo
    --    trecho YTD do ano anterior — espelha ObjetivoDetalhe.tsx ──
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
            v_ano_prev := GREATEST(v_ano_base, v_ano_comp - 1);

            IF v_ano_comp > v_ano_base THEN
                IF DATE_PART('year', CURRENT_DATE)::INTEGER = v_ano_comp
                   AND CURRENT_DATE < (v_ano_comp::TEXT || '-12-31')::DATE THEN
                    v_cutoff_prev := (v_ano_prev::TEXT || '-01-01')::DATE +
                        (CURRENT_DATE - (v_ano_comp::TEXT || '-01-01')::DATE);
                    IF v_cutoff_prev > (v_ano_prev::TEXT || '-12-31')::DATE THEN
                        v_cutoff_prev := (v_ano_prev::TEXT || '-12-31')::DATE;
                    END IF;
                ELSE
                    v_cutoff_prev := (v_ano_prev::TEXT || '-12-31')::DATE;
                END IF;

                SELECT COALESCE(SUM(
                    CASE WHEN t.tipo='RECEITA' THEN  t.valor
                         WHEN t.tipo='DESPESA' THEN -t.valor
                         ELSE 0 END), 0) INTO v_prev_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats)
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_prev
                  AND t.data <= v_cutoff_prev;

                SELECT COALESCE(SUM(
                    CASE WHEN t.tipo='RECEITA' THEN  t.valor
                         WHEN t.tipo='DESPESA' THEN -t.valor
                         ELSE 0 END), 0) INTO v_comp_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats)
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_comp
                  AND t.data <= CURRENT_DATE;

                IF v_prev_sum > 0 THEN
                    v_valor := ((v_comp_sum - v_prev_sum) / v_prev_sum) * 100;
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

-- ── fn_calcular_progresso_objetivo (usado por GET/sincronizar) ────
--    Mesma reconciliação, versão STABLE (sem gravar) usada pelo RPC
--    de sincronização em massa e por leituras avulsas.

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
    -- CRESCIMENTO (YoY/YTD/NET/COMP_YTD)
    v_ano_base    INTEGER;
    v_ano_comp    INTEGER;
    v_ano_prev    INTEGER;
    v_prev_sum    NUMERIC := 0;
    v_comp_sum    NUMERIC := 0;
    v_cutoff_prev DATE;
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
            v_ano_prev := GREATEST(v_ano_base, v_ano_comp - 1);

            IF v_ano_comp > v_ano_base THEN
                IF DATE_PART('year', CURRENT_DATE)::INTEGER = v_ano_comp
                   AND CURRENT_DATE < (v_ano_comp::TEXT || '-12-31')::DATE THEN
                    v_cutoff_prev := (v_ano_prev::TEXT || '-01-01')::DATE +
                        (CURRENT_DATE - (v_ano_comp::TEXT || '-01-01')::DATE);
                    IF v_cutoff_prev > (v_ano_prev::TEXT || '-12-31')::DATE THEN
                        v_cutoff_prev := (v_ano_prev::TEXT || '-12-31')::DATE;
                    END IF;
                ELSE
                    v_cutoff_prev := (v_ano_prev::TEXT || '-12-31')::DATE;
                END IF;

                SELECT COALESCE(SUM(
                    CASE WHEN t.tipo='RECEITA' THEN  t.valor
                         WHEN t.tipo='DESPESA' THEN -t.valor
                         ELSE 0 END), 0) INTO v_prev_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats)
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_prev
                  AND t.data <= v_cutoff_prev;

                SELECT COALESCE(SUM(
                    CASE WHEN t.tipo='RECEITA' THEN  t.valor
                         WHEN t.tipo='DESPESA' THEN -t.valor
                         ELSE 0 END), 0) INTO v_comp_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats)
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_comp
                  AND t.data <= CURRENT_DATE;

                IF v_prev_sum > 0 THEN
                    r_valor_atingido := ((v_comp_sum - v_prev_sum) / v_prev_sum) * 100;
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

-- ── Forçar recálculo de todos os objetivos CRESCIMENTO existentes ─
--    (SONHO/OBJETIVO/PROJETO não mudaram nesta migration — não
--    precisam de recálculo.)

UPDATE arqvalor.objetivos
SET atualizado_em = NOW()
WHERE tipo = 'CRESCIMENTO';
