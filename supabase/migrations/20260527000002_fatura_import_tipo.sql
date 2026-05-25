-- F2: adiciona campo `tipo` em arqvalor.fatura_import_item para distinguir
-- créditos (RECEITA — estornos, descontos de antecipação) de débitos
-- (DESPESA — compras normais). O valor permanece sempre positivo; o tipo
-- é que determina o sinal ao criar a transação em F3.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'arqvalor'
       AND table_name   = 'fatura_import_item'
       AND column_name  = 'tipo'
  ) THEN
    ALTER TABLE arqvalor.fatura_import_item
      ADD COLUMN tipo VARCHAR(10) NOT NULL DEFAULT 'DESPESA'
        CHECK (tipo IN ('RECEITA', 'DESPESA'));
  END IF;
END $$;
