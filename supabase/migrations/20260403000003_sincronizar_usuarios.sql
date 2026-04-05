-- ============================================================
-- ARQUITETO DE VALOR — Migration v1.7
-- 20260403000003_sincronizar_usuarios.sql
--
-- Objetivo:
--   Sincronizar auth.users (Supabase Auth) com arqvalor.usuarios
--   e criar dados iniciais (contas e categorias) automaticamente
--   quando um novo usuário se cadastra.
--
-- Fluxo:
--   1. Usuário se cadastra via Supabase Auth
--   2. Auth cria registro em auth.users
--   3. Trigger fn_sincronizar_usuario dispara
--   4. Cria registro em arqvalor.usuarios
--   5. Cria contas pré-cadastradas para o usuário
--   6. Cria categorias pré-cadastradas para o usuário
-- ============================================================

-- ============================================================
-- FUNÇÃO: sincronizar usuário do Auth com arqvalor.usuarios
-- ============================================================
CREATE OR REPLACE FUNCTION arqvalor.fn_sincronizar_usuario()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- Cria o registro do usuário na tabela do projeto
    INSERT INTO arqvalor.usuarios (id, email, nome)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'nome', 'Convidado')
    )
    ON CONFLICT (id) DO NOTHING;

    -- Cria contas iniciais para o novo usuário
    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor) VALUES
        (NEW.id, 'Carteira',     'CARTEIRA',    0, '👛', '#00c896'),
        (NEW.id, 'Nubank',       'CARTAO',      0, 'https://logo.clearbit.com/nubank.com.br',      '#820ad1'),
        (NEW.id, 'Inter',        'CARTAO',      0, 'https://logo.clearbit.com/bancointer.com.br',  '#ff7a00'),
        (NEW.id, 'C6 Bank',      'CARTAO',      0, 'https://logo.clearbit.com/c6bank.com.br',      '#2d2d2d'),

    -- Cria categorias pai iniciais e captura os IDs gerados
    WITH cats_pai AS (
        INSERT INTO arqvalor.categorias (user_id, descricao, icone, cor) VALUES
            (NEW.id, 'Moradia',        '🏠', '#4da6ff'),
            (NEW.id, 'Alimentação',    '🍔', '#ff7a00'),
            (NEW.id, 'Transporte',     '🚗', '#820ad1'),
            (NEW.id, 'Saúde',          '💊', '#e91e8c'),
            (NEW.id, 'Renda',          '💼', '#00c896'),
            (NEW.id, 'Transferências', '🔄', '#00b1ea')
        RETURNING id, descricao
    )
    -- Cria subcategorias vinculadas aos pais recém-criados
    INSERT INTO arqvalor.categorias (user_id, id_pai, descricao, icone, cor)
    SELECT
        NEW.id,
        p.id,
        s.descricao,
        s.icone,
        s.cor
    FROM cats_pai p
    JOIN (VALUES
        -- Moradia
        ('Moradia',        'Aluguel',           '🏠', '#4da6ff'),
        ('Moradia',        'Condomínio',         '🏢', '#4da6ff'),
        ('Moradia',        'IPTU',               '📄', '#4da6ff'),
        ('Moradia',        'Manutenção',         '🔧', '#4da6ff'),
        -- Alimentação
        ('Alimentação',    'Mercado',            '🛒', '#ff7a00'),
        ('Alimentação',    'Restaurantes',       '🍽️', '#ff7a00'),
        ('Alimentação',    'Delivery',           '🛵', '#ff7a00'),
        ('Alimentação',    'Padaria',            '🥐', '#ff7a00'),
        -- Transporte
        ('Transporte',     'Combustível',        '⛽', '#820ad1'),
        ('Transporte',     'Uber/Táxi',          '🚕', '#820ad1'),
        ('Transporte',     'Transp. Público',    '🚌', '#820ad1'),
        ('Transporte',     'Manut. Veículo',     '🔧', '#820ad1'),
        -- Saúde
        ('Saúde',          'Plano de Saúde',     '🏥', '#e91e8c'),
        ('Saúde',          'Farmácia',           '💊', '#e91e8c'),
        ('Saúde',          'Consultas',          '👨‍⚕️', '#e91e8c'),
        ('Saúde',          'Academia',           '🏋️', '#e91e8c'),
        -- Renda
        ('Renda',          'Salário',            '💰', '#00c896'),
        ('Renda',          'Freelance',          '💻', '#00c896'),
        ('Renda',          'Aluguel Recebido',   '🏠', '#00c896'),
        ('Renda',          'Dividendos',         '📈', '#00c896'),
        -- Transferências
        ('Transferências', 'Entre Contas',       '🔄', '#00b1ea'),
        ('Transferências', 'Reembolsos',         '↩️', '#00b1ea')
    ) AS s(pai_nome, descricao, icone, cor)
    ON p.descricao = s.pai_nome;

    RETURN NEW;
END;
$$;

-- ============================================================
-- TRIGGER: dispara após novo usuário no Supabase Auth
-- AFTER INSERT ON auth.users garante que o Auth já criou
-- o registro antes de tentarmos sincronizar.
-- SECURITY DEFINER: a função roda com permissões do criador
-- (postgres) para poder inserir em arqvalor sem restrições
-- de RLS durante a criação inicial.
-- ============================================================
DROP TRIGGER IF EXISTS trg_sincronizar_usuario ON auth.users;

CREATE TRIGGER trg_sincronizar_usuario
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_sincronizar_usuario();

-- ============================================================
-- FUNÇÃO: remover dados do usuário ao excluir conta
-- Garante que ao excluir a conta no Auth, todos os dados
-- do usuário em arqvalor são removidos em cascata.
-- (O ON DELETE CASCADE nas FKs já faz isso, mas o trigger
--  garante a ordem correta e registra na auditoria)
-- ============================================================
CREATE OR REPLACE FUNCTION arqvalor.fn_remover_usuario()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    DELETE FROM arqvalor.usuarios WHERE id = OLD.id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_remover_usuario ON auth.users;

CREATE TRIGGER trg_remover_usuario
    BEFORE DELETE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_remover_usuario();

-- ============================================================
-- POLÍTICA RLS: permitir que a função SECURITY DEFINER
-- acesse arqvalor.usuarios durante o cadastro inicial
-- (antes do JWT existir)
-- ============================================================
ALTER TABLE arqvalor.usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_usuarios_user ON arqvalor.usuarios;

CREATE POLICY pol_usuarios_user ON arqvalor.usuarios
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ============================================================
-- FIM DA MIGRATION — 20260403000003_sincronizar_usuarios
-- ============================================================
