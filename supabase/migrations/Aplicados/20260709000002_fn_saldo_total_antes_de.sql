-- ============================================================
-- fn_saldo_total_antes_de — saldo GLOBAL (todas as contas ativas) do
-- usuário na véspera de uma data, para otimizar vw_transacoes_com_saldo.
--
-- Problema: vw_transacoes_com_saldo computa saldo_acumulado com uma
-- window function (SUM() OVER (PARTITION BY user_id ORDER BY data,
-- criado_em)). Views não deixam o Postgres empurrar o WHERE ano_tx=X
-- AND mes_tx=Y para ANTES do window — toda consulta ao extrato de 1 mês
-- varre e ordena o HISTÓRICO INTEIRO do usuário antes de descartar os
-- meses que não interessam. Medido: 349ms/113 linhas devolvidas contra
-- 23.138 transações; no agregado, essa view é 89,7% de todo o tempo de
-- execução do banco (pg_stat_statements).
--
-- Fix (em supabase/functions/transacoes/index.ts, rota GET ?saldo=true):
-- em vez de pedir à view o saldo_acumulado de cada linha do mês, pede-se
-- aqui o saldo ANTES do mês (1 número, agregação simples sem window/sort/
-- join) e soma-se incrementalmente em JS só sobre as ~100-300 linhas do
-- mês pedido — matematicamente idêntico ao que a view sempre devolveu
-- (ano_tx/mes_tx são GENERATED ALWAYS a partir de `data`, então
-- `data < :inicio_do_mes` é exatamente "toda transação cronologicamente
-- antes do mês", o mesmo particionamento que a window function usa).
--
-- MESMA fórmula da view (soma TODAS as transações, sem exceção de
-- status/tipo de conta) — não usar fn_saldos_contas_ate_data aqui, que
-- tem uma exceção própria para CARTAO+PROJECAO que a view não tem.
--
-- SECURITY INVOKER (não DEFINER): RLS de contas/transacoes já escopa por
-- auth.uid() naturalmente; o check explícito é defesa em profundidade,
-- no mesmo padrão de fn_saldos_contas_ate_data.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_saldo_total_antes_de(p_user_id UUID, p_data DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_saldo NUMERIC;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'ACESSO_NEGADO'
      USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
  END IF;

  SELECT
      COALESCE((SELECT SUM(saldo_inicial) FROM arqvalor.contas
                 WHERE user_id = p_user_id AND ativa = TRUE), 0)
    + COALESCE((SELECT SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END)
                  FROM arqvalor.transacoes t
                 WHERE t.user_id = p_user_id AND t.data < p_data), 0)
  INTO v_saldo;

  RETURN v_saldo;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_saldo_total_antes_de(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_saldo_total_antes_de(UUID, DATE) TO authenticated;
