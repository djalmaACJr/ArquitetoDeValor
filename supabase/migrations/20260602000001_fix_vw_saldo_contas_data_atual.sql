-- Corrige vw_saldo_contas: adiciona filtro t.data <= CURRENT_DATE no JOIN
-- para excluir transações futuras do saldo atual (alinha com fn_saldos_contas_ate_data).

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
    ), 0) AS saldo_atual
FROM arqvalor.contas c
LEFT JOIN arqvalor.transacoes t
       ON t.conta_id = c.id
      AND t.data    <= CURRENT_DATE
GROUP BY
    c.id, c.user_id, c.nome, c.tipo, c.icone, c.cor,
    c.ativa, c.saldo_inicial, c.dia_fechamento, c.dia_pagamento,
    c.limite_credito, c.cartoes_virtuais;
