-- ============================================================
-- Fechamento de período (v7.5.0) — performance do cálculo de saldo
--
-- Problema: todo saldo (vw_saldo_contas, fn_saldos_contas_ate_data,
-- fn_saldo_total_antes_de, ...) somava o HISTÓRICO INTEIRO de transações
-- da conta. Com anos de lançamentos isso vira o principal custo do Extrato,
-- do Dashboard e da lista de Contas.
--
-- Solução: o usuário define uma DATA DE FECHAMENTO (no máximo hoje − 1 ano).
-- Para cada conta guardamos o saldo acumulado até essa data (inclusive); a
-- partir daí qualquer saldo = snapshot + soma só das transações POSTERIORES.
--   • saldo_fechamento        — regra de cartão (CARTAO ignora PROJECAO):
--                               usado por vw_saldo_contas e fn_saldo_contas_ate.
--   • saldo_fechamento_bruto  — soma todos os status: usado por
--                               fn_saldos_contas_ate_data, fn_saldo_conta_ate_data
--                               e fn_saldo_total_antes_de (que hoje NÃO aplicam
--                               a exceção de cartão — preservado igual).
-- Para contas que não são CARTAO os dois valores são idênticos.
--
-- Consistência: lançamento criado/alterado/excluído em data <= fechamento
-- (ou mudança de saldo_inicial/tipo da conta) ajusta o snapshot na hora, por
-- trigger (delta, set-based). fn_fechar_periodo(mesma data) recalcula do zero.
-- Datas anteriores ao fechamento continuam sendo calculadas do zero.
-- Idempotente.
-- ============================================================

-- ── 1. Tabela ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arqvalor.conta_fechamento (
    conta_id               UUID PRIMARY KEY REFERENCES arqvalor.contas(id)   ON DELETE CASCADE,
    user_id                UUID NOT NULL    REFERENCES arqvalor.usuarios(id) ON DELETE CASCADE,
    data_fechamento        DATE NOT NULL,
    saldo_fechamento       NUMERIC NOT NULL,
    saldo_fechamento_bruto NUMERIC NOT NULL,
    atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conta_fechamento_user ON arqvalor.conta_fechamento (user_id);

-- Os saldos filtram transacoes por (conta_id, data > fechamento): sem este
-- índice o ganho do snapshot se perderia num scan por user_id.
CREATE INDEX IF NOT EXISTS idx_tx_conta_data ON arqvalor.transacoes (conta_id, data);

ALTER TABLE arqvalor.conta_fechamento ENABLE ROW LEVEL SECURITY;

-- Só leitura: espelha a visibilidade de `contas` (dono, ou agregado com a
-- conta liberada — o EXISTS roda sob a RLS de contas). Escrita apenas pelas
-- funções SECURITY DEFINER abaixo.
DROP POLICY IF EXISTS pol_conta_fechamento_select ON arqvalor.conta_fechamento;
CREATE POLICY pol_conta_fechamento_select ON arqvalor.conta_fechamento
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM arqvalor.contas c WHERE c.id = conta_fechamento.conta_id)
    );

REVOKE ALL ON arqvalor.conta_fechamento FROM PUBLIC, anon, authenticated;
GRANT SELECT ON arqvalor.conta_fechamento TO authenticated;

