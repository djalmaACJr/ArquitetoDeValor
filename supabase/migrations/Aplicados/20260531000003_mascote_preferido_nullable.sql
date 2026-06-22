-- Migration: mascote_preferido e layout viram NULLáveis (sem DEFAULT).
--
-- Motivação: a tela ApresentacaoMascotes (onboarding do 1º acesso) usa
-- a flag `primeiroAcesso = !mascote_preferido` do hook useMascotePreferido.
-- Com DEFAULT 'sabio' + NOT NULL, o INSERT da trigger fn_sincronizar_usuario
-- já preenchia o campo automaticamente, e o usuário novo nunca via a tela
-- de apresentação dos mentores — caía direto no Dashboard com o Sábio
-- como mentor padrão sem ter escolhido.
--
-- Após esta migration, usuários novos terão NULL nesses campos até passarem
-- pela onboarding, e o redirect funciona corretamente.
--
-- Idempotente.

-- ── mascote_preferido ────────────────────────────────────────
ALTER TABLE arqvalor.usuarios
  ALTER COLUMN mascote_preferido DROP NOT NULL;

ALTER TABLE arqvalor.usuarios
  ALTER COLUMN mascote_preferido DROP DEFAULT;

-- ── layout ──────────────────────────────────────────────────
-- Mesma motivação: até o usuário escolher um mentor (que define o layout),
-- o campo deveria ser NULL. O `useLayout` no front trata NULL como
-- "classico" pra exibição, mas grava o valor real só depois da escolha.
ALTER TABLE arqvalor.usuarios
  ALTER COLUMN layout DROP NOT NULL;

ALTER TABLE arqvalor.usuarios
  ALTER COLUMN layout DROP DEFAULT;

-- ── Atenção: dados existentes ───────────────────────────────
-- Esta migration NÃO mexe em registros já gravados. Se algum usuário
-- foi criado com o default automático mas nunca passou pelo onboarding,
-- ele continuará com 'sabio'/'classico' e a tela não vai aparecer pra ele.
-- Pra reativar a apresentação pra usuários nessa situação, rode manualmente:
--
--   UPDATE arqvalor.usuarios
--   SET mascote_preferido = NULL, layout = NULL
--   WHERE id = '<user_id>'
--     AND mascote_apelidos = '{}'::jsonb;   -- só se nunca deu apelido
