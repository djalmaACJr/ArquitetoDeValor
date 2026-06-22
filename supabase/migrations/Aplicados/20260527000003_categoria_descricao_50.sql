-- Migration: aumentar limite de descricao de categorias de 20 para 50 caracteres
-- Idempotente: usa DO/EXCEPTION para não falhar se constraint já foi removida.

DO $$
BEGIN
  -- Remove a constraint de check antiga (se existir)
  ALTER TABLE arqvalor.categorias
    DROP CONSTRAINT IF EXISTS categorias_descricao_check;
EXCEPTION WHEN OTHERS THEN
  -- Ignora se não existir com esse nome exato
END;
$$;

-- Adiciona (ou substitui) a constraint com o novo limite de 50
DO $$
BEGIN
  -- Tenta remover variações de nome geradas automaticamente pelo Postgres
  ALTER TABLE arqvalor.categorias
    DROP CONSTRAINT IF EXISTS "categorias_descricao_check";
  ALTER TABLE arqvalor.categorias
    DROP CONSTRAINT IF EXISTS "categorias_descricao_check1";
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- Remove a constraint via busca no catálogo (cobre qualquer nome auto-gerado)
DO $$
DECLARE
  v_constr TEXT;
BEGIN
  SELECT conname INTO v_constr
  FROM pg_constraint
  WHERE conrelid = 'arqvalor.categorias'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) LIKE '%descricao%';

  IF v_constr IS NOT NULL THEN
    EXECUTE format('ALTER TABLE arqvalor.categorias DROP CONSTRAINT IF EXISTS %I', v_constr);
  END IF;
END;
$$;

-- Adiciona nova constraint com limite de 50
ALTER TABLE arqvalor.categorias
  ADD CONSTRAINT categorias_descricao_len
  CHECK (char_length(descricao) BETWEEN 1 AND 50)
  NOT VALID;

-- Valida retroativamente (não deve falhar — dados existentes já têm ≤ 20 chars)
ALTER TABLE arqvalor.categorias
  VALIDATE CONSTRAINT categorias_descricao_len;
