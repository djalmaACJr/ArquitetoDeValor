-- ============================================================
-- Transferências — edição atômica do par/série (débito + crédito)
--
-- `transferencias/index.ts` `editar()` fazia 2 (ou 2×N, para série) UPDATEs
-- sequenciais — um para as pernas de débito, outro para as de crédito. Se o
-- primeiro tivesse sucesso e o segundo falhasse (erro de rede, constraint),
-- o par ficava com valor/status/descrição divergentes entre as duas pernas,
-- violando a invariante "nunca existe só um lado do par consistente"
-- (CLAUDE.md › Consistência de transferências) — mesma classe de problema
-- já corrigida para criação/exclusão em fn_criar_transferencia/
-- fn_excluir_transferencias.
--
-- Esta função recebe um array de { id, campos } — um item por transação a
-- atualizar (2 para SOMENTE_ESTE, 2×N para TODOS/ESTE_E_SEGUINTES) — e
-- aplica tudo num único UPDATE...FROM, dentro de uma única transação do
-- Postgres: ou o par/série inteiro atualiza, ou nada muda.
--
-- SECURITY INVOKER de propósito: roda com o papel do chamador (JWT via
-- db(req)), RLS continua valendo — só afeta linhas do próprio usuário.
--
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_transacoes_transferencia(p_updates jsonb)
RETURNS SETOF arqvalor.transacoes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  UPDATE arqvalor.transacoes t SET
    conta_id   = CASE WHEN x.campos ? 'conta_id'   THEN (x.campos->>'conta_id')::uuid                    ELSE t.conta_id   END,
    descricao  = CASE WHEN x.campos ? 'descricao'  THEN x.campos->>'descricao'                           ELSE t.descricao  END,
    valor      = CASE WHEN x.campos ? 'valor'      THEN (x.campos->>'valor')::numeric                    ELSE t.valor      END,
    data       = CASE WHEN x.campos ? 'data'       THEN (x.campos->>'data')::date                        ELSE t.data       END,
    status     = CASE WHEN x.campos ? 'status'     THEN (x.campos->>'status')::arqvalor.status_transacao ELSE t.status     END,
    observacao = CASE WHEN x.campos ? 'observacao' THEN x.campos->>'observacao'                          ELSE t.observacao END
  FROM (
    SELECT (e->>'id')::uuid AS id, e->'campos' AS campos
    FROM jsonb_array_elements(p_updates) AS e
  ) AS x
  WHERE t.id = x.id
  RETURNING t.*;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_atualizar_transacoes_transferencia(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_atualizar_transacoes_transferencia(jsonb) TO authenticated, service_role;
