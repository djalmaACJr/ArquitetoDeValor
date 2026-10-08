-- ============================================================
-- Transferências — criação atômica do par (e da série recorrente)
--
-- Antes, a Edge Function `transferencias` criava o par débito+crédito em
-- dois INSERTs sequenciais, com DELETE compensatório manual se o segundo
-- falhasse (transferencias/index.ts). Se o processo morresse ENTRE os dois
-- INSERTs — ou se o próprio DELETE de compensação falhasse (timeout de
-- rede) — sobrava meio par no extrato, violando a invariante "nunca existe
-- só um lado do par" (documentada em CLAUDE.md › Consistência de
-- transferências).
--
-- Esta função move a ESCRITA para dentro de uma única transação do Postgres:
-- todas as linhas (2 para simples, 2×N para recorrente) entram de uma vez;
-- qualquer erro (constraint, trigger de isolamento, RLS) faz ROLLBACK de
-- TODAS. A lógica de negócio (datas das parcelas, status, descrição) continua
-- na Edge Function — aqui só se recebe o array pronto e se grava atômico.
--
-- SECURITY INVOKER de propósito: a INSERT roda com o papel do chamador
-- (JWT do usuário via db(req)), então a policy RLS `pol_transacoes_user`
-- (WITH CHECK user_id = auth.uid()) e o trigger `fn_validar_isolamento_usuario`
-- continuam valendo — a atomicidade NÃO afrouxa o isolamento.
--
-- Idempotente: CREATE OR REPLACE.
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
    id_par_transferencia, id_recorrencia, nr_parcela, total_parcelas, tipo_recorrencia
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
    NULLIF(x->>'tipo_recorrencia', '')::arqvalor.tipo_recorrencia
  FROM jsonb_array_elements(p_rows) AS x
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_criar_transferencia(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_criar_transferencia(jsonb) TO authenticated, service_role;
