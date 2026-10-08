-- 20261004000003_agregados_fase4_transacoes_investimentos.sql
--
-- Achado em teste (CA-AGR59): dividendos (inv_dividendos) sempre geram uma
-- transação espelhada no extrato (arqvalor.transacoes) na MESMA conta do
-- dividendo. As policies de agregado em `transacoes` (Fases 1/2) só
-- reconheciam o módulo EXTRATO — um agregado com SÓ o módulo INVESTIMENTOS
-- liberado (sem EXTRATO) conseguia criar o `inv_dividendos`, mas o INSERT
-- na transação vinculada falhava por RLS ("new row violates row-level
-- security policy for table transacoes"). Mesmo espírito da extensão já
-- feita em pol_contas_agregado_select/pol_categorias_agregado_select
-- (Fases 1/3/4): reconhece mais um módulo como razão válida de acesso à
-- MESMA conta, sem tocar a condição original de EXTRATO.
--
-- Nota: esta mesma extensão já tinha sido ESCRITA dentro de
-- 20261004000001_agregados_fase4_investimentos.sql, mas como aquele arquivo
-- já tinha sido aplicado (db push é idempotente por nome de arquivo, não
-- por conteúdo), a edição nunca chegou a rodar de verdade — daí precisar de
-- um arquivo novo aqui (mesma lição já aprendida com
-- 20261003000002/20261004000002 nesta mesma leva de migrations).
ALTER POLICY pol_transacoes_agregado_select ON arqvalor.transacoes
  USING (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id)
  );

ALTER POLICY pol_transacoes_agregado_insert ON arqvalor.transacoes
  WITH CHECK (
    (
      arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true)
      OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
    )
    AND criado_por = auth.uid()
  );

ALTER POLICY pol_transacoes_agregado_update ON arqvalor.transacoes
  USING (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
  )
  WITH CHECK (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
  );

ALTER POLICY pol_transacoes_agregado_delete ON arqvalor.transacoes
  USING (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
  );
