-- Diagnóstico temporário — NÃO É MIGRATION DE VERDADE, será removida.
CREATE OR REPLACE FUNCTION arqvalor._diag_pgnet()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'extensao', (
      SELECT jsonb_build_object(
        'nome', extname,
        'relocatable', extrelocatable,
        'schema_atual', extnamespace::regnamespace::text,
        'versao', extversion
      )
      FROM pg_extension WHERE extname = 'pg_net'
    ),
    'funcoes_net', (
      SELECT jsonb_agg(jsonb_build_object('funcao', p.proname, 'schema', n.nspname))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname IN ('http_post','http_get','http_delete','http_collect_response')
    ),
    'objetos_extensao_por_schema', (
      SELECT jsonb_agg(DISTINCT n.nspname)
      FROM pg_depend d
      JOIN pg_extension e ON e.oid = d.refobjid
      JOIN pg_class c ON c.oid = d.objid AND d.classid = 'pg_class'::regclass
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE e.extname = 'pg_net' AND d.deptype = 'e'
    )
  );
$$;
REVOKE ALL ON FUNCTION arqvalor._diag_pgnet() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arqvalor._diag_pgnet() TO service_role;
