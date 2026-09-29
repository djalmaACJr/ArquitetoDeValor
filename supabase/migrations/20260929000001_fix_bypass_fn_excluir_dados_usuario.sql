-- ============================================================
-- CORREÇÃO CRÍTICA — fn_excluir_dados_usuario bypassava auth.uid()
-- pra QUALQUER chamador autenticado
-- ============================================================
-- Achado de revisão de segurança (2026-09-29, Supabase Security Advisor +
-- verificação ao vivo): a versão anterior (20260714000001) tentava permitir
-- que fn_remover_usuario (trigger BEFORE DELETE em auth.users, que roda
-- como o dono da função) chamasse esta rotina sem o auth.uid() de um
-- usuário de verdade, checando:
--
--     v_role TEXT := current_user;
--     ...
--     IF v_role NOT IN ('postgres','supabase_admin') AND v_auth_role <> 'service_role' THEN
--       -- só aqui checava p_user_id = auth.uid()
--
-- O problema: `current_user` DENTRO de uma função SECURITY DEFINER é
-- SEMPRE o DONO da função (aqui, `postgres`), não o role de quem chamou —
-- isso vale tanto pra uma chamada legítima via trigger interno quanto pra
-- QUALQUER usuário comum chamando o RPC direto
-- (POST /rest/v1/rpc/fn_excluir_dados_usuario). `v_role` era 'postgres' em
-- 100% dos casos, então `v_role NOT IN ('postgres','supabase_admin')` era
-- SEMPRE falso — a checagem de auth.uid() nunca rodava, pra ninguém.
--
-- CONFIRMADO AO VIVO antes desta correção: um usuário autenticado comum
-- (sessão normal, sem service_role) conseguia apagar TODOS os dados de
-- QUALQUER user_id chamando o RPC direto, sem passar pela Edge Function
-- excluir_conta — inclusive contas, transações, categorias e investimentos
-- de outro usuário.
--
-- CORREÇÃO: separa a rotina em duas
--   1) arqvalor._excluir_dados_usuario_interno(p_user_id) — faz o trabalho
--      de fato. NUNCA exposta via API (sem GRANT a anon/authenticated) —
--      só outra função SECURITY DEFINER de mesmo dono (postgres) consegue
--      chamá-la, porque a chamada roda com o privilégio do CALLER (que já
--      é o dono, por já estar dentro de outra SECURITY DEFINER).
--   2) arqvalor.fn_excluir_dados_usuario(p_user_id) — a fachada exposta via
--      RPC. Autoriza usando SÓ sinais que refletem quem fez a chamada de
--      fato (auth.uid() e a claim `role` do JWT, nunca current_user) e
--      delega pra (1).
--   3) fn_remover_usuario (trigger) passa a chamar (1) diretamente — o
--      trigger só dispara como efeito de um DELETE em auth.users, que já é
--      uma operação privilegiada por si só; não precisa (e não pode, pelos
--      motivos acima) provar posse via auth.uid().
--
-- Idempotente (CREATE OR REPLACE / REVOKE-then-GRANT).
-- ============================================================

-- 1) Rotina interna — mesmo corpo de DELETEs de 20260714000001, sem
--    NENHUMA checagem de autorização (a autorização é responsabilidade de
--    quem chama esta função, nunca dela mesma).
CREATE OR REPLACE FUNCTION arqvalor._excluir_dados_usuario_interno(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
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

-- NUNCA exposta via API — sem GRANT nenhum pra anon/authenticated/service_role.
-- Só é alcançável de dentro de outra função SECURITY DEFINER de mesmo dono.
REVOKE ALL ON FUNCTION arqvalor._excluir_dados_usuario_interno(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- 2) Fachada pública (RPC) — única responsável por autorizar. Usa SÓ
--    auth.uid() (reflete o usuário do JWT de verdade, nunca muda dentro de
--    SECURITY DEFINER) e a claim `role` do JWT — NUNCA current_user, que é
--    sempre o dono da função e por isso inútil pra distinguir chamador.
CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_dados_usuario(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_auth_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
BEGIN
  -- service_role (chamada server-to-server, já bypassa RLS por natureza) é o
  -- único jeito de pular a checagem de posse — qualquer outro caller precisa
  -- provar que p_user_id é o próprio auth.uid().
  IF v_auth_role <> 'service_role' THEN
    IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'ACESSO_NEGADO'
        USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
    END IF;
  END IF;

  PERFORM arqvalor._excluir_dados_usuario_interno(p_user_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;

-- 3) O trigger interno chama a rotina interna DIRETO — nunca teve (nem
--    precisa ter) um auth.uid() de verdade pra provar, porque só dispara
--    como efeito colateral de um DELETE em auth.users, que já é uma
--    operação privilegiada (Dashboard/Admin API com service_role) por si só.
CREATE OR REPLACE FUNCTION arqvalor.fn_remover_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  PERFORM arqvalor._excluir_dados_usuario_interno(OLD.id);
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_remover_usuario() FROM PUBLIC, anon, authenticated;
