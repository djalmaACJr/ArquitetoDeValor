-- ============================================================
-- Assistente de lançamentos — índice trigram de verdade para ILIKE '%termo%'
--
-- `idx_assistente_user_descricao_trgm` (criada em 20260511000002) é, apesar
-- do nome, um índice B-tree comum em (user_id, lower(descricao)) — idêntico
-- ao unique index `uq_assistente_user_descricao` já existente na mesma
-- expressão. B-tree não acelera `ILIKE '%termo%'` (wildcard nos dois lados);
-- só ajuda prefixo (`LIKE 'termo%'`). A rota real (GET /assistente?q=, em
-- supabase/functions/assistente/index.ts) faz exatamente
-- `.ilike("descricao", \`%${termo}%\`)` — o índice antigo não cumpria a
-- função que o nome prometia, e ainda duplicava o unique index acima
-- (achado de auditoria).
--
-- Esta migration troca pelo índice GIN trigram real (requer pg_trgm) sobre
-- lower(descricao) — este sim acelera substring match — e remove o B-tree
-- duplicado.
--
-- Idempotente: CREATE EXTENSION/INDEX IF NOT EXISTS, DROP INDEX IF EXISTS.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS arqvalor.idx_assistente_user_descricao_trgm;

CREATE INDEX IF NOT EXISTS idx_assistente_user_descricao_trgm
  ON arqvalor.assistente_lancamentos
  USING gin (lower(descricao) gin_trgm_ops);
