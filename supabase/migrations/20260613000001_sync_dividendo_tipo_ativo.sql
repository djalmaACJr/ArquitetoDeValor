-- ============================================================
-- Corrige inv_dividendos.tipo_ativo divergente do tipo real do ativo
-- ============================================================
-- O campo inv_dividendos.tipo_ativo é uma cópia desnormalizada de
-- inv_ativos.tipo_ativo (preenchida na criação/importação). Se o tipo do
-- ativo for corrigido depois, os dividendos antigos ficam com o tipo
-- defasado — fazendo um ativo aparecer na categoria errada nos gráficos
-- da página de Dividendos / dashboard (ex.: DIVD11 (ETF) listado em FII).
--
-- Backfill idempotente: alinha o tipo gravado ao tipo real do ativo.
-- Rodar de novo não tem efeito quando já estão sincronizados.
-- ============================================================

UPDATE arqvalor.inv_dividendos d
SET    tipo_ativo = a.tipo_ativo
FROM   arqvalor.inv_ativos a
WHERE  d.ativo_id = a.id
  AND  d.tipo_ativo IS DISTINCT FROM a.tipo_ativo;
