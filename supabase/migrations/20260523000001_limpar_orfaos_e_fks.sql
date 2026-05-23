-- ============================================================
-- LIMPEZA DE ÓRFÃOS + FKS DEFENSIVAS
-- ============================================================
-- Contexto: antes de 20260522000003 a fn_excluir_dados_usuario só apagava
-- transacoes/categorias/contas/usuarios — exclusões anteriores podem ter
-- deixado lembretes, filtros_salvos, assistente_lancamentos ou auditoria
-- órfãos.
--
-- Plano desta migration:
--   1. Atualiza fn_excluir_dados_usuario para aceitar bypass de
--      validação quando o chamador é `service_role` ou `postgres`
--      (admin SQL). Usuários normais continuam só conseguindo apagar
--      a si mesmos.
--   2. Para cada usuário "órfão de auth" e cada "e2e+@mailinator.com",
--      chama a própria função (que já tem session_replication_role =
--      replica + ordem correta de DELETEs).
--   3. Adiciona FK em arqvalor.auditoria.user_id.
--   4. Normaliza filtros_salvos.user_id (auth.users → arqvalor.usuarios).
-- ============================================================


-- ============================================================
-- 1. Permite bypass admin na fn_excluir_dados_usremouario
-- ============================================================
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

  -- Bypassa triggers e FK constraints (requer superuser via SECURITY DEFINER)
  SET LOCAL session_replication_role = replica;

  -- Dependentes (referenciam contas/categorias/transacoes/usuarios)
  DELETE FROM arqvalor.lembretes              WHERE user_id = p_user_id;
  DELETE FROM arqvalor.filtros_salvos         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.assistente_lancamentos WHERE user_id = p_user_id;
  DELETE FROM arqvalor.auditoria              WHERE user_id = p_user_id;

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


-- ============================================================
-- 2. Limpeza usando a própria função
-- ============================================================

-- 2.1 Órfãos — user_id presente em outras tabelas mas inexistente em arqvalor.usuarios.
-- Como a função usa o user_id para apagar EM arqvalor.usuarios, mas aqui não há
-- linha em usuarios, simplemente apagamos os filhos diretamente (sem a função).
DELETE FROM arqvalor.lembretes
 WHERE user_id NOT IN (SELECT id FROM arqvalor.usuarios);

DELETE FROM arqvalor.filtros_salvos
 WHERE user_id NOT IN (SELECT id FROM arqvalor.usuarios);

DELETE FROM arqvalor.assistente_lancamentos
 WHERE user_id NOT IN (SELECT id FROM arqvalor.usuarios);

DELETE FROM arqvalor.auditoria
 WHERE user_id NOT IN (SELECT id FROM arqvalor.usuarios);

-- 2.2 Usuários e2e+@mailinator.com — chama a função para cada um.
-- A função respeita ordem de FKs e bypass de triggers via SECURITY DEFINER.
SELECT arqvalor.fn_excluir_dados_usuario(id)
  FROM auth.users
 WHERE email LIKE 'e2e+%@mailinator.com';

-- 2.3 Por fim, remove o registro em auth.users desses e2e+
DELETE FROM auth.users WHERE email LIKE 'e2e+%@mailinator.com';


-- ============================================================
-- 3. FK FALTANTE: arqvalor.auditoria.user_id
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'auditoria_user_id_fkey'
       AND connamespace = 'arqvalor'::regnamespace
  ) THEN
    ALTER TABLE arqvalor.auditoria
      ADD CONSTRAINT auditoria_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES arqvalor.usuarios(id)
      ON DELETE CASCADE;
  END IF;
END $$;


-- ============================================================
-- 4. NORMALIZAR filtros_salvos.user_id (auth.users → arqvalor.usuarios)
-- ============================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class r ON r.oid = c.confrelid
      JOIN pg_namespace nt ON nt.oid = t.relnamespace
      JOIN pg_namespace nr ON nr.oid = r.relnamespace
     WHERE c.conname = 'filtros_salvos_user_id_fkey'
       AND nt.nspname = 'arqvalor' AND t.relname = 'filtros_salvos'
       AND nr.nspname = 'auth'     AND r.relname = 'users'
  ) THEN
    ALTER TABLE arqvalor.filtros_salvos
      DROP CONSTRAINT filtros_salvos_user_id_fkey;
    ALTER TABLE arqvalor.filtros_salvos
      ADD CONSTRAINT filtros_salvos_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES arqvalor.usuarios(id)
      ON DELETE CASCADE;
  END IF;
END $$;
