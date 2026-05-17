-- Adiciona preferência de mascote do usuário.
-- Valores reconhecidos pelo frontend (ver FrontEnd/src/components/ui/Mascote.tsx):
--   'sabio'      Financial Advisor (padrão)
--   'engenheira' Structural Engineer
--   'mago'       Cat Wizard
--   'raposa'     Strategic Fox
--
-- O frontend renderiza os "dicas" contextuais (Dashboard, Comparativo, etc.)
-- com o mascote escolhido. Valores desconhecidos caem no padrão (sabio).

ALTER TABLE arqvalor.usuarios
  ADD COLUMN IF NOT EXISTS mascote_preferido TEXT NOT NULL DEFAULT 'sabio';
