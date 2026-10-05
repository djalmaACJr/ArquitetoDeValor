-- ============================================================
-- "Usuários agregados" — Fase 3: Objetivos (leitura + escrita por um
-- agregado com o módulo OBJETIVOS liberado).
--
-- Decisões já fechadas com o usuário (não renegociar):
--   • SONHO/PROJETO (baseados em conta) só ficam visíveis ao agregado se
--     TODAS as contas monitoradas (`contas_sonho[]`/`contas_projeto[]`,
--     com fallback pro `conta_id` legado) estiverem na lista de contas
--     liberadas do vínculo (mesma lista compartilhada de EXTRATO/
--     INVESTIMENTOS — `agregados_contas` não tem coluna de módulo).
--   • OBJETIVO/CRESCIMENTO (baseados em categoria) ficam visíveis sempre
--     que o módulo OBJETIVOS estiver liberado — não existe "escopo de
--     categoria" nesta feature (não pedido, exigiria reescrever o cálculo
--     de progresso pra filtrar por categoria por vínculo).
--   • Achado ANTES de liberar escrita de agregado (confirmado com o
--     usuário, ago/2026): fn_atualizar_progresso_objetivo,
--     fn_calcular_progresso_objetivo e fn_saldo_contas_ate nunca
--     filtravam `transacoes`/`contas` por user_id — dependiam só da RLS
--     de quem estivesse chamando. Pro PRÓPRIO dono isso sempre deu certo
--     "por coincidência" (auth.uid() = user_id do objetivo). Mas um
--     agregado criando/editando/sincronizando um objetivo do dono dispara
--     o MESMO trigger com auth.uid() = agregado — sem o filtro explícito,
--     o cálculo usaria as transações que O AGREGADO enxerga, não as do
--     dono, dando valor_atingido/percentual errados silenciosamente.
--     Mesma classe de bug já corrigida em fn_saldo_total_antes_de na
--     Fase 1 (20261001000002) — mesma correção aqui: todo SELECT em
--     transacoes/contas ganha `AND t.user_id = <dono>` explícito.
--
-- Só policies ADICIONAIS permissivas (nunca reescreve obj_select/
-- obj_insert/obj_update/obj_delete) — mesmo padrão das Fases 0/1/2.
--
-- Idempotente: CREATE OR REPLACE / ALTER TABLE IF NOT EXISTS / DO-EXCEPTION.
-- ============================================================

-- ── 1. fn_saldo_contas_ate — ganha p_user_id, filtra contas/transacoes ──
CREATE OR REPLACE FUNCTION arqvalor.fn_saldo_contas_ate(
    p_contas  UUID[],
    p_data    DATE,
    p_user_id UUID DEFAULT NULL
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
              AND t.user_id = p_user_id
        WHERE c.id = ANY(p_contas)
          AND c.user_id = p_user_id
        GROUP BY c.id, c.saldo_inicial, c.tipo
    ) sub;
$$;

-- ── 2. fn_atualizar_progresso_objetivo (trigger) — mesma lógica de
--    20260806000006, só com `AND t.user_id = NEW.user_id` em cada SELECT
--    de transacoes e `NEW.user_id` passado pra fn_saldo_contas_ate. ──
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
    v_ano_base    INTEGER;
    v_ano_comp    INTEGER;
    v_ano_prev    INTEGER;
    v_prev_sum    NUMERIC  := 0;
    v_comp_sum    NUMERIC  := 0;
    v_cutoff_prev DATE;
