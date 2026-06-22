-- ============================================================
-- usuarios.inv_perfil — perfil de investidor do usuário.
--
-- Alimenta a tela de Configurações de Investimentos: define o perfil
-- (CONSERVADOR | MODERADO | ARROJADO), idade e idade de aposentadoria,
-- além das respostas do mini-questionário de risco (suitability) que
-- derivou o perfil. Usado também pelo backend ao gerar o questionário
-- de avaliação por IA (contextualiza pesos sugeridos por perfil).
--
-- Lido/escrito direto via supabase client (exceção arqvalor.usuarios,
-- como PerfilPage / useOcultarValores). O backend lê via db(req).
--
-- Formato (JSONB):
--   {
--     "perfil": "MODERADO",
--     "idade": 38,
--     "idade_aposentadoria": 60,
--     "suitability": { "<pergunta_id>": <indice 0..4>, ... },
--     "atualizado_em": "2026-06-16T09:35:00.000Z"
--   }
--   NULL = perfil ainda não configurado.
-- ============================================================

ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS inv_perfil JSONB;

COMMENT ON COLUMN arqvalor.usuarios.inv_perfil IS
    'Perfil de investidor (perfil, idade, idade_aposentadoria, suitability). '
    'NULL = não configurado. Usado nas Configurações de Investimentos.';
