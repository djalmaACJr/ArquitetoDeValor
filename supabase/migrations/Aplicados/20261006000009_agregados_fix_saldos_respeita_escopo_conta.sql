-- fn_saldos_contas_ate_data devolvia o saldo de TODAS as contas ativas do dono
-- para um agregado com EXTRATO liberado, ignorando o escopo de contas
-- (agregados_contas). Resultado: a tela do agregado mostrava saldo de contas
-- que ele não podia ver (contas/transações voltavam vazias pela RLS, só o
-- saldo aparecia). Agora o agregado só recebe as contas liberadas a ele.
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
           AND (p_user_id = auth.uid()
                OR arqvalor.fn_agregado_tem_acesso(p_user_id, 'EXTRATO', c.id))
         GROUP BY c.id, c.saldo_inicial;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) TO authenticated;
