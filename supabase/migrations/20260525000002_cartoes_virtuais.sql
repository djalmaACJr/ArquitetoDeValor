-- ============================================================
-- Cartões virtuais associados a uma conta tipo CARTAO
-- ============================================================
-- Em vez de criar uma tabela separada, guardamos os cartões virtuais
-- de cada conta como JSONB inline em `arqvalor.contas.cartoes_virtuais`.
--
-- Estrutura:
--   [
--     { "id": "<uuid>", "sufixo": "1234", "apelido": "Principal" },
--     { "id": "<uuid>", "sufixo": "5678", "apelido": "Compras online" },
--     ...
--   ]
--
-- Justificativa do JSONB:
--   - Cartões virtuais são SEMPRE filtrados/consultados junto da conta-pai;
--     nunca há um SELECT global de cartões.
--   - Volume baixo por conta (tipicamente 1-5 cartões).
--   - Não há FK pra esses cartões em transacoes (a transação aponta para
--     `conta_id`, não para um cartão específico).
--
-- Default `'[]'::jsonb` para contas existentes; tipo CARTAO ou não,
-- todos recebem o array vazio (mas o backend só persiste quando tipo=CARTAO).
-- ============================================================

ALTER TABLE arqvalor.contas
    ADD COLUMN IF NOT EXISTS cartoes_virtuais JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Re-cria view de saldo incluindo o novo campo.
-- Precisa DROP+CREATE (não CREATE OR REPLACE) porque o Postgres recusa
-- adicionar coluna no meio da lista de uma view existente
-- ("cannot change name of view column ..."). DROP é seguro: ninguém depende
-- dessa view (não há FK; só os endpoints leem dela).
DROP VIEW IF EXISTS arqvalor.vw_saldo_contas;
CREATE VIEW arqvalor.vw_saldo_contas
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
    c.ativa, c.saldo_inicial, c.dia_fechamento, c.dia_pagamento,
    c.limite_credito, c.cartoes_virtuais;
