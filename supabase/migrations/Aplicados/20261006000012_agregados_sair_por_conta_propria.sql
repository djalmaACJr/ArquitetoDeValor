-- O agregado pode deixar de acessar o espaço de um dono por conta própria.
-- Reaproveita o status REVOGADO (já corta o acesso em toda regra de segurança e
-- permite o dono convidar de novo — fn_convidar_agregado só reaproveita
-- PENDENTE/ACEITO), com uma marca pra distinguir "o dono revogou" de "o
-- próprio agregado saiu": o dono vê "Saiu" e o agregado não recebe o aviso de
-- "acesso revogado" por algo que ele mesmo fez.
ALTER TABLE arqvalor.agregados
  ADD COLUMN IF NOT EXISTS saiu_por_agregado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION arqvalor.fn_sair_agregado(p_vinculo_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
BEGIN
  UPDATE arqvalor.agregados
     SET status = 'REVOGADO', revogado_em = now(), atualizado_em = now(),
         saiu_por_agregado = TRUE
   WHERE id = p_vinculo_id AND agregado_id = auth.uid() AND status = 'ACEITO';
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_NAO_ENCONTRADO'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_sair_agregado(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_sair_agregado(UUID) TO authenticated;

-- Visão do agregado passa a trazer `saiu_por_agregado` (aviso de revogação
-- ignora saídas voluntárias).
DROP FUNCTION IF EXISTS arqvalor.fn_meus_vinculos_como_agregado();

CREATE FUNCTION arqvalor.fn_meus_vinculos_como_agregado()
RETURNS TABLE (
  id                UUID,
  dono_id           UUID,
  dono_nome         TEXT,
  email_convidado   TEXT,
  status            arqvalor.status_convite_agregado,
  criado_em         TIMESTAMPTZ,
  aceito_em         TIMESTAMPTZ,
  revogado_em       TIMESTAMPTZ,
  permissoes        JSONB,
  saiu_por_agregado BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT
    ag.id, ag.dono_id, u.nome, ag.email_convidado, ag.status, ag.criado_em, ag.aceito_em, ag.revogado_em,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('modulo', p.modulo, 'pode_escrever', p.pode_escrever))
      FROM arqvalor.agregados_permissoes p
      WHERE p.agregado_vinculo_id = ag.id
    ), '[]'::jsonb) AS permissoes,
    ag.saiu_por_agregado
  FROM arqvalor.agregados ag
  JOIN arqvalor.usuarios u ON u.id = ag.dono_id
  WHERE ag.agregado_id = auth.uid()
     OR (
       ag.status = 'PENDENTE'
       AND lower(ag.email_convidado) = lower((SELECT email FROM arqvalor.usuarios WHERE id = auth.uid()))
     );
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_meus_vinculos_como_agregado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_meus_vinculos_como_agregado() TO authenticated;