BEGIN
    IF NEW.tipo = 'SONHO' THEN
        v_contas := CASE
            WHEN array_length(NEW.contas_sonho, 1) > 0 THEN NEW.contas_sonho
            WHEN NEW.conta_id IS NOT NULL              THEN ARRAY[NEW.conta_id]
            ELSE ARRAY[]::UUID[]
        END;

        IF array_length(v_contas, 1) > 0 THEN
            v_base  := arqvalor.fn_saldo_contas_ate(v_contas, NEW.data_inicio - 1, NEW.user_id);
            v_valor := arqvalor.fn_saldo_contas_ate(v_contas, CURRENT_DATE, NEW.user_id) - v_base;
        END IF;

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
              AND t.user_id = NEW.user_id
              AND t.data >= NEW.data_inicio AND t.data <= v_ref_fim;
        END IF;

    ELSIF NEW.tipo = 'PROJETO' AND array_length(NEW.contas_projeto, 1) > 0 THEN
        SELECT COALESCE(SUM(t.valor), 0) INTO v_valor
        FROM arqvalor.transacoes t
        WHERE t.conta_id = ANY(NEW.contas_projeto) AND t.tipo = 'DESPESA'
          AND t.user_id = NEW.user_id
          AND (NEW.categoria_id IS NULL OR t.categoria_id = NEW.categoria_id)
          AND t.data >= NEW.data_inicio AND t.data <= CURRENT_DATE;

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
                  AND t.user_id = NEW.user_id
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_prev
                  AND t.data <= v_cutoff_prev;

                SELECT COALESCE(SUM(
                    CASE WHEN t.tipo='RECEITA' THEN  t.valor
                         WHEN t.tipo='DESPESA' THEN -t.valor
                         ELSE 0 END), 0) INTO v_comp_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats)
                  AND t.user_id = NEW.user_id
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_comp
                  AND t.data <= CURRENT_DATE;

                IF v_prev_sum > 0 THEN
                    v_valor := ((v_comp_sum - v_prev_sum) / v_prev_sum) * 100;
                END IF;
            END IF;
        END IF;
    END IF;

    v_valor := COALESCE(v_valor, 0);

    v_denominador := CASE
        WHEN NEW.tipo = 'SONHO' THEN NULLIF(NEW.valor_meta - v_base, 0)
        ELSE                         NULLIF(NEW.valor_meta, 0)
    END;

    -- Achado real (ago/2026, ao rodar o backfill de criado_por em massa
    -- nesta mesma migration): o ::SMALLINT original fazia o cast ANTES do
    -- clamp — um objetivo com valor_atingido desproporcional ao
    -- denominador (ex.: meta muito pequena) estourava o range do smallint
    -- (±32767) antes do LEAST(100,...) ter chance de limitar. Clampa em
    -- NUMERIC primeiro, só casta pra SMALLINT no final — pré-existente,
    -- não causado pela Fase 3, só nunca tinha sido exercitado por um
    -- UPDATE em massa cobrindo TODOS os objetivos de uma vez.
    v_pct := (LEAST(100, GREATEST(0,
        CASE WHEN v_denominador IS NOT NULL
             THEN (v_valor * 100 / v_denominador)
             ELSE 0
        END)))::SMALLINT;

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

-- ── 3. fn_calcular_progresso_objetivo — mesma correção, usando v.user_id ──
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
            r_valor_atingido := arqvalor.fn_saldo_contas_ate(v_contas, CURRENT_DATE, v.user_id) - v.saldo_base;
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
              AND t.user_id = v.user_id
              AND t.data >= v.data_inicio AND t.data <= v_ref_fim;
        END IF;

    ELSIF v.tipo = 'PROJETO' AND array_length(v.contas_projeto, 1) > 0 THEN
        SELECT COALESCE(SUM(t.valor), 0) INTO r_valor_atingido
        FROM arqvalor.transacoes t
        WHERE t.conta_id = ANY(v.contas_projeto) AND t.tipo = 'DESPESA'
          AND t.user_id = v.user_id
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
                  AND t.user_id = v.user_id
                  AND DATE_PART('year', t.data)::INTEGER = v_ano_prev
                  AND t.data <= v_cutoff_prev;

                SELECT COALESCE(SUM(
                    CASE WHEN t.tipo='RECEITA' THEN  t.valor
                         WHEN t.tipo='DESPESA' THEN -t.valor
                         ELSE 0 END), 0) INTO v_comp_sum
                FROM arqvalor.transacoes t
                WHERE t.categoria_id = ANY(v_cats)
                  AND t.user_id = v.user_id
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

    -- Mesma correção de ordem do clamp — ver comentário em
    -- fn_atualizar_progresso_objetivo acima.
    r_percentual := (LEAST(100, GREATEST(0,
        CASE WHEN v_denominador IS NOT NULL
             THEN (r_valor_atingido * 100 / v_denominador)
             ELSE 0
        END)))::SMALLINT;

    r_status := CASE
        WHEN NOT v.ativo         THEN 'CANCELADO'::arqvalor.status_objetivo
        WHEN r_percentual >= 100 THEN 'ATINGIDO'::arqvalor.status_objetivo
        ELSE                          'EM_PROGRESSO'::arqvalor.status_objetivo
    END;
