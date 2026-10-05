-- ============================================================
-- "Usuários agregados" — Fase 2 (hardening): editar/excluir transferência
-- vira tudo-ou-nada mesmo quando uma das pernas está fora do escopo RLS
-- de quem está escrevendo.
--
-- Achado real (discutido com o usuário): fn_atualizar_par_transferencia,
-- fn_atualizar_transacoes_transferencia e fn_excluir_transferencias são
-- SECURITY INVOKER de propósito (RLS do chamador vale) e fazem um único
-- UPDATE/DELETE multi-linha filtrado só por id/id_par_transferencia. Isso é
-- perfeitamente atômico quando o chamador é o DONO (RLS sempre deixa ver as
-- duas pernas das próprias transações) — mas um agregado com `pode_escrever`
-- no Extrato, liberado só numa das duas contas de uma transferência
-- existente, consegue enxergar e tentar editar/excluir só UMA perna. Num
-- UPDATE/DELETE multi-linha, a RLS do Postgres não aborta a operação inteira
-- quando uma linha é invisível — ela simplesmente EXCLUI essa linha do que
-- foi afetado, silenciosamente. Resultado possível: só a perna visível muda,
-- a outra fica pra trás — quebrando "nunca existe só um lado do par"
-- (CLAUDE.md › Consistência de transferências).
--
-- Fase 2 nunca testou esse caso (CA-AGR37 só cobre transferência entre duas
-- contas AMBAS liberadas) — a lacuna não apareceu antes porque RLS
-- multi-linha nunca excluía nada quando só o dono mexia nos próprios dados.
--
-- Correção: cada função confere ROW_COUNT contra o total ESPERADO de linhas
-- afetadas logo após o UPDATE/DELETE e dá RAISE EXCEPTION se vier menor — o
-- Postgres desfaz a transação inteira (nada muda), e o chamador recebe um
-- erro claro em vez de uma corrupção silenciosa do par/série. Não afeta o
-- caminho do dono (que sempre bate 100% das linhas esperadas).
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
DECLARE
  v_count integer;
BEGIN
  UPDATE arqvalor.transacoes SET
    valor      = CASE WHEN p_campos ? 'valor'      THEN (p_campos->>'valor')::numeric                  ELSE valor      END,
    data       = CASE WHEN p_campos ? 'data'       THEN (p_campos->>'data')::date                      ELSE data       END,
    status     = CASE WHEN p_campos ? 'status'     THEN (p_campos->>'status')::arqvalor.status_transacao ELSE status   END,
    observacao = CASE WHEN p_campos ? 'observacao' THEN p_campos->>'observacao'                         ELSE observacao END
  WHERE id_par_transferencia = p_id_par_transferencia;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- Um par SEMPRE tem exatamente 2 pernas (débito + crédito). Se a RLS do
  -- chamador só deixou 1 (ou 0) ser afetada, aborta tudo em vez de deixar a
  -- outra perna desatualizada.
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'PAR_INCOMPLETO: % de 2 pernas da transferência estão no seu escopo — edição bloqueada para não quebrar o par.', v_count;
  END IF;

  RETURN QUERY SELECT * FROM arqvalor.transacoes WHERE id_par_transferencia = p_id_par_transferencia;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_atualizar_par_transferencia(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_atualizar_par_transferencia(uuid, jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_transacoes_transferencia(p_updates jsonb)
RETURNS SETOF arqvalor.transacoes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_count     integer;
  v_esperadas integer := jsonb_array_length(p_updates);
  v_ids       uuid[];
BEGIN
  SELECT array_agg((e->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(p_updates) AS e;

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
  WHERE t.id = x.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- A série inteira (débito+crédito de cada parcela no escopo) precisa
  -- bater 100% — senão alguma perna ficaria desatualizada e divergente da
  -- sua parceira.
  IF v_count <> v_esperadas THEN
    RAISE EXCEPTION 'SERIE_INCOMPLETA: % de % transações da série estão no seu escopo — edição bloqueada para não quebrar o par.', v_count, v_esperadas;
  END IF;

  RETURN QUERY SELECT * FROM arqvalor.transacoes WHERE id = ANY(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_atualizar_transacoes_transferencia(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_atualizar_transacoes_transferencia(jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_transferencias(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_excluidas integer;
  v_esperadas integer := COALESCE(array_length(p_ids, 1), 0);
BEGIN
  UPDATE arqvalor.transacoes SET id_par_transferencia = NULL WHERE id = ANY(p_ids);
  DELETE FROM arqvalor.transacoes WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_excluidas = ROW_COUNT;

  IF v_excluidas <> v_esperadas THEN
    RAISE EXCEPTION 'PAR_INCOMPLETO: % de % transações do par/série estão no seu escopo — exclusão bloqueada para não quebrar o par.',
      v_excluidas, v_esperadas;
  END IF;

  RETURN v_excluidas;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_excluir_transferencias(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_excluir_transferencias(uuid[]) TO authenticated, service_role;
