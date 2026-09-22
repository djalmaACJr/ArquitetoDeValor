-- ============================================================
-- arqvalor.usuarios.ordem_quadros — merge atômico de uma única chave
--
-- Achado: o client fazia leitura+escrita do blob inteiro (SELECT
-- ordem_quadros, mescla em memória, UPDATE ordem_quadros = <blob completo>).
-- Com duas páginas diferentes salvando chaves diferentes em sequência rápida
-- (ex.: reordenar um quadro na página de um ativo, clicar "voltar" e abrir
-- outro ativo em seguida), a segunda escrita podia completar ANTES da
-- primeira terminar seu próprio round-trip de leitura+escrita — cada UPDATE
-- sobrescreve a coluna inteira, então a escrita que chegasse por último
-- "vencia" e apagava silenciosamente a chave da outra. Serializar as escritas
-- no client (fila) só resolve DENTRO de uma mesma instância do hook — não
-- entre duas páginas/instâncias diferentes, que é exatamente o caso relatado
-- (página desmonta ao navegar, escrita em voo continua em segundo plano).
--
-- Corrigido de vez fazendo o merge ATÔMICO no banco: um único UPDATE com
-- `ordem_quadros || jsonb_build_object(chave, ordem)` (uma única transação,
-- sem round-trip de leitura do client) — nunca perde uma chave escrita por
-- outra sessão/página entre o read e o write do client, porque não HÁ read
-- do client.
--
-- SECURITY INVOKER de propósito: roda com o papel do chamador, RLS de
-- `usuarios` continua valendo; opera sempre na própria linha (auth.uid()),
-- sem receber user_id por parâmetro — não há como mexer na linha de outro
-- usuário mesmo chamando com argumentos arbitrários.
--
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_mesclar_ordem_quadros(p_chave text, p_ordem jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
  UPDATE arqvalor.usuarios
  -- `||` em dois objetos jsonb: em chave duplicada, o operando da DIREITA
  -- vence — por isso o blob existente vai à ESQUERDA (base) e o par novo à
  -- DIREITA (o que estamos de fato atualizando), nessa ordem.
  SET ordem_quadros = COALESCE(ordem_quadros, '{}'::jsonb) || jsonb_build_object(p_chave, p_ordem)
  WHERE id = auth.uid()
  RETURNING ordem_quadros;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_mesclar_ordem_quadros(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_mesclar_ordem_quadros(text, jsonb) TO authenticated, service_role;
