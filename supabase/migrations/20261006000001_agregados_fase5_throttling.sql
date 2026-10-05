-- 20261006000001_agregados_fase5_throttling.sql
--
-- Fase 5 (hardening) do plano de agregados: throttling de convite —
-- mitiga abuso do relay de e-mail (Brevo, função `convite`/`agregados`)
-- por uma conta comprometida ou script, e evita cliques repetidos no botão
-- "Reenviar" derrubando a caixa de entrada do convidado.
--
--   • fn_convidar_agregado: no máximo 10 convites NOVOS por hora corrida,
--     por dono (conta total em `agregados.criado_em`, qualquer status —
--     reaproveitar um convite já PENDENTE pro mesmo e-mail, linha 196-202
--     do corpo original, não conta como novo).
--   • fn_reenviar_convite_agregado: no máximo 1 reenvio a cada 60s por
--     vínculo (usa o próprio `atualizado_em`, que a função já atualiza a
--     cada reenvio — sem coluna nova).
--
-- Mesmo corpo de 20260930000001_agregados_fundacao.sql, só com as duas
-- guardas novas inseridas.

CREATE OR REPLACE FUNCTION arqvalor.fn_convidar_agregado(p_email TEXT)
RETURNS arqvalor.agregados
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE
  v_dono_id    UUID := auth.uid();
  v_email      TEXT := lower(trim(p_email));
  v_dono_email TEXT;
  v_row        arqvalor.agregados;
  v_count_hora INT;
BEGIN
  IF v_dono_id IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
  IF v_email IS NULL OR v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'EMAIL_INVALIDO';
  END IF;

  SELECT email INTO v_dono_email FROM arqvalor.usuarios WHERE id = v_dono_id;
  IF v_dono_email IS NOT NULL AND lower(v_dono_email) = v_email THEN
    RAISE EXCEPTION 'CONVITE_PROPRIO: não é possível convidar a própria conta.';
  END IF;

  SELECT * INTO v_row FROM arqvalor.agregados
    WHERE dono_id = v_dono_id AND lower(email_convidado) = v_email AND status IN ('PENDENTE','ACEITO');
  IF FOUND THEN
    IF v_row.status = 'ACEITO' THEN
      RAISE EXCEPTION 'JA_AGREGADO: este e-mail já é um agregado ativo.';
    END IF;
    RETURN v_row; -- já pendente — o endpoint decide se reenvia o e-mail
  END IF;

  -- Throttling: só conta daqui pra baixo — reaproveitar um convite já
  -- pendente (early return acima) nunca esbarra no limite.
  SELECT count(*) INTO v_count_hora FROM arqvalor.agregados
    WHERE dono_id = v_dono_id AND criado_em > now() - interval '1 hour';
  IF v_count_hora >= 10 THEN
    RAISE EXCEPTION 'LIMITE_CONVITES_EXCEDIDO: máximo de 10 convites novos por hora — tente novamente mais tarde.';
  END IF;

  INSERT INTO arqvalor.agregados (dono_id, email_convidado)
  VALUES (v_dono_id, v_email)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION arqvalor.fn_reenviar_convite_agregado(p_vinculo_id UUID)
RETURNS arqvalor.agregados
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE
  v_atual arqvalor.agregados;
  v_row   arqvalor.agregados;
BEGIN
  SELECT * INTO v_atual FROM arqvalor.agregados
    WHERE id = p_vinculo_id AND dono_id = auth.uid() AND status = 'PENDENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_NAO_ENCONTRADO'; END IF;

  IF v_atual.atualizado_em > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'REENVIO_MUITO_RECENTE: aguarde um minuto antes de reenviar de novo.';
  END IF;

  UPDATE arqvalor.agregados
     SET token = gen_random_uuid(), token_expira_em = now() + interval '7 days', atualizado_em = now()
   WHERE id = p_vinculo_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
