-- ============================================================
-- "Usuários agregados" — Fase 1: fn_saldo_total_antes_de precisa aceitar
-- um agregado chamando em nome do dono.
--
-- Achado ao ligar a Edge Function: a função (criada em
-- 20260709000002_fn_saldo_total_antes_de.sql) exigia estritamente
-- `p_user_id = auth.uid()` — um agregado autenticado como ele mesmo,
-- pedindo o saldo-base do DONO (GET /transacoes?saldo=true, usado pelo
-- Extrato), sempre batia em ACESSO_NEGADO. Sem essa função, o Extrato do
-- dono simplesmente não abre em modo agregado.
--
-- CORREÇÃO: aceita também quando o chamador é um agregado com o módulo
-- EXTRATO liberado por esse dono (fn_agregado_tem_acesso, a mesma função
-- usada nas policies de RLS — nunca diverge da garantia real do banco).
--
-- IMPORTANTE — escopo por conta: quando quem chama é o DONO, soma TODAS
-- as contas/transações dele, como sempre. Quando é um AGREGADO, soma só
-- as contas que estão de fato liberadas pra ele — senão o saldo-base
-- (usado como ponto de partida do saldo corrente por linha no Extrato)
-- vazaria, por agregação, o valor de contas que o agregado não deveria
-- nem saber que existem.
--
-- SECURITY INVOKER mantido (mesmo padrão da versão original).
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_saldo_total_antes_de(p_user_id UUID, p_data DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_saldo    NUMERIC;
  v_sou_dono BOOLEAN := (p_user_id = auth.uid());
BEGIN
  IF NOT v_sou_dono AND NOT arqvalor.fn_agregado_tem_acesso(p_user_id, 'EXTRATO') THEN
    RAISE EXCEPTION 'ACESSO_NEGADO'
      USING DETAIL = 'p_user_id deve ser o próprio usuário autenticado, ou um dono que liberou o módulo Extrato para ele como agregado.';
  END IF;

  IF v_sou_dono THEN
    SELECT
        COALESCE((SELECT SUM(saldo_inicial) FROM arqvalor.contas
                   WHERE user_id = p_user_id AND ativa = TRUE), 0)
      + COALESCE((SELECT SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END)
                    FROM arqvalor.transacoes t
                   WHERE t.user_id = p_user_id AND t.data < p_data), 0)
    INTO v_saldo;
  ELSE
    -- Agregado: só as contas que ele de fato pode ver.
    SELECT
        COALESCE((SELECT SUM(ct.saldo_inicial) FROM arqvalor.contas ct
                   WHERE ct.user_id = p_user_id AND ct.ativa = TRUE
                     AND arqvalor.fn_agregado_tem_acesso(p_user_id, 'EXTRATO', ct.id)), 0)
      + COALESCE((SELECT SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END)
                    FROM arqvalor.transacoes t
                   WHERE t.user_id = p_user_id AND t.data < p_data
                     AND arqvalor.fn_agregado_tem_acesso(p_user_id, 'EXTRATO', t.conta_id)), 0)
    INTO v_saldo;
  END IF;

  RETURN v_saldo;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_saldo_total_antes_de(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_saldo_total_antes_de(UUID, DATE) TO authenticated;