-- ── 2. Recalcula o snapshot de UMA conta (uso interno) ──────
CREATE OR REPLACE FUNCTION arqvalor.fn_fechamento_recalcular_conta(p_conta_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_data  DATE;
    v_ini   NUMERIC;
    v_tipo  arqvalor.tipo_conta;
    v_cart  NUMERIC;
    v_bruto NUMERIC;
BEGIN
    SELECT f.data_fechamento, c.saldo_inicial, c.tipo
      INTO v_data, v_ini, v_tipo
      FROM arqvalor.conta_fechamento f
      JOIN arqvalor.contas c ON c.id = f.conta_id
     WHERE f.conta_id = p_conta_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT COALESCE(SUM(CASE WHEN v_tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                             WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END), 0),
           COALESCE(SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END), 0)
      INTO v_cart, v_bruto
      FROM arqvalor.transacoes t
     WHERE t.conta_id = p_conta_id AND t.data <= v_data;

    UPDATE arqvalor.conta_fechamento
       SET saldo_fechamento       = v_ini + v_cart,
           saldo_fechamento_bruto = v_ini + v_bruto,
           atualizado_em          = now()
     WHERE conta_id = p_conta_id;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_fechamento_recalcular_conta(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. RPCs de gestão (sempre sobre o PRÓPRIO usuário) ──────
CREATE OR REPLACE FUNCTION arqvalor.fn_fechar_periodo(p_data DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_qtd INTEGER;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
    IF p_data IS NULL THEN
        RAISE EXCEPTION 'DATA_FECHAMENTO_INVALIDA' USING DETAIL = 'Informe a data de fechamento.';
    END IF;
    IF p_data > (CURRENT_DATE - INTERVAL '1 year')::date THEN
        RAISE EXCEPTION 'DATA_FECHAMENTO_INVALIDA'
            USING DETAIL = 'A data de fechamento não pode ser posterior a hoje menos 1 ano.';
    END IF;

    INSERT INTO arqvalor.conta_fechamento
           (conta_id, user_id, data_fechamento, saldo_fechamento, saldo_fechamento_bruto, atualizado_em)
    SELECT c.id, c.user_id, p_data,
           c.saldo_inicial + COALESCE(SUM(
               CASE WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                    WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END), 0),
           c.saldo_inicial + COALESCE(SUM(
               CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END), 0),
           now()
      FROM arqvalor.contas c
      LEFT JOIN arqvalor.transacoes t ON t.conta_id = c.id AND t.data <= p_data
     WHERE c.user_id = v_uid
     GROUP BY c.id, c.user_id, c.saldo_inicial, c.tipo
    ON CONFLICT (conta_id) DO UPDATE
       SET data_fechamento        = EXCLUDED.data_fechamento,
           saldo_fechamento       = EXCLUDED.saldo_fechamento,
           saldo_fechamento_bruto = EXCLUDED.saldo_fechamento_bruto,
           atualizado_em          = now();
    GET DIAGNOSTICS v_qtd = ROW_COUNT;
    RETURN v_qtd;
END;
$$;

CREATE OR REPLACE FUNCTION arqvalor.fn_remover_fechamento()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_qtd INTEGER;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
    DELETE FROM arqvalor.conta_fechamento WHERE user_id = v_uid;
    GET DIAGNOSTICS v_qtd = ROW_COUNT;
    RETURN v_qtd;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_fechar_periodo(DATE)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION arqvalor.fn_remover_fechamento()    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_fechar_periodo(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION arqvalor.fn_remover_fechamento() TO authenticated;

-- ── 4. Triggers: manter o snapshot consistente ──────────────
-- Statement-level com transition tables: um lote (import, restore, limpar)
-- gera UM update por statement, não um por linha. Só afeta linhas com
-- data <= data_fechamento da conta (o JOIN descarta o resto).
CREATE OR REPLACE FUNCTION arqvalor.fn_fechamento_delta_tx()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE arqvalor.conta_fechamento f
           SET saldo_fechamento       = f.saldo_fechamento + d.dc,
               saldo_fechamento_bruto = f.saldo_fechamento_bruto + d.db,
               atualizado_em          = now()
          FROM (
            SELECT n.conta_id,
                   SUM(CASE WHEN ct.tipo = 'CARTAO' AND n.status = 'PROJECAO' THEN 0
                            WHEN n.tipo = 'RECEITA' THEN n.valor ELSE -n.valor END) AS dc,
                   SUM(CASE WHEN n.tipo = 'RECEITA' THEN n.valor ELSE -n.valor END) AS db
              FROM new_rows n
              JOIN arqvalor.conta_fechamento cf ON cf.conta_id = n.conta_id AND n.data <= cf.data_fechamento
              JOIN arqvalor.contas ct           ON ct.id = n.conta_id
             GROUP BY n.conta_id
          ) d
         WHERE f.conta_id = d.conta_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE arqvalor.conta_fechamento f
           SET saldo_fechamento       = f.saldo_fechamento - d.dc,
               saldo_fechamento_bruto = f.saldo_fechamento_bruto - d.db,
               atualizado_em          = now()
          FROM (
            SELECT o.conta_id,
                   SUM(CASE WHEN ct.tipo = 'CARTAO' AND o.status = 'PROJECAO' THEN 0
                            WHEN o.tipo = 'RECEITA' THEN o.valor ELSE -o.valor END) AS dc,
                   SUM(CASE WHEN o.tipo = 'RECEITA' THEN o.valor ELSE -o.valor END) AS db
              FROM old_rows o
              JOIN arqvalor.conta_fechamento cf ON cf.conta_id = o.conta_id AND o.data <= cf.data_fechamento
              JOIN arqvalor.contas ct           ON ct.id = o.conta_id
             GROUP BY o.conta_id
          ) d
         WHERE f.conta_id = d.conta_id;
    ELSE -- UPDATE: tira a contribuição antiga e põe a nova (pode mudar de conta/data)
        UPDATE arqvalor.conta_fechamento f
           SET saldo_fechamento       = f.saldo_fechamento + d.dc,
               saldo_fechamento_bruto = f.saldo_fechamento_bruto + d.db,
               atualizado_em          = now()
          FROM (
            SELECT x.conta_id,
                   SUM(x.sinal * CASE WHEN ct.tipo = 'CARTAO' AND x.status = 'PROJECAO' THEN 0
                                      WHEN x.tipo = 'RECEITA' THEN x.valor ELSE -x.valor END) AS dc,
                   SUM(x.sinal * CASE WHEN x.tipo = 'RECEITA' THEN x.valor ELSE -x.valor END) AS db
              FROM (
                SELECT conta_id, data, tipo, status, valor, -1 AS sinal FROM old_rows
                UNION ALL
                SELECT conta_id, data, tipo, status, valor,  1 AS sinal FROM new_rows
              ) x
              JOIN arqvalor.conta_fechamento cf ON cf.conta_id = x.conta_id AND x.data <= cf.data_fechamento
              JOIN arqvalor.contas ct           ON ct.id = x.conta_id
             GROUP BY x.conta_id
          ) d
         WHERE f.conta_id = d.conta_id;
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_fechamento_delta_tx() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fechamento_tx_ins ON arqvalor.transacoes;
CREATE TRIGGER trg_fechamento_tx_ins
    AFTER INSERT ON arqvalor.transacoes
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION arqvalor.fn_fechamento_delta_tx();

DROP TRIGGER IF EXISTS trg_fechamento_tx_upd ON arqvalor.transacoes;
CREATE TRIGGER trg_fechamento_tx_upd
    AFTER UPDATE ON arqvalor.transacoes
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION arqvalor.fn_fechamento_delta_tx();

DROP TRIGGER IF EXISTS trg_fechamento_tx_del ON arqvalor.transacoes;
CREATE TRIGGER trg_fechamento_tx_del
    AFTER DELETE ON arqvalor.transacoes
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION arqvalor.fn_fechamento_delta_tx();

-- saldo_inicial e tipo entram no snapshot: mudou, recalcula a conta.
CREATE OR REPLACE FUNCTION arqvalor.fn_fechamento_conta_alterada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
    IF NEW.saldo_inicial IS DISTINCT FROM OLD.saldo_inicial
       OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
        PERFORM arqvalor.fn_fechamento_recalcular_conta(NEW.id);
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_fechamento_conta_alterada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fechamento_conta_alterada ON arqvalor.contas;
CREATE TRIGGER trg_fechamento_conta_alterada
    AFTER UPDATE ON arqvalor.contas
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_fechamento_conta_alterada();

-- ── 5. vw_saldo_contas ──────────────────────────────────────
-- Mesmas colunas (nome/tipo/ordem). saldo_atual = snapshot + movimento após o
-- fechamento; movimentacao = saldo_atual − saldo_inicial (igual a antes).
CREATE OR REPLACE VIEW arqvalor.vw_saldo_contas
WITH (security_invoker = true)
AS
SELECT
    c.id              AS conta_id,
    c.user_id,
    c.nome,
    c.tipo,
    c.icone,
    c.cor,
    c.ativa,
    c.saldo_inicial,
    c.dia_fechamento,
    c.dia_pagamento,
    c.limite_credito,
    c.cartoes_virtuais,
    COALESCE(f.saldo_fechamento, c.saldo_inicial) + m.mov - c.saldo_inicial AS movimentacao,
    COALESCE(f.saldo_fechamento, c.saldo_inicial) + m.mov                   AS saldo_atual,
    (SELECT MAX(u.data) FROM arqvalor.transacoes u
      WHERE u.conta_id = c.id AND u.data <= CURRENT_DATE)                   AS ultima_movimentacao
FROM arqvalor.contas c
LEFT JOIN arqvalor.conta_fechamento f ON f.conta_id = c.id
CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(
        CASE
            WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
            WHEN t.tipo = 'RECEITA' THEN  t.valor
            WHEN t.tipo = 'DESPESA' THEN -t.valor
        END
    ), 0) AS mov
      FROM arqvalor.transacoes t
     WHERE t.conta_id = c.id
       AND t.data    <= CURRENT_DATE
       AND t.data     > COALESCE(f.data_fechamento, '-infinity'::date)
) m;

-- ── 6. fn_saldos_contas_ate_data (bruto; SECURITY DEFINER) ──
CREATE OR REPLACE FUNCTION arqvalor.fn_saldos_contas_ate_data(
    p_user_id UUID,
    p_data    DATE
)
RETURNS TABLE(conta_id UUID, saldo NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;

    IF p_user_id IS DISTINCT FROM v_uid
       AND NOT arqvalor.fn_agregado_tem_acesso(p_user_id, 'EXTRATO') THEN
        RAISE EXCEPTION 'ACESSO_NEGADO'
            USING DETAIL = 'p_user_id deve ser o próprio usuário autenticado, ou um dono que liberou o módulo Extrato para ele como agregado.';
    END IF;

    RETURN QUERY
        WITH liberadas AS (
            SELECT ac.conta_id AS cid
              FROM arqvalor.agregados ag
              JOIN arqvalor.agregados_contas ac ON ac.agregado_vinculo_id = ag.id
             WHERE ag.dono_id = p_user_id AND ag.agregado_id = v_uid AND ag.status = 'ACEITO'
        )
        SELECT c.id,
               CASE WHEN f.data_fechamento <= p_data THEN f.saldo_fechamento_bruto
                    ELSE c.saldo_inicial END
               + COALESCE((
                   SELECT SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END)
                     FROM arqvalor.transacoes t
                    WHERE t.conta_id = c.id
                      AND t.data    <= p_data
                      AND t.data     > CASE WHEN f.data_fechamento <= p_data
                                            THEN f.data_fechamento ELSE '-infinity'::date END
               ), 0)
          FROM arqvalor.contas c
          LEFT JOIN arqvalor.conta_fechamento f ON f.conta_id = c.id
         WHERE c.user_id = p_user_id
           AND c.ativa   = TRUE
           AND (p_user_id = v_uid OR c.id IN (SELECT cid FROM liberadas));
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) TO authenticated;

