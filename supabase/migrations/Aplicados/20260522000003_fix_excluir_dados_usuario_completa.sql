-- ============================================================
-- BUGFIX: fn_excluir_dados_usuario — segurança + completude
-- ============================================================
-- Dois problemas corrigidos:
--
-- 1. SEGURANÇA (CRÍTICO): a versão anterior era SECURITY DEFINER
--    com GRANT EXECUTE para anon/authenticated e não validava
--    p_user_id contra auth.uid(). Qualquer chamador podia apagar
--    todos os dados de outro usuário via:
--        POST /rest/v1/rpc/fn_excluir_dados_usuario {"p_user_id": "<vítima>"}
--
-- 2. COMPLETUDE: a função só apagava transacoes / categorias /
--    contas / usuarios. As tabelas adicionadas depois (lembretes,
--    filtros_salvos, assistente_lancamentos, auditoria) ficavam
--    órfãs após "excluir conta".
--
-- Correção:
--   - Mantém SECURITY DEFINER (precisa do bypass de triggers/FK
--     via session_replication_role).
--   - Valida p_user_id = auth.uid() já no início; senão lança
--     ACESSO_NEGADO antes de qualquer DELETE.
--   - REVOKE EXECUTE de anon e public (só authenticated pode chamar).
--   - DELETE inclui todas as 4 tabelas dependentes adicionadas
--     depois da função original.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_dados_usuario(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  -- Defesa em profundidade: só pode apagar os próprios dados
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'ACESSO_NEGADO'
      USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
  END IF;

  -- Bypassa triggers e FK constraints (precisa do SECURITY DEFINER como postgres)
  SET LOCAL session_replication_role = replica;

  -- 1) Tabelas dependentes (referenciam contas/categorias/transacoes/usuarios)
  DELETE FROM arqvalor.lembretes              WHERE user_id = p_user_id;
  DELETE FROM arqvalor.filtros_salvos         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.assistente_lancamentos WHERE user_id = p_user_id;
  DELETE FROM arqvalor.auditoria              WHERE user_id = p_user_id;

  -- 2) Domínio principal
  DELETE FROM arqvalor.transacoes WHERE user_id = p_user_id;
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id;
  DELETE FROM arqvalor.contas     WHERE user_id = p_user_id;

  -- 3) Por último, o próprio usuário (ia_configs/layout/etc. são JSONB
  --    dentro desta linha, então saem juntos).
  DELETE FROM arqvalor.usuarios WHERE id = p_user_id;
END;
$$;

-- Reaplica permissões (CREATE OR REPLACE preserva, mas garantimos)
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;
