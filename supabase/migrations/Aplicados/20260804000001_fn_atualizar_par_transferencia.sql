-- ============================================================
-- Transferências — sincronização atômica do par ao editar via /transacoes
--
-- Bug reportado: PUT /transacoes/:id?escopo=SOMENTE_ESTE (usado por
-- alterarStatus/handleStatus/pagarSelecionados/cancelarPgtoSelecionados em
-- LancamentosPage.tsx) atualizava a transação isoladamente, sem checar
-- id_par_transferencia. Resultado: marcar uma perna do par como PAGO (ex.:
-- ao filtrar o extrato por uma única conta do par) deixava a outra perna
-- com o status antigo — violando a invariante "nunca existe só um lado do
-- par" (CLAUDE.md › Consistência de transferências).
--
-- Esta função espelha valor/data/status/observacao nas DUAS pernas do par
-- (via id_par_transferencia) numa única transação do Postgres — a Edge
-- Function `transacoes/index.ts` passa a chamá-la sempre que a transação
-- editada tiver id_par_transferencia preenchido, em vez de fazer um UPDATE
-- isolado na linha.
--
-- conta_id/categoria_id/tipo/descricao NÃO são propagáveis por aqui —
-- diferem por natureza entre débito e crédito (conta origem/destino,
-- prefixo "[Transf. saída/entrada]") e continuam exclusivos do fluxo
-- PUT /transferencias/:id_par, que já sabe montar cada lado corretamente.
--
-- SECURITY INVOKER de propósito: roda com o papel do chamador (JWT via
-- db(req)), RLS (`pol_transacoes_user`) continua valendo — só afeta linhas
-- do próprio usuário.
--
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_par_transferencia(
  p_id_par_transferencia uuid,
  p_campos jsonb
)
RETURNS SETOF arqvalor.transacoes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  UPDATE arqvalor.transacoes SET
    valor      = CASE WHEN p_campos ? 'valor'      THEN (p_campos->>'valor')::numeric                  ELSE valor      END,
    data       = CASE WHEN p_campos ? 'data'       THEN (p_campos->>'data')::date                      ELSE data       END,
    status     = CASE WHEN p_campos ? 'status'     THEN (p_campos->>'status')::arqvalor.status_transacao ELSE status   END,
    observacao = CASE WHEN p_campos ? 'observacao' THEN p_campos->>'observacao'                         ELSE observacao END
  WHERE id_par_transferencia = p_id_par_transferencia
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_atualizar_par_transferencia(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_atualizar_par_transferencia(uuid, jsonb) TO authenticated, service_role;
