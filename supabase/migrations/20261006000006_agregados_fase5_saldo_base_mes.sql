-- ============================================================
-- "Usuários agregados" — achado da revisão de segurança final: as mesmas
-- duas RPCs endurecidas em 20260522000002 (fn_saldos_contas_ate_data e
-- fn_saldo_conta_ate_data) ficaram de fora da Fase 1, que só tinha
-- corrigido a irmã fn_saldo_total_antes_de (20261001000002).
--
-- fn_saldos_contas_ate_data é chamada DIRETO do frontend (sem Edge
-- Function) por useSaldoBaseMes.ts — usada por Dashboard (alerta de saldo
-- negativo) e Extrato (saldo acumulado por linha). Com `p_user_id =
-- auth.uid()` travado, um agregado vendo "Conta de Fulano" recebia de
-- volta os PRÓPRIOS saldos (conta_ids que nem batem com os do dono) em
-- vez de ACESSO_NEGADO — a UI então mostrava saldo acumulado errado,
-- silenciosamente, sem nenhum sinal de erro.
--
-- Mesma correção e mesmo raciocínio de escopo por conta de
-- 20261001000002: quando quem chama é o DONO, nada muda; quando é um
-- AGREGADO, só entram as contas de fato liberadas (RLS de `contas`/
-- `transacoes` já filtra isso — a query aqui só precisa deixar de travar
-- em p_user_id <> auth.uid() cedo demais).
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
    IF p_user_id IS DISTINCT FROM auth.uid()
       AND NOT arqvalor.fn_agregado_tem_acesso(p_user_id, 'EXTRATO') THEN
        RAISE EXCEPTION 'ACESSO_NEGADO'
            USING DETAIL = 'p_user_id deve ser o próprio usuário autenticado, ou um dono que liberou o módulo Extrato para ele como agregado.';
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
         WHERE c.user_id = p_user_id
           AND c.ativa   = TRUE
         GROUP BY c.id, c.saldo_inicial;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) TO authenticated;


-- ============================================================
-- fn_saldo_conta_ate_data — sem chamador no frontend hoje (confirmado via
-- grep), mas coberta por teste de segurança dedicado (SEG-RPC02 em
-- 09_seguranca_rpc.test.ts). Estendida por consistência com a irmã acima
-- e para não deixar uma armadilha pronta pro próximo uso.
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
    -- Dono da conta, OU agregado com EXTRATO liberado especificamente para
    -- essa conta (fn_agregado_tem_acesso com p_conta_id, igual RLS).
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
