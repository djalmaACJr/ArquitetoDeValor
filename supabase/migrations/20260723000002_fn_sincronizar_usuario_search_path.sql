-- ============================================================
-- Hardening (Security Advisor "Function Search Path Mutable"):
-- fn_sincronizar_usuario é SECURITY DEFINER mas não tinha
-- search_path fixo — único achado real que sobrou depois da
-- varredura completa de 20260709000001_hardening_advisors_supabase.sql.
-- Só adiciona o SET search_path, sem mudar nenhum comportamento.
-- Idempotente (CREATE OR REPLACE mantém corpo idêntico).
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_sincronizar_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $function$
DECLARE
    v_carteira   UUID;
    v_nubank     UUID;
    v_inter      UUID;

    v_cat_salario      UUID;
    v_cat_mercado      UUID;
    v_cat_restaurantes UUID;
    v_cat_combustivel  UUID;
    v_cat_farmacia     UUID;
    v_cat_aluguel      UUID;
    v_cat_academia     UUID;
    v_cat_transf       UUID;

    v_mes_atual  DATE := date_trunc('month', CURRENT_DATE)::date;
    v_mes_ant    DATE := (date_trunc('month', CURRENT_DATE) - interval '1 month')::date;
    v_par        UUID := gen_random_uuid();

    -- Lançamentos do mês corrente com dia ainda por vir ficam PENDENTE
    v_status_salario arqvalor.status_transacao;
    v_status_aluguel arqvalor.status_transacao;
BEGIN
    INSERT INTO arqvalor.usuarios (id, email, nome)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'nome', 'Convidado')
    )
    ON CONFLICT (id) DO NOTHING;

    -- ── Contas iniciais (capturando os IDs usados nos exemplos) ──
    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor)
    VALUES (NEW.id, 'Carteira', 'CARTEIRA', 0, '👛', '#00c896')
    RETURNING id INTO v_carteira;

    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor)
    VALUES (NEW.id, 'Nubank', 'CARTAO', 0, 'https://logo.clearbit.com/nubank.com.br', '#820ad1')
    RETURNING id INTO v_nubank;

    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor)
    VALUES (NEW.id, 'Inter', 'CARTAO', 0, 'https://logo.clearbit.com/bancointer.com.br', '#ff7a00')
    RETURNING id INTO v_inter;

    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor)
    VALUES (NEW.id, 'C6 Bank', 'CARTAO', 0, 'https://logo.clearbit.com/c6bank.com.br', '#2d2d2d');

    -- ── Categorias (pais + subcategorias) ──
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
        ('Renda',          'Dividendos',         '📈', '#00c896')
    ) AS s(pai_nome, descricao, icone, cor)
    ON p.descricao = s.pai_nome;

    -- ── IDs das categorias usadas nos lançamentos de exemplo ──
    SELECT id INTO v_cat_salario      FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Salário';
    SELECT id INTO v_cat_mercado      FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Mercado';
    SELECT id INTO v_cat_restaurantes FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Restaurantes';
    SELECT id INTO v_cat_combustivel  FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Combustível';
    SELECT id INTO v_cat_farmacia     FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Farmácia';
    SELECT id INTO v_cat_aluguel      FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Aluguel';
    SELECT id INTO v_cat_academia     FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Academia';
    SELECT id INTO v_cat_transf       FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Transferências' AND id_pai IS NULL;

    v_status_salario := CASE WHEN v_mes_atual + 4 <= CURRENT_DATE THEN 'PAGO' ELSE 'PENDENTE' END;
    v_status_aluguel := CASE WHEN v_mes_atual + 9 <= CURRENT_DATE THEN 'PAGO' ELSE 'PENDENTE' END;

    -- ── Transações de exemplo (mês anterior + mês atual) ──
    INSERT INTO arqvalor.transacoes (user_id, conta_id, categoria_id, data, descricao, valor, tipo, status) VALUES
        -- Mês anterior
        (NEW.id, v_carteira, v_cat_salario,      v_mes_ant + 4,      'Salário (exemplo)',              4850.00, 'RECEITA', 'PAGO'),
        (NEW.id, v_carteira, v_cat_aluguel,      v_mes_ant + 9,      'Aluguel (exemplo)',              1500.00, 'DESPESA', 'PAGO'),
        (NEW.id, v_inter,    v_cat_academia,     v_mes_ant + 9,      'Academia (exemplo)',              119.90, 'DESPESA', 'PAGO'),
        (NEW.id, v_nubank,   v_cat_farmacia,     v_mes_ant + 14,     'Farmácia (exemplo)',               84.30, 'DESPESA', 'PAGO'),
        -- Mês atual
        (NEW.id, v_carteira, v_cat_salario,      v_mes_atual + 4,    'Salário (exemplo)',              4850.00, 'RECEITA', v_status_salario),
        (NEW.id, v_carteira, v_cat_aluguel,      v_mes_atual + 9,    'Aluguel (exemplo)',              1500.00, 'DESPESA', v_status_aluguel),
        (NEW.id, v_nubank,   v_cat_mercado,      CURRENT_DATE - 3,   'Mercado da semana (exemplo)',     287.90, 'DESPESA', 'PAGO'),
        (NEW.id, v_nubank,   v_cat_restaurantes, CURRENT_DATE - 5,   'Almoço restaurante (exemplo)',     68.50, 'DESPESA', 'PAGO'),
        (NEW.id, v_inter,    v_cat_combustivel,  CURRENT_DATE - 6,   'Combustível (exemplo)',           190.00, 'DESPESA', 'PAGO');

    -- ── Transferência de exemplo (par débito + crédito) ──
    -- Pagamento de fatura: sai da Carteira, entra no cartão Nubank.
    INSERT INTO arqvalor.transacoes
        (user_id, conta_id, categoria_id, data, descricao, valor, tipo, status, id_par_transferencia) VALUES
        (NEW.id, v_carteira, v_cat_transf, CURRENT_DATE - 1,
         '[Transf. saída] Pagamento fatura Nubank (exemplo)', 250.00, 'DESPESA', 'PAGO', v_par),
        (NEW.id, v_nubank,   v_cat_transf, CURRENT_DATE - 1,
         '[Transf. entrada] Pagamento fatura Nubank (exemplo)', 250.00, 'RECEITA', 'PAGO', v_par);

    RETURN NEW;
END;
$function$;
