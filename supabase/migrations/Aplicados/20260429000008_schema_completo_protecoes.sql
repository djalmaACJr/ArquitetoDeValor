-- ============================================================
-- ARQUITETO DE VALOR — Migration v1.11
-- 20260429000008_schema_completo_protecoes.sql
--
-- Objetivo: adicionar colunas que existem no banco mas não
-- estavam nas migrations, e criar as proteções de categorias
-- protegidas que também existiam apenas no banco.
--
-- Itens:
--   1. ADD COLUMN IF NOT EXISTS em contas, categorias, transacoes
--   2. fn_trg_proteger_categoria + trg_proteger_categoria
--   3. fn_trg_bloquear_exclusao_transf_avulsa + trigger
--   4. fn_sincronizar_usuario corrigido (protegida = TRUE em Transferências)
--   5. Views recriadas com schema completo + security_invoker = true
-- ============================================================


-- ============================================================
-- 1. COLUNAS FALTANTES
-- ============================================================

-- contas: dias de fechamento/pagamento de cartão
ALTER TABLE arqvalor.contas
    ADD COLUMN IF NOT EXISTS dia_fechamento INTEGER CHECK (dia_fechamento BETWEEN 1 AND 31),
    ADD COLUMN IF NOT EXISTS dia_pagamento  INTEGER CHECK (dia_pagamento  BETWEEN 1 AND 31);

-- categorias: flag de proteção contra edição/exclusão
ALTER TABLE arqvalor.categorias
    ADD COLUMN IF NOT EXISTS protegida BOOLEAN NOT NULL DEFAULT FALSE;

-- transacoes: par de transferência e intervalo de recorrência
ALTER TABLE arqvalor.transacoes
    ADD COLUMN IF NOT EXISTS id_par_transferencia UUID,
    ADD COLUMN IF NOT EXISTS intervalo_recorrencia INTEGER CHECK (intervalo_recorrencia >= 1);

CREATE INDEX IF NOT EXISTS idx_tx_id_par ON arqvalor.transacoes (id_par_transferencia)
    WHERE id_par_transferencia IS NOT NULL;


-- ============================================================
-- 2. FUNÇÃO + TRIGGER: proteger categorias com protegida = TRUE
--    Permite alterar apenas cor e icone.
--    Bloqueia DELETE e qualquer outro UPDATE.
--    Nota: NÃO bloqueia mudança de protegida TRUE→FALSE para
--    permitir o fluxo de fn_excluir_dados_usuario.
-- ============================================================
CREATE OR REPLACE FUNCTION arqvalor.fn_trg_proteger_categoria()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.protegida = TRUE THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'CATEGORIA_PROTEGIDA'
                USING DETAIL = 'Esta categoria nao pode ser excluida.';
        ELSIF TG_OP = 'UPDATE' THEN
            IF (NEW.descricao IS DISTINCT FROM OLD.descricao)
            OR (NEW.id_pai    IS DISTINCT FROM OLD.id_pai)
            OR (NEW.ativa     IS DISTINCT FROM OLD.ativa)
            THEN
                RAISE EXCEPTION 'CATEGORIA_PROTEGIDA'
                    USING DETAIL = 'Apenas cor e icone podem ser alterados nesta categoria.';
            END IF;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_categoria ON arqvalor.categorias;

CREATE TRIGGER trg_proteger_categoria
    BEFORE DELETE OR UPDATE ON arqvalor.categorias
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_trg_proteger_categoria();


-- ============================================================
-- 3. FUNÇÃO + TRIGGER: bloquear exclusão avulsa de transferência
--    Transações de transferência devem ser excluídas somente
--    pelo endpoint /transferencias (que remove o par inteiro).
-- ============================================================
CREATE OR REPLACE FUNCTION arqvalor.fn_trg_bloquear_exclusao_transf_avulsa()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.id_par_transferencia IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM arqvalor.categorias
            WHERE id = OLD.categoria_id AND protegida = TRUE
        ) THEN
            RAISE EXCEPTION 'EXCLUSAO_AVULSA_TRANSFERENCIA'
                USING DETAIL = 'Use o endpoint de transferencias para excluir este lancamento.';
        END IF;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_exclusao_transf_avulsa ON arqvalor.transacoes;

