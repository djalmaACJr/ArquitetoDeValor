-- ============================================================
-- ARQUITETO DE VALOR — Migration v1.9
-- 20260429000006_excluir_conta_usuario.sql
--
-- Objetivo:
--   1. fn_excluir_dados_usuario  — exclui todos os dados de um
--      usuário bypassando triggers via session_replication_role.
--      Chamada pela Edge Function excluir_conta.
--
--   2. Corrige fn_sincronizar_usuario para marcar a categoria
--      "Transferências" com protegida = TRUE ao criar usuário.
-- ============================================================


-- ============================================================
-- 1. FUNÇÃO: excluir todos os dados do usuário
--    SECURITY DEFINER → roda como postgres (superuser)
--    SET LOCAL session_replication_role = replica → bypassa
--    todos os triggers e FKs para garantir a limpeza completa
-- ============================================================
CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_dados_usuario(p_user_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Bypassa triggers e FK constraints (requer superuser = postgres SECURITY DEFINER)
  SET LOCAL session_replication_role = replica;

  DELETE FROM arqvalor.transacoes WHERE user_id = p_user_id;
  DELETE FROM arqvalor.categorias  WHERE user_id = p_user_id;
  DELETE FROM arqvalor.contas      WHERE user_id = p_user_id;
  DELETE FROM arqvalor.usuarios    WHERE id      = p_user_id;

  -- Restaura ao fim da transação (SET LOCAL garante isso automaticamente)
END;
$$;

GRANT EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID)
  TO anon, authenticated, service_role;


-- ============================================================
-- 2. CORRIGE fn_sincronizar_usuario
--    Marca "Transferências" como protegida = TRUE no seed
-- ============================================================
CREATE OR REPLACE FUNCTION arqvalor.fn_sincronizar_usuario()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO arqvalor.usuarios (id, email, nome)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'nome', 'Convidado')
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor) VALUES
        (NEW.id, 'Carteira', 'CARTEIRA', 0, '👛',                                              '#00c896'),
        (NEW.id, 'Nubank',   'CARTAO',   0, 'https://logo.clearbit.com/nubank.com.br',         '#820ad1'),
        (NEW.id, 'Inter',    'CARTAO',   0, 'https://logo.clearbit.com/bancointer.com.br',      '#ff7a00'),
        (NEW.id, 'C6 Bank',  'CARTAO',   0, 'https://logo.clearbit.com/c6bank.com.br',          '#2d2d2d');

    WITH cats_pai AS (
        INSERT INTO arqvalor.categorias (user_id, descricao, icone, cor, protegida) VALUES
            (NEW.id, 'Moradia',        '🏠', '#4da6ff', FALSE),
            (NEW.id, 'Alimentação',    '🍔', '#ff7a00', FALSE),
            (NEW.id, 'Transporte',     '🚗', '#820ad1', FALSE),
            (NEW.id, 'Saúde',          '💊', '#e91e8c', FALSE),
            (NEW.id, 'Renda',          '💼', '#00c896', FALSE),
            (NEW.id, 'Transferências', '🔄', '#00b1ea', TRUE)
        RETURNING id, descricao
    )
    INSERT INTO arqvalor.categorias (user_id, id_pai, descricao, icone, cor, protegida)
    SELECT NEW.id, p.id, s.descricao, s.icone, s.cor, FALSE
    FROM cats_pai p
    JOIN (VALUES
        ('Moradia',        'Aluguel',           '🏠', '#4da6ff'),
        ('Moradia',        'Condomínio',         '🏢', '#4da6ff'),
        ('Moradia',        'IPTU',               '📄', '#4da6ff'),
        ('Moradia',        'Manutenção',         '🔧', '#4da6ff'),
        ('Alimentação',    'Mercado',            '🛒', '#ff7a00'),
        ('Alimentação',    'Restaurantes',       '🍽️', '#ff7a00'),
        ('Alimentação',    'Delivery',           '🛵', '#ff7a00'),
        ('Alimentação',    'Padaria',            '🥐', '#ff7a00'),
        ('Transporte',     'Combustível',        '⛽', '#820ad1'),
        ('Transporte',     'Uber/Táxi',          '🚕', '#820ad1'),
        ('Transporte',     'Transp. Público',    '🚌', '#820ad1'),
        ('Transporte',     'Manut. Veículo',     '🔧', '#820ad1'),
        ('Saúde',          'Plano de Saúde',     '🏥', '#e91e8c'),
        ('Saúde',          'Farmácia',           '💊', '#e91e8c'),
        ('Saúde',          'Consultas',          '👨‍⚕️', '#e91e8c'),
        ('Saúde',          'Academia',           '🏋️', '#e91e8c'),
        ('Renda',          'Salário',            '💰', '#00c896'),
        ('Renda',          'Freelance',          '💻', '#00c896'),
        ('Renda',          'Aluguel Recebido',   '🏠', '#00c896'),
        ('Renda',          'Dividendos',         '📈', '#00c896'),
        ('Transferências', 'Entre Contas',       '🔄', '#00b1ea'),
        ('Transferências', 'Reembolsos',         '↩️', '#00b1ea')
    ) AS s(pai_nome, descricao, icone, cor)
    ON p.descricao = s.pai_nome;

    RETURN NEW;
END;
$$;

-- ============================================================
-- FIM DA MIGRATION — 20260429000006_excluir_conta_usuario
-- ============================================================
