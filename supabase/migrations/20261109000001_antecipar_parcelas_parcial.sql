-- ============================================================
-- Antecipação PARCIAL de parcelas
--
-- fn_antecipar_parcelas (original) sempre consolida TODAS as parcelas
-- seguintes na atual. Esta variante consolida só as parcelas escolhidas
-- (ex.: estando na 3/12, antecipar 10, 11 e 12 e manter 4..9).
--
--   • soma o valor das parcelas escolhidas na parcela atual;
--   • exclui as escolhidas; as demais seguem intactas (numeração original);
--   • total_parcelas só é reduzido quando TODAS as seguintes foram escolhidas
--     (aí equivale à antecipação total);
--   • valor_projetado guarda o valor unitário original (preserva o 1º, se
--     houver antecipações parciais sucessivas).
--
-- SECURITY INVOKER (padrão da fn_antecipar_parcelas): a RLS de
-- transacoes decide o que o chamador pode ler/alterar/excluir.
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_antecipar_parcelas_parcial(
    p_transacao_id UUID,
    p_user_id      UUID,
    p_parcelas     INTEGER[]
)
RETURNS TABLE (novo_valor NUMERIC(15,2), valor_projetado_salvo NUMERIC(15,2), parcelas_excluidas INTEGER)
LANGUAGE plpgsql
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_tx          arqvalor.transacoes%ROWTYPE;
    v_escolhidas  INTEGER[];
    v_soma        NUMERIC(15,2);
    v_count       INTEGER;
    v_restantes   INTEGER;
    v_total_novo  INTEGER;
BEGIN
    SELECT * INTO v_tx FROM arqvalor.transacoes
    WHERE id = p_transacao_id AND user_id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TRANSACAO_NAO_ENCONTRADA';
    END IF;
    IF v_tx.tipo_recorrencia IS DISTINCT FROM 'PARCELA' THEN
        RAISE EXCEPTION 'NOT_INSTALLMENT';
    END IF;
    IF v_tx.nr_parcela >= v_tx.total_parcelas THEN
        RAISE EXCEPTION 'LAST_INSTALLMENT';
    END IF;

    -- Escolhidas, sem duplicatas
    SELECT COALESCE(array_agg(DISTINCT n), '{}') INTO v_escolhidas
    FROM unnest(p_parcelas) AS n
    WHERE n IS NOT NULL;

    IF COALESCE(array_length(v_escolhidas, 1), 0) = 0 THEN
        RAISE EXCEPTION 'PARCELAS_VAZIAS';
    END IF;

    SELECT COALESCE(SUM(valor), 0), COUNT(*) INTO v_soma, v_count
    FROM arqvalor.transacoes
    WHERE id_recorrencia = v_tx.id_recorrencia
      AND user_id = p_user_id
      AND nr_parcela > v_tx.nr_parcela
      AND nr_parcela = ANY (v_escolhidas);

    -- Toda parcela escolhida precisa existir na série e ser posterior à atual
    IF v_count <> array_length(v_escolhidas, 1) THEN
        RAISE EXCEPTION 'PARCELA_INVALIDA';
    END IF;

    SELECT COUNT(*) INTO v_restantes
    FROM arqvalor.transacoes
    WHERE id_recorrencia = v_tx.id_recorrencia
      AND user_id = p_user_id
      AND nr_parcela > v_tx.nr_parcela
      AND NOT (nr_parcela = ANY (v_escolhidas));

    -- Escolheu todas as seguintes = antecipação total
    v_total_novo := CASE WHEN v_restantes = 0 THEN v_tx.nr_parcela ELSE v_tx.total_parcelas END;

    DELETE FROM arqvalor.transacoes
    WHERE id_recorrencia = v_tx.id_recorrencia
      AND user_id = p_user_id
      AND nr_parcela > v_tx.nr_parcela
      AND nr_parcela = ANY (v_escolhidas);

    UPDATE arqvalor.transacoes SET
        valor_projetado = COALESCE(valor_projetado, v_tx.valor),
        valor           = v_tx.valor + v_soma,
        total_parcelas  = v_total_novo,
        atualizado_em   = NOW()
    WHERE id = p_transacao_id;

    RETURN QUERY SELECT
        (v_tx.valor + v_soma)::NUMERIC(15,2),
        COALESCE(v_tx.valor_projetado, v_tx.valor)::NUMERIC(15,2),
        v_count::INTEGER;
END;
$$;
