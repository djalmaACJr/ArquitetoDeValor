-- ============================================================
-- ARQUITETO DE VALOR — Migration v1.10
-- 20260429000007_corrigir_security_invoker_views.sql
--
-- Problema: vw_saldo_contas e vw_transacoes_com_saldo foram
-- criadas sem WITH (security_invoker = true). Em PostgreSQL,
-- views sem essa opção executam como o dono da view (postgres,
-- superusuário), que bypassa RLS — retornando dados de TODOS
-- os usuários a qualquer requisição autenticada.
--
-- Fix: recriar as views com security_invoker = true.
-- Colunas extras (dia_fechamento, id_par_transferencia, etc.)
-- são adicionadas pela migration 008 que recria as views
-- com o schema completo.
-- ============================================================


-- ============================================================
-- 1. vw_saldo_contas  (colunas base — sem dia_fechamento/dia_pagamento)
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
GROUP BY c.id, c.user_id, c.nome, c.tipo, c.icone, c.cor, c.ativa, c.saldo_inicial;


-- ============================================================
-- 2. vw_transacoes_com_saldo  (colunas base — sem id_par_transferencia, etc.)
-- ============================================================
CREATE OR REPLACE VIEW arqvalor.vw_transacoes_com_saldo
WITH (security_invoker = true)
AS
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
    t.criado_em,
    t.atualizado_em,
    cat.descricao     AS categoria_nome,
    cat.icone         AS categoria_icone,
    cat.cor           AS categoria_cor,
    cat_pai.descricao AS categoria_pai_nome,
    con.nome          AS conta_nome,
    con.icone         AS conta_icone,
    con.cor           AS conta_cor,
    con.saldo_inicial + SUM(
        CASE
            WHEN t.tipo = 'RECEITA' THEN  t.valor
            WHEN t.tipo = 'DESPESA' THEN -t.valor
        END
    ) OVER (
        PARTITION BY t.conta_id
        ORDER BY t.data ASC, t.criado_em ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS saldo_acumulado
FROM      arqvalor.transacoes  t
JOIN      arqvalor.contas      con     ON con.id     = t.conta_id
LEFT JOIN arqvalor.categorias  cat     ON cat.id     = t.categoria_id
LEFT JOIN arqvalor.categorias  cat_pai ON cat_pai.id = cat.id_pai;


-- ============================================================
-- FIM DA MIGRATION — 20260429000007_corrigir_security_invoker_views
-- ============================================================
