-- ============================================================
-- usuarios.data_nascimento — data de nascimento do usuário.
--
-- Coletada na página de Perfil ("Dados pessoais") via input type="date"
-- (formato 'YYYY-MM-DD'). Serve para estimar a idade atual na tela de
-- Configurações de Investimentos (perfil do investidor), evitando que o
-- usuário precise atualizar a idade todo ano.
--
-- Lido/escrito direto via supabase client (exceção arqvalor.usuarios,
-- como PerfilPage / useUsuarioPerfil / useOcultarValores).
--
-- NULL = não informado.
-- ============================================================

ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS data_nascimento DATE;

COMMENT ON COLUMN arqvalor.usuarios.data_nascimento IS
    'Data de nascimento (YYYY-MM-DD). NULL = não informado. '
    'Usada para estimar a idade nas Configurações de Investimentos.';
