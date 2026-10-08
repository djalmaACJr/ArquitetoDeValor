-- ============================================================
-- Lançamento SEM categoria não pode existir.
--
-- Até aqui transacoes.categoria_id era nullable (o drawer oferecia "Sem
-- categoria" e a API aceitava null). Agora o banco recusa qualquer INSERT/UPDATE
-- sem categoria, qualquer que seja a origem (API, importação, restore, RPC).
--
-- Não há backfill automático: se ainda existir lançamento órfão, a migration
-- para e lista quais são — categorize-os pelo Extrato e rode de novo.
-- Idempotente.
-- ============================================================

DO $$
DECLARE
  v_qtd    BIGINT;
  v_lista  TEXT;
BEGIN
  SELECT COUNT(*),
         string_agg(format('%s | %s | %s | %s', user_id, data, valor, descricao), E'\n')
    INTO v_qtd, v_lista
    FROM (
      SELECT user_id, data, valor, descricao
        FROM arqvalor.transacoes
       WHERE categoria_id IS NULL
       ORDER BY data
       LIMIT 50
    ) t;

  IF v_qtd > 0 THEN
    RAISE EXCEPTION E'Existem lançamentos sem categoria (user_id | data | valor | descrição). Categorize-os e rode de novo:\n%', v_lista;
  END IF;
END $$;

ALTER TABLE arqvalor.transacoes
  ALTER COLUMN categoria_id SET NOT NULL;