-- ── 7. fn_saldo_conta_ate_data (bruto; SECURITY INVOKER) ────
CREATE OR REPLACE FUNCTION arqvalor.fn_saldo_conta_ate_data(
    p_conta_id UUID,
    p_data     DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_saldo NUMERIC;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM arqvalor.contas c
         WHERE c.id = p_conta_id
           AND (c.user_id = auth.uid()
                OR arqvalor.fn_agregado_tem_acesso(c.user_id, 'EXTRATO', c.id))
    ) THEN
        RAISE EXCEPTION 'ACESSO_NEGADO'
            USING DETAIL = 'Conta não pertence ao usuário autenticado nem foi liberada a ele como agregado (EXTRATO).';
    END IF;

    -- Regra de negócio: saldo soma TODAS as transações até a data,
    -- independente de status (PAGO/PENDENTE/PROJECAO).
    SELECT CASE WHEN f.data_fechamento <= p_data THEN f.saldo_fechamento_bruto
                ELSE c.saldo_inicial END
           + COALESCE((
               SELECT SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END)
                 FROM arqvalor.transacoes t
                WHERE t.conta_id = c.id
                  AND t.data    <= p_data
                  AND t.data     > CASE WHEN f.data_fechamento <= p_data
                                        THEN f.data_fechamento ELSE '-infinity'::date END
           ), 0)
      INTO v_saldo
      FROM arqvalor.contas c
      LEFT JOIN arqvalor.conta_fechamento f ON f.conta_id = c.id
     WHERE c.id = p_conta_id;

    RETURN v_saldo;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_saldo_conta_ate_data(UUID, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_saldo_conta_ate_data(UUID, DATE) TO authenticated;

-- ── 8. fn_saldo_contas_ate (regra de cartão; usada pelo SONHO) ──
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
        SELECT CASE WHEN f.data_fechamento <= p_data THEN f.saldo_fechamento
                    ELSE c.saldo_inicial END
               + COALESCE((
                   SELECT SUM(CASE
                       WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                       WHEN t.tipo = 'RECEITA' THEN  t.valor
                       WHEN t.tipo = 'DESPESA' THEN -t.valor
                       ELSE 0
                   END)
                     FROM arqvalor.transacoes t
                    WHERE t.conta_id = c.id
                      AND t.data    <= p_data
                      AND t.data     > CASE WHEN f.data_fechamento <= p_data
                                            THEN f.data_fechamento ELSE '-infinity'::date END
               ), 0) AS saldo
        FROM arqvalor.contas c
        LEFT JOIN arqvalor.conta_fechamento f ON f.conta_id = c.id
        WHERE c.id = ANY(p_contas)
    ) sub;
