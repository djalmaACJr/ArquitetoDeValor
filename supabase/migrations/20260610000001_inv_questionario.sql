-- ============================================================
-- Investimentos — Questionário de avaliação do ativo
--
-- Guarda as respostas do questionário por ativo. A nota
-- (inv_ativos.nota_usuario) é derivada das respostas no frontend
-- (definições das perguntas em FrontEnd/src/lib/questionarioAtivos.ts)
-- e persistida junto; as respostas ficam aqui para reabrir/editar
-- a avaliação e recalcular quando o questionário evoluir.
--
-- Formato: { "<pergunta_id>": <indice_da_opcao 0..4>, ... }
-- ============================================================

ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS questionario_respostas JSONB;

COMMENT ON COLUMN arqvalor.inv_ativos.questionario_respostas IS
    'Respostas do questionário de avaliação ({pergunta_id: indice 0..4}). Nota derivada em nota_usuario.';