CREATE TRIGGER trg_bloquear_exclusao_transf_avulsa
    BEFORE DELETE ON arqvalor.transacoes
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_trg_bloquear_exclusao_transf_avulsa();


-- ============================================================
-- 4. fn_sincronizar_usuario — corrigido com protegida = TRUE
--    para a categoria "Transferências"
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
        ('Renda',          'Dividendos',         '📈', '#00c896')
    ) AS s(pai_nome, descricao, icone, cor)
    ON p.descricao = s.pai_nome;

    RETURN NEW;
END;
$$;


-- ============================================================
-- 5. VIEWS — schema completo + security_invoker = true
--    (substitui as definições da migration 007)
-- ============================================================

CREATE OR REPLACE VIEW arqvalor.vw_saldo_contas
WITH (security_invoker = true)
AS
SELECT
    c.id              AS conta_id,
    c.user_id,
    c.nome,
    c.tipo,
    c.icone,
    c.cor,
    c.ativa,
    c.saldo_inicial,
    c.dia_fechamento,
    c.dia_pagamento,
    COALESCE(SUM(
        CASE
            WHEN t.tipo = 'RECEITA' THEN  t.valor
            WHEN t.tipo = 'DESPESA' THEN -t.valor
        END
    ), 0) AS movimentacao,
    c.saldo_inicial + COALESCE(SUM(
        CASE
            WHEN t.tipo = 'RECEITA' THEN  t.valor
            WHEN t.tipo = 'DESPESA' THEN -t.valor
        END
    ), 0) AS saldo_atual
FROM arqvalor.contas c
LEFT JOIN arqvalor.transacoes t ON t.conta_id = c.id AND t.status = 'PAGO'
GROUP BY
    c.id, c.user_id, c.nome, c.tipo, c.icone, c.cor,
    c.ativa, c.saldo_inicial, c.dia_fechamento, c.dia_pagamento;


CREATE OR REPLACE VIEW arqvalor.vw_transacoes_com_saldo
WITH (security_invoker = true)
AS WITH saldo_inicial_por_usuario AS (
    SELECT contas.user_id,
           SUM(COALESCE(contas.saldo_inicial, 0)) AS total_saldo_inicial
    FROM arqvalor.contas
    WHERE contas.ativa = TRUE
    GROUP BY contas.user_id
)
SELECT
    t.id,
    t.user_id,
    t.conta_id,
    t.categoria_id,
    t.data,
    t.ano_tx,
    t.mes_tx,
    t.descricao,
    t.valor,
    t.valor_projetado,
    t.tipo,
    t.status,
    t.id_recorrencia,
    t.nr_parcela,
    t.total_parcelas,
    t.tipo_recorrencia,
    t.observacao,
    t.id_par_transferencia,
    t.criado_em,
    t.atualizado_em,
    cat.descricao     AS categoria_nome,
    cat.icone         AS categoria_icone,
    cat.cor           AS categoria_cor,
    cat_pai.descricao AS categoria_pai_nome,
    con.nome          AS conta_nome,
    con.icone         AS conta_icone,
    con.cor           AS conta_cor,
    si.total_saldo_inicial + SUM(
        CASE
            WHEN t.tipo = 'RECEITA' THEN  t.valor
            ELSE                         -t.valor
        END
    ) OVER (
        PARTITION BY t.user_id
        ORDER BY t.data ASC, t.criado_em ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS saldo_acumulado
FROM      arqvalor.transacoes         t
LEFT JOIN arqvalor.categorias         cat     ON cat.id     = t.categoria_id
LEFT JOIN arqvalor.categorias         cat_pai ON cat_pai.id = cat.id_pai
LEFT JOIN arqvalor.contas             con     ON con.id     = t.conta_id
JOIN      saldo_inicial_por_usuario   si      ON si.user_id = t.user_id;


-- ============================================================
-- FIM DA MIGRATION — 20260429000008_schema_completo_protecoes
-- ============================================================
