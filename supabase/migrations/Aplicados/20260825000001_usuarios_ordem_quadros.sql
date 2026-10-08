-- ============================================================
-- arqvalor.usuarios.ordem_quadros — preferência de ORDEM dos quadros
-- arrastáveis (Painel de Investimentos "Por tipo de ativo", Destaques
-- "quadros gerais" e "Por tipo de ativo").
--
-- JSONB { "<chave-da-lista>": ["chave1", "chave2", ...] }, uma entrada por
-- lista reordenável independente. Mesma natureza/exceção de acesso de
-- mascote_preferido/layout/ocultar_valores — preferência de UI lida/escrita
-- direto pelo client (Supabase JS), sem Edge Function; RLS de `usuarios` já
-- cobre. NÃO entra em backup/restore (mesmo padrão das demais colunas de
-- preferência dessa tabela).
-- ============================================================

ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS ordem_quadros JSONB NOT NULL DEFAULT '{}'::jsonb;
