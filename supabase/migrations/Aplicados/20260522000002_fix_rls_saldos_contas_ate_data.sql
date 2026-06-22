-- ============================================================
-- BUGFIX DE SEGURANÇA: fn_saldos_contas_ate_data
-- ============================================================
-- A versão anterior era SECURITY DEFINER e filtrava por
-- c.user_id = p_user_id sem validar p_user_id contra auth.uid().
-- Isso permitia que qualquer usuário autenticado lesse saldos de
-- outros usuários passando o UUID alheio como parâmetro.
--
-- Correção:
--   1. SECURITY INVOKER (default) — RLS de arqvalor.contas e
--      arqvalor.transacoes passa a valer pra função.
--   2. Validação explícita: se p_user_id não bate com auth.uid(),
--      lança exceção. Defesa em profundidade.
--   3. Filtra por auth.uid() no WHERE (redundante com RLS, mas
--      defensivo).
-- ============================================================

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
                   CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END
               ), 0)
          FROM arqvalor.contas c
          LEFT JOIN arqvalor.transacoes t
                 ON t.conta_id = c.id
                AND t.data    <= p_data
         WHERE c.user_id = auth.uid()
           AND c.ativa   = TRUE
         GROUP BY c.id, c.saldo_inicial;
END;
$$;

-- Re-aplica REVOKE pra anon (caso a recriação tenha reset)
REVOKE EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) TO authenticated;


-- ============================================================
-- Hardening de fn_saldo_conta_ate_data (mesmo padrão de risco):
-- também era SECURITY DEFINER e aceitava p_conta_id sem checar
-- que a conta pertence ao chamador.
-- ============================================================
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

    -- Regra de negócio: saldo soma TODAS as transações até a data,
    -- independente de status (PAGO/PENDENTE/PROJECAO).
    SELECT COALESCE(
              c.saldo_inicial + SUM(
                  CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END
              ),
              c.saldo_inicial
           )
      INTO v_saldo
      FROM arqvalor.contas c
      LEFT JOIN arqvalor.transacoes t
             ON t.conta_id = c.id
            AND t.data    <= p_data
     WHERE c.id = p_conta_id
     GROUP BY c.saldo_inicial;

    RETURN v_saldo;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_saldo_conta_ate_data(UUID, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_saldo_conta_ate_data(UUID, DATE) TO authenticated;
