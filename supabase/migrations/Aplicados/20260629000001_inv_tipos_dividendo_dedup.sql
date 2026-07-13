-- ============================================================
-- Investimentos — dedup de inv_tipos_dividendo (tipos de provento)
--
-- Surgiram tipos DUPLICADOS por nome (ex.: 3× "Aluguel de FII"), sendo só um
-- mapeado a uma categoria. A provisão de proventos resolve o tipo por NOME;
-- com duplicatas, podia escolher a versão NÃO mapeada e PULAR o provento
-- (FIIs sumindo da agenda). Esta migration:
--   1) Mantém 1 linha por (user_id, nome) — prioriza a que TEM categoria;
--   2) Remapeia inv_dividendos das duplicatas para a mantida;
--   3) Apaga as duplicatas;
--   4) Cria UNIQUE (user_id, nome) para não voltar a duplicar.
--
-- Idempotente: sem duplicatas, o loop não faz nada; constraint via DO/EXCEPTION.
-- ============================================================

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT user_id, nome,
           (array_agg(id ORDER BY (categoria_id IS NOT NULL) DESC, created_at ASC))[1] AS keep_id,
           array_agg(id) AS all_ids
    FROM arqvalor.inv_tipos_dividendo
    GROUP BY user_id, nome
    HAVING count(*) > 1
  LOOP
    -- Remapeia os proventos das duplicatas para a linha mantida.
    UPDATE arqvalor.inv_dividendos
       SET tipo_dividendo_id = r.keep_id
     WHERE tipo_dividendo_id = ANY(r.all_ids)
       AND tipo_dividendo_id <> r.keep_id;
    -- Remove as duplicatas (mantém keep_id).
    DELETE FROM arqvalor.inv_tipos_dividendo
     WHERE id = ANY(r.all_ids)
       AND id <> r.keep_id;
  END LOOP;
END $$;

-- Impede novas duplicatas por (user_id, nome).
DO $$ BEGIN
  ALTER TABLE arqvalor.inv_tipos_dividendo
    ADD CONSTRAINT uq_inv_tipos_dividendo_user_nome UNIQUE (user_id, nome);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
