-- ============================================================
-- inv_avaliacoes.historico — histórico das avaliações de cada ativo.
--
-- A linha de inv_avaliacoes guarda a avaliação ATUAL (1 por ativo). Para
-- acompanhar a evolução da nota entre reavaliações, mantemos um histórico
-- como array JSONB na própria linha (evita tabela separada e já entra no
-- backup junto com inv_avaliacoes). Cada item:
--   { "gerado_em": "2026-06-18T...", "nota_final": 7.4,
--     "criterios": { "FUNDAMENTOS": 7.1, ... } }
-- Mantém-se no máximo os 24 registros mais recentes (ordem cronológica;
-- o último é a avaliação atual). A partir do penúltimo × último o
-- frontend indica se o ativo subiu, desceu ou manteve a nota.
-- ============================================================

ALTER TABLE arqvalor.inv_avaliacoes
    ADD COLUMN IF NOT EXISTS historico JSONB;

COMMENT ON COLUMN arqvalor.inv_avaliacoes.historico IS
    'Histórico cronológico das avaliações do ativo (array JSONB, últimas 24). '
    'O último item é a avaliação atual; serve para indicar subiu/desceu/manteve.';

-- ============================================================
-- usuarios.inv_avaliacao_agenda — agenda de reavaliação da carteira,
-- definida pelo usuário. A reavaliação roda no navegador (orquestra os
-- mentores), então isto é uma PREFERÊNCIA: define a frequência e o app
-- mostra a próxima data e avisa quando está vencida.
--
-- Formato (JSONB):
--   { "frequencia": "MENSAL" }   -- NENHUMA | SEMANAL | QUINZENAL |
--                                   MENSAL | TRIMESTRAL | SEMESTRAL | ANUAL
--   NULL = sem agenda definida.
-- ============================================================

ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS inv_avaliacao_agenda JSONB;

COMMENT ON COLUMN arqvalor.usuarios.inv_avaliacao_agenda IS
    'Agenda de reavaliação da carteira definida pelo usuário '
    '({ frequencia }); o app deriva a próxima data e avisa quando vencida.';
