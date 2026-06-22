-- Adiciona preferência de layout/tema escolhido pelo usuário.
-- Valores reconhecidos pelo frontend (ver FrontEnd/src/lib/themes.ts):
--   'classico'   (padrão — escuro, identidade original do app)
--   'claro'      tema claro
--   'sabio'      tema marrom vintage (mascote Sábio)
--   'engenheira' tema blueprint azul (mascote Engenheira)
--   'mago'       tema roxo místico (mascote Mago Gato)
--   'raposa'     tema laranja estratégico (mascote Raposa)
--
-- Valores antigos ('midnight' / 'sepia') também são aceitos pelo frontend
-- para usuários que já selecionaram; em caso de string desconhecida o app
-- cai no padrão silenciosamente.

ALTER TABLE arqvalor.usuarios
  ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT 'classico';
