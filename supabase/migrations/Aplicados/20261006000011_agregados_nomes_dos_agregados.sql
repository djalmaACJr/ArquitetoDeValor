-- Nome (usuarios.nome) de cada agregado do DONO, por vínculo — pra tela de
-- Compartilhamento exibir o nome em vez do e-mail. SECURITY DEFINER porque a
-- policy de `usuarios` só deixa o dono ler o perfil de agregado ACEITO; aqui
-- também vale pra REVOGADO/RECUSADO (histórico), mas devolve SÓ o nome, nunca o
-- resto do perfil. PENDENTE sem conta ainda (agregado_id nulo) volta sem nome.
CREATE OR REPLACE FUNCTION arqvalor.fn_nomes_dos_meus_agregados()
RETURNS TABLE (vinculo_id UUID, nome TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT ag.id, NULLIF(trim(u.nome), '')
    FROM arqvalor.agregados ag
    JOIN arqvalor.usuarios u ON u.id = ag.agregado_id
   WHERE ag.dono_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_nomes_dos_meus_agregados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_nomes_dos_meus_agregados() TO authenticated;
