-- Achado de revisão de segurança (out/2026): pol_usuarios_agregado_select
-- (20261002000002) liberava SELECT da LINHA INTEIRA de `usuarios` entre dono e
-- agregado ACEITO — RLS não restringe colunas. Resultado: o agregado lia, do
-- dono (e o dono, do agregado), chat_mascote_historico (conversas com a IA),
-- ia_configs (credenciais criptografadas), inv_perfil, e-mail, data_nascimento
-- e demais preferências, muito além do `nome` que a feature precisa.
--
-- Correção: remove a policy e expõe SÓ id+nome por uma RPC SECURITY DEFINER
-- que autoriza explicitamente (o próprio usuário, ou vínculo ACEITO entre os
-- dois, nas duas direções). Consumidor: mapaUsuarios() em functions/transacoes
-- ("lançado por Fulano"). O nome do dono pro agregado já vem de
-- fn_meus_vinculos_como_agregado (DEFINER).
CREATE OR REPLACE FUNCTION arqvalor.fn_nomes_usuarios(p_ids UUID[])
RETURNS TABLE (id UUID, nome TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT u.id, u.nome
    FROM arqvalor.usuarios u
   WHERE u.id = ANY(p_ids)
     AND auth.uid() IS NOT NULL
     AND (
       u.id = auth.uid()
       OR EXISTS (
         SELECT 1 FROM arqvalor.agregados ag
          WHERE ag.status = 'ACEITO'
            AND ((ag.dono_id = auth.uid() AND ag.agregado_id = u.id)
              OR (ag.agregado_id = auth.uid() AND ag.dono_id = u.id))
       )
     );
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_nomes_usuarios(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_nomes_usuarios(UUID[]) TO authenticated;

DROP POLICY IF EXISTS pol_usuarios_agregado_select ON arqvalor.usuarios;
