-- ============================================================
-- REMOÇÃO da tabela arqvalor.auditoria
-- ============================================================
-- A tabela foi criada na migration inicial (20260403000001) com a
-- intenção de logar INSERT/UPDATE/DELETE/ANTECIPAR em contas, categorias
-- e transacoes. Porém o produtor (trigger ou middleware) nunca foi
-- implementado: nenhuma função, trigger ou Edge Function escreve nela,
-- e desde a criação acumulou 0 registros.
--
-- Em um app de finanças pessoais (1 usuário por conta), o backup do
-- banco já cobre recuperação; auditoria não tem propósito real. Esta
-- migration remove a tabela e ajusta a fn_excluir_dados_usuario para
-- não referenciar mais a tabela.
-- ============================================================

DROP TABLE IF EXISTS arqvalor.auditoria CASCADE;

-- Recria fn_excluir_dados_usuario sem o DELETE de auditoria
CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_dados_usuario(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_role TEXT := current_user;
  v_auth_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
BEGIN
  -- Bypass quando chamador for admin (service_role via PostgREST, ou
  -- postgres/supabase_admin via SQL editor). Usuário autenticado normal
  -- deve coincidir com auth.uid().
  IF v_role NOT IN ('postgres','supabase_admin') AND v_auth_role <> 'service_role' THEN
    IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'ACESSO_NEGADO'
        USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
    END IF;
  END IF;

  -- Bypassa triggers e FK constraints (SECURITY DEFINER roda como postgres)
  SET LOCAL session_replication_role = replica;

  -- Dependentes
  DELETE FROM arqvalor.lembretes              WHERE user_id = p_user_id;
  DELETE FROM arqvalor.filtros_salvos         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.assistente_lancamentos WHERE user_id = p_user_id;

  -- Domínio principal
  DELETE FROM arqvalor.transacoes WHERE user_id = p_user_id;
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id;
  DELETE FROM arqvalor.contas     WHERE user_id = p_user_id;

  -- Usuário (ia_configs/layout etc. são JSONB inline)
  DELETE FROM arqvalor.usuarios WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;
