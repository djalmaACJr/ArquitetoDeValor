-- ============================================================
-- "Usuários agregados" — Fase 1: aceitar/recusar convite PELO ID (sem
-- precisar do token).
--
-- Motivação: a tela "Convites que recebi" (CompartilhamentoPage) lista os
-- convites via fn_meus_vinculos_como_agregado(), que de propósito NUNCA
-- devolve o token (só existe dentro do link de e-mail — ver comentário em
-- agregados/index.ts). Sem uma versão "por id", não haveria como aceitar/
-- recusar um convite exibido nessa lista, só via link de e-mail.
--
-- Mesmas checagens de segurança da versão por token (status PENDENTE,
-- e-mail do chamador bate com email_convidado) — o token nunca foi a
-- fonte real de autorização aqui, é só o mecanismo pra alguém SEM conta
-- ainda chegar na tela certa; quem já está autenticado e tem o e-mail
-- batendo não precisa dele.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_aceitar_convite_agregado_por_id(p_vinculo_id UUID)
RETURNS arqvalor.agregados
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_row   arqvalor.agregados;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
  SELECT email INTO v_email FROM arqvalor.usuarios WHERE id = v_uid;

  SELECT * INTO v_row FROM arqvalor.agregados WHERE id = p_vinculo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_NAO_ENCONTRADO'; END IF;
  IF v_row.status <> 'PENDENTE' THEN RAISE EXCEPTION 'CONVITE_INVALIDO: já respondido ou revogado.'; END IF;
  IF v_row.token_expira_em < now() THEN RAISE EXCEPTION 'CONVITE_EXPIRADO'; END IF;
  IF v_email IS NULL OR lower(v_row.email_convidado) <> lower(v_email) THEN
    RAISE EXCEPTION 'EMAIL_NAO_CONFERE';
  END IF;

  UPDATE arqvalor.agregados
     SET agregado_id = v_uid, status = 'ACEITO', aceito_em = now(), atualizado_em = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION arqvalor.fn_recusar_convite_agregado_por_id(p_vinculo_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_row   arqvalor.agregados;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
  SELECT email INTO v_email FROM arqvalor.usuarios WHERE id = v_uid;

  SELECT * INTO v_row FROM arqvalor.agregados WHERE id = p_vinculo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_NAO_ENCONTRADO'; END IF;
  IF v_row.status <> 'PENDENTE' THEN RAISE EXCEPTION 'CONVITE_INVALIDO'; END IF;
  IF v_email IS NULL OR lower(v_row.email_convidado) <> lower(v_email) THEN
    RAISE EXCEPTION 'EMAIL_NAO_CONFERE';
  END IF;

  UPDATE arqvalor.agregados SET status = 'RECUSADO', atualizado_em = now() WHERE id = v_row.id;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_aceitar_convite_agregado_por_id(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION arqvalor.fn_recusar_convite_agregado_por_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_aceitar_convite_agregado_por_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION arqvalor.fn_recusar_convite_agregado_por_id(UUID) TO authenticated;
