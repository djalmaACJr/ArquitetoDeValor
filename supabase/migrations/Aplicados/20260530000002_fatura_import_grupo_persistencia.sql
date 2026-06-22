-- Migration: persistência do estado de grupos no modo CATEGORIA da
-- importação de fatura. Permite que o usuário pause a revisão e retorne
-- depois sem perder separações, vínculos manuais e descrições customizadas.
--
-- - grupo_chave        : identifica grupos separados manualmente. Quando
--                        NULL, o item pertence ao grupo "default" da sua
--                        categoria_escolhida_id (legado).
-- - descricao_override : descrição customizada (no modo REGISTRO, por item;
--                        no modo CATEGORIA, replicada nos itens do grupo).
--                        NULL = usa a descrição original do PDF.
--
-- Idempotente.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'arqvalor'
       AND table_name   = 'fatura_import_item'
       AND column_name  = 'grupo_chave'
  ) THEN
    ALTER TABLE arqvalor.fatura_import_item
      ADD COLUMN grupo_chave TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'arqvalor'
       AND table_name   = 'fatura_import_item'
       AND column_name  = 'descricao_override'
  ) THEN
    ALTER TABLE arqvalor.fatura_import_item
      ADD COLUMN descricao_override TEXT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fatura_import_item_grupo
  ON arqvalor.fatura_import_item(sessao_id, grupo_chave)
  WHERE grupo_chave IS NOT NULL;
