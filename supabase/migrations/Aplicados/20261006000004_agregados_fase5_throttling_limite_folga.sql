-- 20261006000004_agregados_fase5_throttling_limite_folga.sql
--
-- Achado ao escrever o teste de CA-AGR62 (20261006000001): o limite de 10
-- convites novos/hora era baixo demais até pra uso legítimo — a própria
-- suíte tests/13_agregados.test.ts cria ~40 convites de teste ao longo de
-- menos de 2 minutos (todos dentro da mesma hora corrida), e qualquer dono
-- real que esteja configurando várias contas conjuntas de uma vez (ex.:
-- cônjuge + 2 filhos + pai/mãe, cada um em módulos diferentes) poderia
-- esbarrar nisso numa sessão só. Sobe pra 100/hora — ainda barra o cenário
-- de abuso real (script bombardeando centenas de convites pra floodar o
-- relay de e-mail), com folga confortável pro uso legítimo mais pesado.
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
    RETURN v_row;
  END IF;

  SELECT count(*) INTO v_count_hora FROM arqvalor.agregados
    WHERE dono_id = v_dono_id AND criado_em > now() - interval '1 hour';
  IF v_count_hora >= 100 THEN
    RAISE EXCEPTION 'LIMITE_CONVITES_EXCEDIDO: máximo de 100 convites novos por hora — tente novamente mais tarde.';
  END IF;

  INSERT INTO arqvalor.agregados (dono_id, email_convidado)
  VALUES (v_dono_id, v_email)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
