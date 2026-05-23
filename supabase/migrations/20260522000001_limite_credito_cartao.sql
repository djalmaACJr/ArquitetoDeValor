-- ============================================================
-- Limite de crédito para contas do tipo CARTAO
-- ============================================================
-- Adiciona coluna limite_credito em arqvalor.contas e re-cria a
-- view vw_saldo_contas para expô-la.
-- ============================================================

ALTER TABLE arqvalor.contas
    ADD COLUMN IF NOT EXISTS limite_credito NUMERIC(15,2)
        CHECK (limite_credito IS NULL OR limite_credito >= 0);

-- Re-cria view incluindo limite_credito
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
    c.limite_credito,
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
LEFT JOIN arqvalor.transacoes t ON t.conta_id = c.id
GROUP BY
    c.id, c.user_id, c.nome, c.tipo, c.icone, c.cor,
    c.ativa, c.saldo_inicial, c.dia_fechamento, c.dia_pagamento, c.limite_credito;
