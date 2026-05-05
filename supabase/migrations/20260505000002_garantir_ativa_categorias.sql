-- Garante que a coluna `ativa` existe na tabela categorias.
-- Idempotente: ADD COLUMN IF NOT EXISTS não falha se já existir.
-- A coluna já estava na migration original (20260403000001), mas esta
-- migration serve de segurança para bancos criados antes dessa versão.

ALTER TABLE arqvalor.categorias
    ADD COLUMN IF NOT EXISTS ativa BOOLEAN NOT NULL DEFAULT TRUE;

-- Índice composto para queries filtradas por usuário + status
CREATE INDEX IF NOT EXISTS idx_categorias_ativa
    ON arqvalor.categorias (user_id, ativa);

-- Garante que nenhuma categoria existente fique com ativa = NULL
UPDATE arqvalor.categorias SET ativa = TRUE WHERE ativa IS NULL;
