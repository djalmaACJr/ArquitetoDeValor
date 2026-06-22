-- ============================================================
-- Saldo de conta CARTAO ignora transações com status = 'PROJECAO'
-- ============================================================
-- Regra geral (vigente): saldo soma TODAS as transações até a data,
-- independente de status (PAGO/PENDENTE/PROJECAO contam igual).
--
-- EXCEÇÃO para contas tipo = 'CARTAO':
--   Em cartão de crédito o "saldo" representa o que está efetivamente
--   devido. PROJECAO modela uma previsão futura (ex.: parcelas projetadas
--   de cenário, "vou comprar X mês que vem"), não uma despesa já gerada
--   na fatura. Misturar projeção com saldo do cartão distorce o quanto
--   o usuário realmente deve naquele momento.
--
-- Demais tipos (CORRENTE, REMUNERACAO, INVESTIMENTO, CARTEIRA):
--   Comportamento inalterado — somam PAGO + PENDENTE + PROJECAO.
--
-- Superfícies atualizadas:
--   1. arqvalor.vw_saldo_contas          (saldo na listagem de contas)
--   2. arqvalor.fn_saldos_contas_ate_data (saldo histórico — Dashboard)
--   3. arqvalor.fn_saldo_conta_ate_data   (saldo de UMA conta numa data)
--
-- vw_transacoes_com_saldo NÃO é alterada — ela mostra saldo_acumulado
-- ao longo do extrato, que reflete a sequência de transações exibidas
-- (incluindo PROJECAO). Trocar lá quebraria a sensação de "soma do que
-- estou vendo na tela".
-- ============================================================

-- ── 1. View vw_saldo_contas ─────────────────────────────────────────
-- DROP + CREATE porque CREATE OR REPLACE não permite mexer em colunas
-- existentes no meio da definição.
DROP VIEW IF EXISTS arqvalor.vw_saldo_contas;
CREATE VIEW arqvalor.vw_saldo_contas
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
    COALESCE(SUM(
        CASE
            -- Cartão: ignora projeção
            WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
            WHEN t.tipo = 'RECEITA' THEN  t.valor
            WHEN t.tipo = 'DESPESA' THEN -t.valor
        END
    ), 0) AS movimentacao,
    c.saldo_inicial + COALESCE(SUM(
        CASE
            WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
            WHEN t.tipo = 'RECEITA' THEN  t.valor
            WHEN t.tipo = 'DESPESA' THEN -t.valor
        END
    ), 0) AS saldo_atual
FROM arqvalor.contas c
LEFT JOIN arqvalor.transacoes t ON t.conta_id = c.id
GROUP BY
    c.id, c.user_id, c.nome, c.tipo, c.icone, c.cor,
    c.ativa, c.saldo_inicial, c.dia_fechamento, c.dia_pagamento,
    c.limite_credito, c.cartoes_virtuais;


-- ── 2. fn_saldos_contas_ate_data ────────────────────────────────────
CREATE OR REPLACE FUNCTION arqvalor.fn_saldos_contas_ate_data(
    p_user_id UUID,
    p_data    DATE
)
RETURNS TABLE(conta_id UUID, saldo NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
    -- Defesa em profundidade: só permite consultar os próprios saldos
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'ACESSO_NEGADO'
            USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
    END IF;

    RETURN QUERY
        SELECT c.id,
               c.saldo_inicial + COALESCE(SUM(
                   CASE
                       WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                       WHEN t.tipo = 'RECEITA' THEN  t.valor
                       ELSE                          -t.valor
                   END
               ), 0)
          FROM arqvalor.contas c
          LEFT JOIN arqvalor.transacoes t
                 ON t.conta_id = c.id
                AND t.data    <= p_data
         WHERE c.user_id = auth.uid()
           AND c.ativa   = TRUE
         GROUP BY c.id, c.saldo_inicial, c.tipo;
END;
$$;


-- ── 3. fn_saldo_conta_ate_data ──────────────────────────────────────
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
    -- Apenas o dono da conta pode consultar
    IF NOT EXISTS (
        SELECT 1 FROM arqvalor.contas
         WHERE id = p_conta_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'ACESSO_NEGADO'
            USING DETAIL = 'Conta não pertence ao usuário autenticado.';
    END IF;

    SELECT COALESCE(
              c.saldo_inicial + SUM(
                  CASE
                      WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                      WHEN t.tipo = 'RECEITA' THEN  t.valor
                      ELSE                          -t.valor
                  END
              ),
              c.saldo_inicial
           )
      INTO v_saldo
      FROM arqvalor.contas c
      LEFT JOIN arqvalor.transacoes t
             ON t.conta_id = c.id
            AND t.data    <= p_data
     WHERE c.id = p_conta_id
     GROUP BY c.saldo_inicial, c.tipo;

    RETURN v_saldo;
END;
$$;
