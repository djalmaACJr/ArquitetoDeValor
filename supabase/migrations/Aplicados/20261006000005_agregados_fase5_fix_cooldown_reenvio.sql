-- 20261006000005_agregados_fase5_fix_cooldown_reenvio.sql
--
-- Achado real ao rodar a suíte inteira após 20261006000001: o cooldown de
-- reenvio comparava contra `atualizado_em`, que a própria CRIAÇÃO do
-- convite também seta (DEFAULT now()) — então reenviar logo depois de criar
-- (fluxo legítimo e já coberto por CA-AGR04/CA-AGR17, testes de Fase 0/1
-- anteriores à Fase 5) SEMPRE batia no cooldown de 60s, por nunca ter
-- havido um reenvio de verdade ainda. A intenção do throttling é barrar
-- CLIQUES REPETIDOS no botão "Reenviar" (resend após resend), não o
-- primeiro reenvio depois de criar.
--
-- Corrige com uma coluna dedicada (`ultimo_reenvio_em`, só setada pelo
-- PRÓPRIO fn_reenviar_convite_agregado) em vez de reaproveitar
-- `atualizado_em` — nula no primeiro reenvio (cooldown não se aplica),
-- comparada normalmente a partir do segundo em diante.
ALTER TABLE arqvalor.agregados
  ADD COLUMN IF NOT EXISTS ultimo_reenvio_em TIMESTAMPTZ;

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

  IF v_atual.ultimo_reenvio_em IS NOT NULL AND v_atual.ultimo_reenvio_em > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'REENVIO_MUITO_RECENTE: aguarde um minuto antes de reenviar de novo.';
  END IF;

  UPDATE arqvalor.agregados
     SET token = gen_random_uuid(), token_expira_em = now() + interval '7 days',
         ultimo_reenvio_em = now(), atualizado_em = now()
   WHERE id = p_vinculo_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
