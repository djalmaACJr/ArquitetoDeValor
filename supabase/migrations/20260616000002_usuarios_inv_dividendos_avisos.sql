-- ============================================================
-- usuarios.inv_dividendos_avisos — avisos do job de proventos BRL
-- (dividendos-cron-br) sobre papéis cujo provento NÃO foi provisionado
-- por falta de mapeamento tipo → categoria.
--
-- É estado TRANSITÓRIO e auto-regenerado a cada execução do cron
-- (self-healing): quando o usuário mapeia a categoria do tipo, a próxima
-- execução limpa o aviso. Por isso fica em `usuarios` (lido direto pelo
-- frontend, mesmo padrão de ocultar_valores/ia_configs) e NÃO em tabela
-- de domínio — também não entra em backup/restore.
--
-- Formato (JSONB):
--   {
--     "atualizado_em": "2026-06-16",
--     "tipos": [
--       { "tipo": "JSCP", "motivo": "sem_categoria",
--         "tickers": ["ITSA4", "BBAS3"] },
--       { "tipo": "Aluguel de FII", "motivo": "tipo_inexistente",
--         "tickers": ["HGLG11"] }
--     ]
--   }
--   NULL = nenhum aviso pendente.
--   motivo: "sem_categoria" (tipo existe, categoria_id NULL)
--         | "tipo_inexistente" (usuário excluiu o tipo padrão).
-- ============================================================

ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS inv_dividendos_avisos JSONB;

COMMENT ON COLUMN arqvalor.usuarios.inv_dividendos_avisos IS
    'Avisos do job de proventos BRL: tipos sem mapeamento que impediram o '
    'provisionamento. Auto-regenerado pelo cron; NULL = sem pendências.';
