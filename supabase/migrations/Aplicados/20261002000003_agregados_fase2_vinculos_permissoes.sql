-- ============================================================
-- "Usuários agregados" — Fase 2: fn_meus_vinculos_como_agregado precisa
-- devolver as PERMISSÕES de cada vínculo.
--
-- Achado real na Fase 2: `SeletorEspaco.tsx` hardcoda `permissoes: []` ao
-- escolher um espaço — placeholder deixado de propósito na Fase 1 (só
-- leitura, módulo nunca era checado). Com a escrita agora valendo
-- (`pode_escrever`), sem esse dado o frontend NUNCA saberia que o dono
-- liberou edição — toda tela de agregado pareceria só-leitura mesmo com a
-- permissão concedida. Esta migration fecha a ponta que faltava: a função
-- passa a agregar `agregados_permissoes` num jsonb array por vínculo.
--
-- Troca de tipo de retorno exige DROP FUNCTION antes do CREATE.
-- ============================================================

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
  permissoes      JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT
    ag.id, ag.dono_id, u.nome, ag.email_convidado, ag.status, ag.criado_em, ag.aceito_em,
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