END;
$$;

-- ── 4. fn_sincronizar_progresso_objetivo — opera sob p_user_id (não mais
--    auth.uid() hardcoded no corpo), libera chamada por agregado com
--    OBJETIVOS + escrita (sincronizar recalcula/grava, então exige
--    escrita mesmo sendo "só" um refresh de valor derivado). ──
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
    -- Permite sincronizar os PRÓPRIOS objetivos ou, como agregado com
    -- OBJETIVOS liberado E pode_escrever, os do dono que autorizou.
    IF p_user_id IS DISTINCT FROM auth.uid()
       AND NOT arqvalor.fn_agregado_tem_acesso(p_user_id, 'OBJETIVOS', NULL, true) THEN
        RAISE EXCEPTION 'ACESSO_NEGADO'
            USING DETAIL = 'p_user_id deve ser o usuário autenticado ou um dono que liberou OBJETIVOS (com edição) a ele.';
    END IF;

    FOR v_obj IN
        SELECT id FROM arqvalor.objetivos
        WHERE user_id = p_user_id AND ativo = true
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

    INSERT INTO arqvalor.objetivos_progresso (objetivo_id, data_snapshot, valor_atingido, percentual)
    SELECT id, CURRENT_DATE, valor_atingido, percentual
    FROM arqvalor.objetivos
    WHERE user_id = p_user_id AND ativo = true
    ON CONFLICT (objetivo_id, data_snapshot) DO NOTHING;

    RETURN QUERY SELECT v_count;
END;
$$;

-- ── 5. objetivos.criado_por — mesmo padrão de transacoes (Fase 2) ──
ALTER TABLE arqvalor.objetivos
  ADD COLUMN IF NOT EXISTS criado_por UUID REFERENCES arqvalor.usuarios(id) ON DELETE SET NULL;

UPDATE arqvalor.objetivos SET criado_por = user_id WHERE criado_por IS NULL;

-- Reusa a mesma função de default já criada em 20261002000001 (genérica,
-- não específica de transacoes).
DROP TRIGGER IF EXISTS trg_objetivos_default_criado_por ON arqvalor.objetivos;
CREATE TRIGGER trg_objetivos_default_criado_por
  BEFORE INSERT ON arqvalor.objetivos
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_default_criado_por();

