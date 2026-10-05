-- 20261004000002_agregados_fase4_categorias_investimentos.sql
--
-- Achado em teste (CA-AGR59): fn_validar_isolamento_usuario (trigger BEFORE
-- INSERT/UPDATE em transacoes, SEM SECURITY DEFINER — roda com o papel de
-- quem faz o INSERT) valida categoria_id fazendo seu PRÓPRIO SELECT em
-- `categorias`, sujeito à RLS de quem está inserindo. Um dividendo sempre
-- carrega a categoria mapeada em inv_tipos_dividendo — sem `categorias`
-- reconhecer INVESTIMENTOS como razão de visibilidade, o INSERT da
-- transação (já liberado pela extensão de pol_transacoes_agregado_* em
-- 20261004000001) passava pela RLS de `transacoes`, mas o trigger rejeitava
-- com CATEGORIA_INVALIDA antes mesmo de chegar lá.
ALTER POLICY pol_categorias_agregado_select ON arqvalor.categorias
  USING (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO')
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'OBJETIVOS')
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS')
  );