$$;

-- ── 9. fn_saldo_total_antes_de (bruto; SECURITY DEFINER) ────
-- Saldo global na véspera de p_data (Extrato). Mantém as particularidades
-- anteriores: saldo_inicial só das contas ativas; transações de TODAS as contas.
-- "t.data < p_data" ≡ "t.data <= p_data − 1" (datas inteiras).
CREATE OR REPLACE FUNCTION arqvalor.fn_saldo_total_antes_de(p_user_id UUID, p_data DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_ate   DATE := p_data - 1;
  v_saldo NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;

  IF p_user_id <> v_uid AND NOT arqvalor.fn_agregado_tem_acesso(p_user_id, 'EXTRATO') THEN
    RAISE EXCEPTION 'ACESSO_NEGADO'
      USING DETAIL = 'p_user_id deve ser o próprio usuário autenticado, ou um dono que liberou o módulo Extrato para ele como agregado.';
  END IF;

  WITH liberadas AS (
    SELECT ac.conta_id
      FROM arqvalor.agregados ag
      JOIN arqvalor.agregados_contas ac ON ac.agregado_vinculo_id = ag.id
     WHERE ag.dono_id = p_user_id AND ag.agregado_id = v_uid AND ag.status = 'ACEITO'
  )
  SELECT COALESCE(SUM(
           CASE WHEN c.ativa THEN c.saldo_inicial ELSE 0 END
         + CASE WHEN f.data_fechamento <= v_ate THEN f.saldo_fechamento_bruto - c.saldo_inicial ELSE 0 END
         + COALESCE((
             SELECT SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END)
               FROM arqvalor.transacoes t
              WHERE t.conta_id = c.id
                AND t.data    <= v_ate
                AND t.data     > CASE WHEN f.data_fechamento <= v_ate
                                      THEN f.data_fechamento ELSE '-infinity'::date END
           ), 0)
         ), 0)
    INTO v_saldo
    FROM arqvalor.contas c
    LEFT JOIN arqvalor.conta_fechamento f ON f.conta_id = c.id
   WHERE c.user_id = p_user_id
     AND (p_user_id = v_uid OR c.id IN (SELECT conta_id FROM liberadas));

  RETURN v_saldo;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_saldo_total_antes_de(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_saldo_total_antes_de(UUID, DATE) TO authenticated;
