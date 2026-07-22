-- ============================================================
-- Operações multi-tabela atômicas — transações ↔ inv_dividendos
-- e exclusão de séries de transferência
--
-- Contexto (auditoria 2026-07-22): a Edge Function fazia escritas em duas
-- tabelas em passos separados com "compensação" manual em caso de erro:
--
--   • criar transação de provento: INSERT transacoes → INSERT inv_dividendos
--     → se o 2º falhar, DELETE compensatório da transação (que também pode
--     falhar, deixando transação órfã sem espelho);
--   • excluir transação: DELETE inv_dividendos → DELETE transacoes → se o
--     2º falhar, os dividendos já sumiram mas o lançamento continua;
--   • excluir série de transferência: UPDATE id_par_transferencia=NULL →
--     DELETE → se o DELETE falhar, sobram transações "des-pareadas" que o
--     app não reconhece mais como transferência (e escapam da proteção da
--     categoria).
--
-- Estas funções movem cada operação para UMA transação do Postgres: ou tudo
-- acontece, ou nada. A lógica de negócio permanece na Edge Function — aqui
-- só entra a escrita atômica.
--
-- SECURITY INVOKER de propósito: rodam com o papel do chamador (JWT via
-- db(req)), então RLS e triggers de isolamento continuam valendo.
--
-- Idempotente: CREATE OR REPLACE em tudo.
-- ============================================================

-- ── 1. fn_criar_transferencia — inclui `observacao` ─────────────────────────
-- A versão anterior não listava a coluna `observacao`, então a observação
-- digitada numa transferência era silenciosamente descartada no INSERT.
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
    observacao, id_par_transferencia, id_recorrencia, nr_parcela, total_parcelas, tipo_recorrencia
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
    NULLIF(x->>'observacao', ''),
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

-- ── 2. fn_criar_transacoes_com_dividendos ───────────────────────────────────
-- Insere transações (1..N parcelas) e, se `p_dividendo` vier preenchido,
-- espelha um inv_dividendos por transação — tudo na mesma transação do banco.
-- `p_dividendo`: { ativo_id, tipo_ativo, tipo_dividendo_id? } (dados do ativo;
-- valor/data/conta/descrição vêm de cada transação inserida).
CREATE OR REPLACE FUNCTION arqvalor.fn_criar_transacoes_com_dividendos(
  p_rows jsonb,
  p_dividendo jsonb DEFAULT NULL
)
RETURNS SETOF arqvalor.transacoes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  WITH inseridas AS (
    INSERT INTO arqvalor.transacoes (
      user_id, conta_id, categoria_id, data, descricao, valor, tipo, status,
      observacao, id_recorrencia, nr_parcela, total_parcelas, tipo_recorrencia
    )
    SELECT
      (x->>'user_id')::uuid,
      (x->>'conta_id')::uuid,
      NULLIF(x->>'categoria_id', '')::uuid,
      (x->>'data')::date,
      x->>'descricao',
      (x->>'valor')::numeric,
      (x->>'tipo')::arqvalor.tipo_transacao,
      (x->>'status')::arqvalor.status_transacao,
      NULLIF(x->>'observacao', ''),
      NULLIF(x->>'id_recorrencia', '')::uuid,
      NULLIF(x->>'nr_parcela', '')::int,
      NULLIF(x->>'total_parcelas', '')::int,
      NULLIF(x->>'tipo_recorrencia', '')::arqvalor.tipo_recorrencia
    FROM jsonb_array_elements(p_rows) AS x
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM inseridas;

  IF p_dividendo IS NOT NULL AND jsonb_typeof(p_dividendo) = 'object' THEN
    INSERT INTO arqvalor.inv_dividendos (
      user_id, ativo_id, conta_id, valor, data_pagamento, tipo_ativo,
      descricao, tipo_dividendo_id, transacao_extrato_id
    )
    SELECT
      t.user_id,
      (p_dividendo->>'ativo_id')::uuid,
      t.conta_id,
      t.valor,
      t.data,
      (p_dividendo->>'tipo_ativo')::arqvalor.tipo_ativo_inv,
      t.descricao,
      NULLIF(p_dividendo->>'tipo_dividendo_id', '')::uuid,
      t.id
    FROM arqvalor.transacoes t
    WHERE t.id = ANY(v_ids);
  END IF;

  RETURN QUERY
  SELECT * FROM arqvalor.transacoes WHERE id = ANY(v_ids)
  ORDER BY nr_parcela NULLS FIRST, data;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_criar_transacoes_com_dividendos(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_criar_transacoes_com_dividendos(jsonb, jsonb) TO authenticated, service_role;

-- ── 3. fn_excluir_transacoes_e_dividendos ───────────────────────────────────
-- Remove os inv_dividendos espelhados E as transações numa transação só.
-- (A FK transacao_extrato_id é ON DELETE SET NULL — deletar as transações
-- primeiro perderia a referência; deletar só os dividendos e falhar depois
-- deixava o extrato sem espelho. Aqui, ou ambos saem, ou nenhum.)
CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_transacoes_e_dividendos(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_excluidas integer;
BEGIN
  DELETE FROM arqvalor.inv_dividendos WHERE transacao_extrato_id = ANY(p_ids);
  DELETE FROM arqvalor.transacoes WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_excluidas = ROW_COUNT;
  RETURN v_excluidas;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_excluir_transacoes_e_dividendos(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_excluir_transacoes_e_dividendos(uuid[]) TO authenticated, service_role;

-- ── 4. fn_excluir_transferencias ────────────────────────────────────────────
-- Desarma o trigger de proteção (id_par_transferencia = NULL) e exclui as
-- transações do par/série na MESMA transação — impossível sobrar transação
-- "des-pareada" se o DELETE falhar (tudo volta, par intacto).
CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_transferencias(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_excluidas integer;
BEGIN
  UPDATE arqvalor.transacoes SET id_par_transferencia = NULL WHERE id = ANY(p_ids);
  DELETE FROM arqvalor.transacoes WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_excluidas = ROW_COUNT;
  RETURN v_excluidas;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_excluir_transferencias(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_excluir_transferencias(uuid[]) TO authenticated, service_role;