-- ── 6. fn_agregado_pode_ver_objetivo — materializa a decisão de escopo ──
CREATE OR REPLACE FUNCTION arqvalor.fn_agregado_pode_ver_objetivo(
  p_dono_id        UUID,
  p_tipo           arqvalor.tipo_objetivo,
  p_conta_id       UUID,
  p_contas_sonho   UUID[],
  p_contas_projeto UUID[],
  p_escrita        BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT CASE
    -- Módulo OBJETIVOS (+ escrita, se exigida) precisa estar liberado
    -- antes de qualquer outra checagem, sempre.
    WHEN NOT arqvalor.fn_agregado_tem_acesso(p_dono_id, 'OBJETIVOS', NULL, p_escrita) THEN false
    -- OBJETIVO/CRESCIMENTO: sem escopo de categoria — módulo liberado basta.
    WHEN p_tipo IN ('OBJETIVO', 'CRESCIMENTO') THEN true
    -- SONHO: todas as contas monitoradas (array, com fallback legado)
    -- precisam estar na lista de contas liberadas do vínculo.
    WHEN p_tipo = 'SONHO' THEN (
      CASE
        WHEN array_length(p_contas_sonho, 1) > 0 THEN NOT EXISTS (
          SELECT 1 FROM unnest(p_contas_sonho) AS conta
          WHERE NOT arqvalor.fn_agregado_tem_acesso(p_dono_id, 'OBJETIVOS', conta, p_escrita)
        )
        WHEN p_conta_id IS NOT NULL THEN
          arqvalor.fn_agregado_tem_acesso(p_dono_id, 'OBJETIVOS', p_conta_id, p_escrita)
        ELSE false
      END
    )
    -- PROJETO: mesma lógica de SONHO, só com o array de contas_projeto
    -- (não tem fallback singular — contas_projeto é sempre obrigatório).
    WHEN p_tipo = 'PROJETO' THEN (
      array_length(p_contas_projeto, 1) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(p_contas_projeto) AS conta
        WHERE NOT arqvalor.fn_agregado_tem_acesso(p_dono_id, 'OBJETIVOS', conta, p_escrita)
      )
    )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_agregado_pode_ver_objetivo(UUID, arqvalor.tipo_objetivo, UUID, UUID[], UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_agregado_pode_ver_objetivo(UUID, arqvalor.tipo_objetivo, UUID, UUID[], UUID[], BOOLEAN) TO authenticated;

-- ── 7. RLS: objetivos — leitura e escrita de agregado ──
DO $$ BEGIN
  CREATE POLICY pol_objetivos_agregado_select ON arqvalor.objetivos
    FOR SELECT USING (
      arqvalor.fn_agregado_pode_ver_objetivo(user_id, tipo, conta_id, contas_sonho, contas_projeto)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY pol_objetivos_agregado_insert ON arqvalor.objetivos
    FOR INSERT WITH CHECK (
      arqvalor.fn_agregado_pode_ver_objetivo(user_id, tipo, conta_id, contas_sonho, contas_projeto, true)
      AND criado_por = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY pol_objetivos_agregado_update ON arqvalor.objetivos
    FOR UPDATE
    USING      (arqvalor.fn_agregado_pode_ver_objetivo(user_id, tipo, conta_id, contas_sonho, contas_projeto, true))
    WITH CHECK (arqvalor.fn_agregado_pode_ver_objetivo(user_id, tipo, conta_id, contas_sonho, contas_projeto, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY pol_objetivos_agregado_delete ON arqvalor.objetivos
    FOR DELETE USING (
      arqvalor.fn_agregado_pode_ver_objetivo(user_id, tipo, conta_id, contas_sonho, contas_projeto, true)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 8. RLS: objetivos_progresso — leitura de agregado ──
-- Explícito (não depende de cascateamento implícito de RLS) pra ficar
-- auditável igual ao resto do padrão do projeto.
DO $$ BEGIN
  CREATE POLICY pol_objetivos_progresso_agregado_select ON arqvalor.objetivos_progresso
    FOR SELECT USING (
      objetivo_id IN (
        SELECT o.id FROM arqvalor.objetivos o
        WHERE arqvalor.fn_agregado_pode_ver_objetivo(o.user_id, o.tipo, o.conta_id, o.contas_sonho, o.contas_projeto)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 9. contas/categorias — OBJETIVOS também libera visibilidade ──
-- Sem isto, um agregado com SÓ o módulo OBJETIVOS (sem EXTRATO/
-- INVESTIMENTOS) não conseguiria ver o nome da conta/categoria por trás
-- de um objetivo que já pode ver (vw_objetivos_detalhes faz LEFT JOIN em
-- contas/categorias, que tem RLS própria), nem criar/validar um SONHO/
-- PROJETO/OBJETIVO/CRESCIMENTO novo (o POST /objetivos confere existência
-- da conta/categoria via SELECT, que também depende dessa RLS). A lista
-- de contas liberadas já é compartilhada entre módulos (agregados_contas
-- não distingue módulo) — isto só reconhece OBJETIVOS como mais um motivo
-- válido de visibilidade, no mesmo espírito de EXTRATO/INVESTIMENTOS.
ALTER POLICY pol_contas_agregado_select ON arqvalor.contas
  USING (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', id)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', id)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'OBJETIVOS', id)
  );

ALTER POLICY pol_categorias_agregado_select ON arqvalor.categorias
  USING (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO')
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'OBJETIVOS')
  );
