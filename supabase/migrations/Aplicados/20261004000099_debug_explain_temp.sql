CREATE OR REPLACE FUNCTION arqvalor.fn_debug_explain_par(p_id_par uuid)
RETURNS SETOF text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  RETURN QUERY EXECUTE
    'EXPLAIN (ANALYZE, BUFFERS, TIMING, FORMAT TEXT) UPDATE arqvalor.transacoes SET observacao = observacao WHERE id_par_transferencia = $1'
    USING p_id_par;
END;
$$;
REVOKE ALL ON FUNCTION arqvalor.fn_debug_explain_par(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_debug_explain_par(uuid) TO authenticated;
