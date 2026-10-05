-- 20261006000003_agregados_fase5_aviso_revogacao.sql
--
-- Fase 5 (hardening) do plano de agregados: aviso de revogação ao agregado.
-- Hoje, quando um dono revoga um vínculo, o agregado só descobre que
-- perdeu acesso na próxima vez que tentar abrir aquele espaço (some do
-- seletor sem explicação). Mesmo padrão já usado por
-- cron_avisos_vistos_em/datacom_avisos_vistos (AvisosCronAdmin/
-- AvisoDataComProxima): computado no CLIENTE a partir de dado que já existe
-- (fn_meus_vinculos_como_agregado já devolve vínculos REVOGADO onde
-- agregado_id = auth.uid() — só faltava `revogado_em` pra saber "desde
-- quando"), sem endpoint novo.
--
-- `agregados_avisos_vistos_em` segue o padrão "timestamp único" de
-- cron_avisos_vistos_em (não o "conjunto de chaves" de
-- datacom_avisos_vistos) porque uma revogação, ao contrário de uma Data COM
-- próxima, nunca "volta a ficar pendente" — um vínculo revogado não some da
-- janela e reaparece depois, então um corte de tempo simples basta.

ALTER TABLE arqvalor.usuarios
  ADD COLUMN IF NOT EXISTS agregados_avisos_vistos_em TIMESTAMPTZ;

DROP FUNCTION IF EXISTS arqvalor.fn_meus_vinculos_como_agregado();

CREATE FUNCTION arqvalor.fn_meus_vinculos_como_agregado()
RETURNS TABLE (
  id              UUID,
  dono_id         UUID,
  dono_nome       TEXT,
  email_convidado TEXT,
  status          arqvalor.status_convite_agregado,
  criado_em       TIMESTAMPTZ,
  aceito_em       TIMESTAMPTZ,
  revogado_em     TIMESTAMPTZ,
  permissoes      JSONB
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
    ), '[]'::jsonb) AS permissoes
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
