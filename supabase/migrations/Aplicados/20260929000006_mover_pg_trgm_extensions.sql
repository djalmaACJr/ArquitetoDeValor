-- ============================================================
-- Security Advisor — move pg_trgm de `public` pra `extensions`
-- ============================================================
-- pg_trgm (usado só pelo índice trigram de busca do Assistente,
-- idx_assistente_user_descricao_trgm) é uma extensão RELOCATABLE — seus
-- operadores (%, <->) e funções (similarity() etc.) continuam resolvendo
-- normalmente depois de mover, porque o Postgres busca por schema no
-- search_path, não pelo schema em que a extensão foi originalmente
-- instalada. Sem risco pros índices/queries existentes.
--
-- pg_net NÃO foi movido nesta migration — decisão consciente, dado o
-- risco maior (8 cron jobs de produção dependem dele) sem confirmação
-- explícita antes de mexer.
--
-- Idempotente.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION pg_trgm SET SCHEMA extensions;
