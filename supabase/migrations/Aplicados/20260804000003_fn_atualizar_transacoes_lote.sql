-- ============================================================
-- Transações — atualização em lote atômica de uma série de recorrência
--
-- `transacoes/index.ts` `editar()`, ao recalcular datas/status de uma série
-- (escopo TODOS/ESTE_E_SEGUINTES com data ou frequência alteradas), fazia um
-- UPDATE por parcela dentro de um loop `for`, e em erro apenas logava e
-- CONTINUAVA o loop — a função retornava HTTP 200 mesmo com falhas parciais,
-- deixando a série com datas/status inconsistentes sem informar o chamador
-- quais parcelas falharam (achado de auditoria, categoria Bugs/Alto).
--
-- Esta função recebe um array de { id, campos } — os mesmos campos já
-- calculados pela Edge Function para cada parcela (data/status recalculados,
-- mais os demais campos comuns do payload) — e aplica tudo num único
-- UPDATE...FROM dentro de uma única transação: ou a série inteira atualiza,
-- ou nada muda (e o erro chega explícito ao chamador).
--
-- SECURITY INVOKER de propósito: roda com o papel do chamador (JWT via
-- db(req)), RLS continua valendo — só afeta linhas do próprio usuário.
--
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_transacoes_lote(p_updates jsonb)
RETURNS SETOF arqvalor.transacoes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  UPDATE arqvalor.transacoes t SET
    tipo        = CASE WHEN x.campos ? 'tipo'        THEN (x.campos->>'tipo')::arqvalor.tipo_transacao       ELSE t.tipo        END,
    conta_id    = CASE WHEN x.campos ? 'conta_id'    THEN (x.campos->>'conta_id')::uuid                      ELSE t.conta_id    END,
    categoria_id= CASE WHEN x.campos ? 'categoria_id' THEN (x.campos->>'categoria_id')::uuid                 ELSE t.categoria_id END,
    descricao   = CASE WHEN x.campos ? 'descricao'   THEN x.campos->>'descricao'                             ELSE t.descricao   END,
    valor       = CASE WHEN x.campos ? 'valor'       THEN (x.campos->>'valor')::numeric                      ELSE t.valor       END,
    data        = CASE WHEN x.campos ? 'data'        THEN (x.campos->>'data')::date                          ELSE t.data        END,
    status      = CASE WHEN x.campos ? 'status'      THEN (x.campos->>'status')::arqvalor.status_transacao   ELSE t.status      END,
    observacao  = CASE WHEN x.campos ? 'observacao'  THEN x.campos->>'observacao'                             ELSE t.observacao  END
  FROM (
    SELECT (e->>'id')::uuid AS id, e->'campos' AS campos
    FROM jsonb_array_elements(p_updates) AS e
  ) AS x
  WHERE t.id = x.id
  RETURNING t.*;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_atualizar_transacoes_lote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_atualizar_transacoes_lote(jsonb) TO authenticated, service_role;
