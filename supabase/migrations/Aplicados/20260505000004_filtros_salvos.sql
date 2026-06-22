-- Tabela de filtros salvos pelo usuário por página
DO $$ BEGIN

  CREATE TABLE IF NOT EXISTS arqvalor.filtros_salvos (
    id        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pagina    TEXT        NOT NULL,
    nome      TEXT        NOT NULL,
    dados     JSONB       NOT NULL DEFAULT '{}',
    criado_em TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_filtros_nome   CHECK (length(trim(nome))   > 0),
    CONSTRAINT chk_filtros_pagina CHECK (length(trim(pagina)) > 0)
  );

EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- RLS
ALTER TABLE arqvalor.filtros_salvos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY filtros_salvos_usuario ON arqvalor.filtros_salvos
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index para busca por usuário + página
CREATE INDEX IF NOT EXISTS idx_filtros_salvos_user_pagina
  ON arqvalor.filtros_salvos(user_id, pagina);

-- Grants
GRANT SELECT, INSERT, DELETE ON arqvalor.filtros_salvos TO anon, authenticated;
