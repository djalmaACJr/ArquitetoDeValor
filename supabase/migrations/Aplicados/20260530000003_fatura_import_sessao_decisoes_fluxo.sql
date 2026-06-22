-- Migration: persiste as decisões de fluxo da sessão de importação
-- (modo de importação e flag de separar por cartão), para que o usuário
-- volte exatamente de onde parou — sem precisar re-decidir os
-- "menus iniciais" cada vez que reabre a tela de revisão.
--
-- - modo_importacao    : REGISTRO (1 lançamento por item) | CATEGORIA
--                        (1 lançamento por categoria). NULL = ainda não
--                        decidido (a UI mostra a tela de escolha).
-- - separar_por_cartao : só faz sentido em CATEGORIA. NULL = ainda
--                        não decidido (UI mostra a pergunta).
--
-- Idempotente.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'arqvalor'
       AND table_name   = 'fatura_import_sessao'
       AND column_name  = 'modo_importacao'
  ) THEN
    ALTER TABLE arqvalor.fatura_import_sessao
      ADD COLUMN modo_importacao VARCHAR(10) NULL
        CHECK (modo_importacao IS NULL OR modo_importacao IN ('REGISTRO','CATEGORIA'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'arqvalor'
       AND table_name   = 'fatura_import_sessao'
       AND column_name  = 'separar_por_cartao'
  ) THEN
    ALTER TABLE arqvalor.fatura_import_sessao
      ADD COLUMN separar_por_cartao BOOLEAN NULL;
  END IF;
END $$;
