-- ============================================================
-- vw_inv_ultimo_mercado — último valor de mercado por (ativo, conta).
--
-- Motivação: dashboard e ranking liam a tabela inv_historico_mensal
-- INTEIRA (todos os meses de todos os ativos) só para, em JS, achar o
-- snapshot mais recente de cada par. Isso cresce linearmente com o
-- histórico. Esta view resolve "o último por par" no banco (DISTINCT ON),
-- trafegando 1 linha por par em vez de toda a série.
--
-- security_invoker = true → a RLS de inv_historico_mensal
-- (user_id = auth.uid()) é aplicada para quem consulta a view (mesmo
-- padrão de vw_saldo_contas). mes_ano é "YYYY-MM": ordem lexicográfica
-- DESC = mais recente primeiro.
-- ============================================================

CREATE OR REPLACE VIEW arqvalor.vw_inv_ultimo_mercado
WITH (security_invoker = true) AS
SELECT DISTINCT ON (h.user_id, h.ativo_id, h.conta_id)
       h.user_id,
       h.ativo_id,
       h.conta_id,
       h.mes_ano,
       h.valor_mercado
FROM arqvalor.inv_historico_mensal h
ORDER BY h.user_id, h.ativo_id, h.conta_id, h.mes_ano DESC;

GRANT SELECT ON arqvalor.vw_inv_ultimo_mercado TO authenticated;

-- Índice de apoio ao DISTINCT ON (cobre a ordenação por par + mês desc).
CREATE INDEX IF NOT EXISTS idx_inv_historico_par_mes
    ON arqvalor.inv_historico_mensal (user_id, ativo_id, conta_id, mes_ano DESC);
