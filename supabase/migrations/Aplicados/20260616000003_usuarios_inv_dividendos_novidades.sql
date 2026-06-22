-- ============================================================
-- usuarios.inv_dividendos_novidades — resumo do que o job de proventos
-- BRL (dividendos-cron-br) criou/atualizou desde a última vez que o
-- usuário viu. Exibido UMA vez no login; ao fechar, o frontend zera
-- (set NULL). O cron só grava quando há mudança e MESCLA com novidades
-- ainda não vistas (não perde nada se o usuário ficou dias sem logar).
--
-- Diferente de inv_dividendos_avisos (pendências de mapeamento, que são
-- auto-reparadas): aqui é notificação transitória, descartada na visualização.
--
-- Formato (JSONB):
--   {
--     "gerado_em": "2026-06-16T09:35:00.000Z",
--     "criados": 3,
--     "atualizados": 2,
--     "itens": [
--       { "ticker": "HGLG11", "tipo": "Aluguel de FII",
--         "data_pagamento": "2026-07-15", "valor": 110.00, "acao": "criado" }
--     ]
--   }
--   NULL = nada novo a exibir.
-- ============================================================

ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS inv_dividendos_novidades JSONB;

COMMENT ON COLUMN arqvalor.usuarios.inv_dividendos_novidades IS
    'Resumo de proventos criados/atualizados pelo job BRL para exibir no '
    'login. Descartado (NULL) quando o usuário visualiza.';
