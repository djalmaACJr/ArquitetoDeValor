-- ============================================================
-- "Esporádica" vale para despesa E receita.
--
-- A marca categorias.despesa_esporadica já tirava as DESPESAS esporádicas da média de gasto
-- da Reserva, mas a média de PROVENTOS (receitas ligadas a inv_dividendos) ignorava a marca:
-- um provento lançado numa categoria esporádica (ou filha de uma) continuava entrando.
-- Agora a média de proventos também deixa de fora o lançamento cuja categoria (ou a categoria
-- pai) está marcada. Resto da função idêntico a 20261124000001.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_media_despesas_mensais(
    p_user_id UUID,
    p_meses   INT DEFAULT 24
)
RETURNS TABLE(media NUMERIC, meses_considerados INT, proventos_media NUMERIC, proventos_meses INT, categorias_ignoradas INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_uid           UUID := auth.uid();
    v_fim           DATE := date_trunc('month', CURRENT_DATE)::date;      -- exclusivo
    v_inicio        DATE;
    v_total         NUMERIC;
    v_primeira      DATE;
    v_n             INT;
    v_prov_total    NUMERIC;
    v_prov_primeira DATE;
    v_prov_n        INT;
    v_liberadas     UUID[] := '{}';
    v_ignoradas     INT;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
    IF p_meses IS NULL OR p_meses < 1 OR p_meses > 120 THEN p_meses := 24; END IF;

    IF p_user_id IS DISTINCT FROM v_uid
       AND NOT arqvalor.fn_agregado_tem_acesso(p_user_id, 'EXTRATO') THEN
        RAISE EXCEPTION 'ACESSO_NEGADO'
            USING DETAIL = 'p_user_id deve ser o próprio usuário autenticado, ou um dono que liberou o módulo Extrato para ele como agregado.';
    END IF;

    v_inicio := (v_fim - make_interval(months => p_meses))::date;

    IF p_user_id IS DISTINCT FROM v_uid THEN
        SELECT COALESCE(array_agg(ac.conta_id), '{}')
          INTO v_liberadas
          FROM arqvalor.agregados ag
          JOIN arqvalor.agregados_contas ac ON ac.agregado_vinculo_id = ag.id
         WHERE ag.dono_id = p_user_id AND ag.agregado_id = v_uid AND ag.status = 'ACEITO';
    END IF;

    -- Despesas pagas (sem transferências e sem categorias esporádicas)
    SELECT COALESCE(SUM(t.valor), 0), MIN(t.data)
      INTO v_total, v_primeira
      FROM arqvalor.transacoes t
      LEFT JOIN arqvalor.categorias cat ON cat.id = t.categoria_id
      LEFT JOIN arqvalor.categorias cat_pai ON cat_pai.id = cat.id_pai
     WHERE t.user_id = p_user_id
       AND t.tipo    = 'DESPESA'
       AND t.status  = 'PAGO'
       AND t.data   >= v_inicio
       AND t.data   <  v_fim
       AND t.id_par_transferencia IS NULL
       AND COALESCE(t.descricao, '') NOT LIKE '[Transf.%'
       AND COALESCE(cat.descricao, '') <> 'Transferências'
       AND NOT COALESCE(cat.despesa_esporadica, FALSE)
       AND NOT COALESCE(cat_pai.despesa_esporadica, FALSE)
       AND (p_user_id = v_uid OR t.conta_id = ANY(v_liberadas));

    SELECT COUNT(*)::INT INTO v_ignoradas
      FROM arqvalor.categorias
     WHERE user_id = p_user_id AND despesa_esporadica;

    -- Proventos associados (inv_dividendos → lançamento PAGO do extrato), sem categorias esporádicas
    SELECT COALESCE(SUM(t.valor), 0), MIN(t.data)
      INTO v_prov_total, v_prov_primeira
      FROM arqvalor.inv_dividendos d
      JOIN arqvalor.transacoes t ON t.id = d.transacao_extrato_id
      LEFT JOIN arqvalor.categorias cat ON cat.id = t.categoria_id
      LEFT JOIN arqvalor.categorias cat_pai ON cat_pai.id = cat.id_pai
     WHERE d.user_id = p_user_id
       AND t.tipo    = 'RECEITA'
       AND t.status  = 'PAGO'
       AND t.data   >= v_inicio
       AND t.data   <  v_fim
       AND NOT COALESCE(cat.despesa_esporadica, FALSE)
       AND NOT COALESCE(cat_pai.despesa_esporadica, FALSE)
       AND (p_user_id = v_uid OR t.conta_id = ANY(v_liberadas));

    v_n := CASE WHEN v_primeira IS NULL THEN 0 ELSE GREATEST(1, LEAST(p_meses,
            ((EXTRACT(YEAR FROM v_fim) - EXTRACT(YEAR FROM v_primeira)) * 12
             + EXTRACT(MONTH FROM v_fim) - EXTRACT(MONTH FROM v_primeira))::INT)) END;
    v_prov_n := CASE WHEN v_prov_primeira IS NULL THEN 0 ELSE GREATEST(1, LEAST(p_meses,
            ((EXTRACT(YEAR FROM v_fim) - EXTRACT(YEAR FROM v_prov_primeira)) * 12
             + EXTRACT(MONTH FROM v_fim) - EXTRACT(MONTH FROM v_prov_primeira))::INT)) END;

    RETURN QUERY SELECT
        CASE WHEN v_n      > 0 THEN ROUND(v_total      / v_n,      2) ELSE 0::NUMERIC END,
        v_n,
        CASE WHEN v_prov_n > 0 THEN ROUND(v_prov_total / v_prov_n, 2) ELSE 0::NUMERIC END,
        v_prov_n,
        v_ignoradas;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_media_despesas_mensais(UUID, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_media_despesas_mensais(UUID, INT) TO authenticated;
