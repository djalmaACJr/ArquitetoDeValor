ALTER TABLE arqvalor.usuarios
  ADD COLUMN IF NOT EXISTS ocultar_valores BOOLEAN NOT NULL DEFAULT false;
