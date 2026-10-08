-- Achado real (out/2026): com um agregado vendo "Conta de Fulano",
-- GET /transacoes?saldo=true estourava "statement timeout" (~8s) e a tela
-- só mostrava o saldo. Causa: fn_saldo_total_antes_de e fn_saldos_contas_ate_data
-- chamavam fn_agregado_tem_acesso() UMA VEZ POR LINHA de transação (no WHERE),
-- somado à policy de RLS de agregado que roda a mesma função de novo por linha.
-- Em histórico longo isso vira milhões de subqueries.
--
-- Correção: autoriza UMA vez no início (como já fazia) e calcula o conjunto de
-- contas liberadas UMA vez (CTE), juntando com `transacoes` por conta_id.
-- Passam a ser SECURITY DEFINER para não pagar a RLS por linha — seguro porque
-- a autorização é explícita aqui dentro (auth.uid() dono, ou vínculo ACEITO com
-- módulo EXTRATO) e toda leitura é filtrada por p_user_id + contas liberadas.
-- search_path fixo; nunca confia em current_user.

CREATE OR REPLACE FUNCTION arqvalor.fn_saldo_total_antes_de(p_user_id UUID, p_data DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_saldo    NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;

  IF p_user_id = v_uid THEN
    SELECT
        COALESCE((SELECT SUM(saldo_inicial) FROM arqvalor.contas
                   WHERE user_id = p_user_id AND ativa = TRUE), 0)
      + COALESCE((SELECT SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END)
                    FROM arqvalor.transacoes t
                   WHERE t.user_id = p_user_id AND t.data < p_data), 0)
    INTO v_saldo;
    RETURN v_saldo;
  END IF;

  IF NOT arqvalor.fn_agregado_tem_acesso(p_user_id, 'EXTRATO') THEN
    RAISE EXCEPTION 'ACESSO_NEGADO'
      USING DETAIL = 'p_user_id deve ser o próprio usuário autenticado, ou um dono que liberou o módulo Extrato para ele como agregado.';
  END IF;

  WITH liberadas AS (
    SELECT ac.conta_id
      FROM arqvalor.agregados ag
      JOIN arqvalor.agregados_contas ac ON ac.agregado_vinculo_id = ag.id
     WHERE ag.dono_id = p_user_id AND ag.agregado_id = v_uid AND ag.status = 'ACEITO'
  )
  SELECT
      COALESCE((SELECT SUM(ct.saldo_inicial) FROM arqvalor.contas ct
                 WHERE ct.user_id = p_user_id AND ct.ativa = TRUE
                   AND ct.id IN (SELECT conta_id FROM liberadas)), 0)
    + COALESCE((SELECT SUM(CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END)
                  FROM arqvalor.transacoes t
                 WHERE t.user_id = p_user_id AND t.data < p_data
                   AND t.conta_id IN (SELECT conta_id FROM liberadas)), 0)
  INTO v_saldo;
  RETURN v_saldo;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_saldo_total_antes_de(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_saldo_total_antes_de(UUID, DATE) TO authenticated;

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
               c.saldo_inicial + COALESCE(SUM(
                   CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END
               ), 0)
          FROM arqvalor.contas c
          LEFT JOIN arqvalor.transacoes t
                 ON t.conta_id = c.id
                AND t.data    <= p_data
         WHERE c.user_id = p_user_id
           AND c.ativa   = TRUE
           AND (p_user_id = v_uid OR c.id IN (SELECT cid FROM liberadas))
         GROUP BY c.id, c.saldo_inicial;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_saldos_contas_ate_data(UUID, DATE) TO authenticated;
