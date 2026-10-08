-- ============================================================
-- Correção — fn_excluir_dados_usuario (excluir conta) sem superusuário
--
-- PROBLEMA 1 (o erro que o usuário via):
--   A função fazia `SET LOCAL session_replication_role = replica` para
--   desligar os triggers de proteção durante o wipe. Esse parâmetro é
--   EXCLUSIVO DE SUPERUSUÁRIO; no Supabase hospedado o `postgres` não é
--   superusuário, então a chamada falhava com:
--     "permission denied to set parameter session_replication_role".
--   Resultado: o botão "Excluir conta" nunca funcionava em produção.
--
-- PROBLEMA 2 (latente, mascarado pelo problema 1):
--   session_replication_role = replica também desligava as VERIFICAÇÕES DE
--   FK. Isso escondia que a lista de exclusão estava INCOMPLETA: as tabelas
--   fatura_import_item e fatura_import_sessao (referenciam categorias,
--   contas e transacoes) não eram apagadas. Sem o bypass de FK, a exclusão
--   travaria nelas; com o bypass, ficavam órfãs.
--
-- CORREÇÃO:
--   • Troca session_replication_role por `ALTER TABLE ... DISABLE TRIGGER
--     USER` nas 3 tabelas com triggers de PROTEÇÃO (categorias, transacoes,
--     contas). Isso desliga só os triggers de usuário (proteção da categoria
--     "Transferências", bloqueio de transferência avulsa, bloqueio de conta/
--     categoria com vínculos) — o dono das tabelas (postgres) PODE fazer
--     isso sem ser superusuário. As FKs (triggers de sistema) permanecem
--     ATIVAS, garantindo integridade.
--   • Como as FKs continuam ativas, a exclusão agora segue a ORDEM FK-SEGURA
--     completa (filhos antes dos pais), incluindo as tabelas de fatura e as
--     subcategorias antes das categorias-pai (FK auto-referente id_pai).
--   • É transacional: se qualquer passo falhar, o ROLLBACK reativa os
--     triggers automaticamente.
--
-- Mantém a checagem de autorização original (só o próprio usuário, ou
-- postgres/service_role, podem excluir). Idempotente (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_dados_usuario(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_role      TEXT := current_user;
  v_auth_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
BEGIN
  IF v_role NOT IN ('postgres','supabase_admin') AND v_auth_role <> 'service_role' THEN
    IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'ACESSO_NEGADO'
        USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
    END IF;
  END IF;

  -- Desliga SÓ os triggers de usuário (proteção) nas tabelas que os têm.
  -- FKs (triggers de sistema) seguem ativas → integridade preservada.
  ALTER TABLE arqvalor.categorias DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.transacoes DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.contas     DISABLE TRIGGER USER;

  -- ── Faturas (import): filhos antes; referenciam categorias/contas/transacoes ──
  DELETE FROM arqvalor.fatura_import_item   WHERE user_id = p_user_id;
  DELETE FROM arqvalor.fatura_import_sessao WHERE user_id = p_user_id;

  -- ── Investimentos (filhos → pais) ──
  DELETE FROM arqvalor.inv_historico_mensal WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_dividendos       WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_operacoes        WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_posicoes         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_alocacoes_tipo   WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_avaliacoes       WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_questionarios    WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_proventos_fundo  WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_tipos_dividendo  WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_ativos           WHERE user_id = p_user_id;

  -- ── Objetivos ──
  DELETE FROM arqvalor.objetivos_progresso
    WHERE objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = p_user_id);
  DELETE FROM arqvalor.objetivos            WHERE user_id = p_user_id;

  -- ── Dependentes ──
  DELETE FROM arqvalor.lembretes              WHERE user_id = p_user_id;
  DELETE FROM arqvalor.filtros_salvos         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.assistente_lancamentos WHERE user_id = p_user_id;

  -- ── Domínio principal ──
  DELETE FROM arqvalor.transacoes WHERE user_id = p_user_id;

  -- Categorias: subcategorias (id_pai NOT NULL) antes das pais, por causa da
  -- FK auto-referente id_pai (que continua ativa).
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id AND id_pai IS NOT NULL;
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id AND id_pai IS NULL;

  DELETE FROM arqvalor.contas     WHERE user_id = p_user_id;

  DELETE FROM arqvalor.usuarios   WHERE id = p_user_id;

  -- Reativa os triggers (o rollback também reativaria em caso de erro).
  ALTER TABLE arqvalor.categorias ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.transacoes ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.contas     ENABLE TRIGGER USER;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;
