-- Adiciona coluna ultima_movimentacao em vw_saldo_contas:
-- data da transação mais recente (até hoje) de cada conta, NULL se nunca movimentada.
-- Usada na página de Contas para exibir, nas contas inativas, quando houve o último lançamento.
-- CREATE OR REPLACE: nova coluna adicionada no FIM, demais colunas inalteradas em nome/tipo/ordem.

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
    c.cartoes_virtuais,
    COALESCE(SUM(
        CASE
            WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
            WHEN t.tipo = 'RECEITA' THEN  t.valor
            WHEN t.tipo = 'DESPESA' THEN -t.valor
        END
    ), 0) AS movimentacao,
    c.saldo_inicial + COALESCE(SUM(
        CASE
            WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
            WHEN t.tipo = 'RECEITA' THEN  t.valor
            WHEN t.tipo = 'DESPESA' THEN -t.valor
        END
    ), 0) AS saldo_atual,
    MAX(t.data) AS ultima_movimentacao
FROM arqvalor.contas c
LEFT JOIN arqvalor.transacoes t
       ON t.conta_id = c.id
      AND t.data    <= CURRENT_DATE
GROUP BY
    c.id, c.user_id, c.nome, c.tipo, c.icone, c.cor,
    c.ativa, c.saldo_inicial, c.dia_fechamento, c.dia_pagamento,
    c.limite_credito, c.cartoes_virtuais;
