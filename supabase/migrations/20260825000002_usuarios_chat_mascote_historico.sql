-- ============================================================
-- arqvalor.usuarios.chat_mascote_historico — histórico da conversa com o
-- mentor de IA (useChatMascote), movido de localStorage pro banco a pedido
-- do usuário (mitiga vazamento por acesso físico/malware no aparelho, ao
-- custo de virar mais uma coisa exposta em caso de bug de RLS/service_role
-- — trade-off consciente, decidido em conversa).
--
-- JSONB: array de { role, content, ts } — no máximo 60 mensagens (teto
-- aplicado no client, useChatMascote.ts). Mesma natureza/exceção de acesso
-- de mascote_preferido/layout/ordem_quadros — lido/escrito direto pelo
-- client (Supabase JS), sem Edge Function; RLS de `usuarios` já cobre.
-- NÃO entra em backup/restore (mesmo padrão das demais colunas de
-- preferência dessa tabela — não é dado financeiro).
--
-- Expira no client após 24h sem mensagem nova (mesma regra de antes, agora
-- também limpa a linha no banco quando detectada expirada — ver
-- useChatMascote.ts).
-- ============================================================

ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS chat_mascote_historico JSONB NOT NULL DEFAULT '[]'::jsonb;
