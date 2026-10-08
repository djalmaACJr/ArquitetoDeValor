-- ============================================================
-- fn_criar_transferencia nunca incluía `observacao` na lista de colunas do
-- INSERT — bug pré-existente (já estava assim antes da Fase 2 de
-- agregados, confirmado comparando com a versão original em
-- 20260713000002_fn_criar_transferencia_atomica.sql), só agora visível
-- porque a suíte completa (CA-TRF28) rodou de ponta a ponta junto com as
-- mudanças da Fase 2 nesta mesma função (adição de `criado_por`).
--
-- Efeito do bug: toda transferência criada com `observacao` preenchida
-- gravava a coluna como NULL — a observação se perdia silenciosamente
-- (sem erro, sem aviso).
--
-- Corrigido aqui porque esta função já estava sendo reescrita por causa de
-- `criado_por` (20261002000001) — aproveitar pra consertar os dois de uma
-- vez em vez de deixar o bug antigo persistir.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_criar_transferencia(p_rows jsonb)
RETURNS SETOF arqvalor.transacoes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO arqvalor.transacoes (
    user_id, conta_id, categoria_id, data, descricao, valor, tipo, status,
    id_par_transferencia, id_recorrencia, nr_parcela, total_parcelas, tipo_recorrencia,
    criado_por, observacao
  )
  SELECT
    (x->>'user_id')::uuid,
    (x->>'conta_id')::uuid,
    (x->>'categoria_id')::uuid,
    (x->>'data')::date,
    x->>'descricao',
    (x->>'valor')::numeric,
    (x->>'tipo')::arqvalor.tipo_transacao,
    (x->>'status')::arqvalor.status_transacao,
    (x->>'id_par_transferencia')::uuid,
    NULLIF(x->>'id_recorrencia', '')::uuid,
    NULLIF(x->>'nr_parcela', '')::int,
    NULLIF(x->>'total_parcelas', '')::int,
    NULLIF(x->>'tipo_recorrencia', '')::arqvalor.tipo_recorrencia,
    NULLIF(x->>'criado_por', '')::uuid,
    x->>'observacao'
  FROM jsonb_array_elements(p_rows) AS x
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_criar_transferencia(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_criar_transferencia(jsonb) TO authenticated, service_role;
