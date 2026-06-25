-- ============================================================
-- Investimentos — dividendo POR COTA em inv_dividendos
--
-- O app já busca da B3/Polygon o `rate` (dividendo por cota/ação) de cada
-- provento, mas só persistia o total (rate × quantidade). Sem o rate não dá
-- para calcular DY e Yield on Cost no padrão investidor10 — que são métricas
-- do ATIVO (independem da sua posição):
--   DY  = Σ rate_12m / preço_atual
--   YoC = Σ rate_12m / preço_médio
--
-- Esta coluna guarda esse rate por provento. Fica NULL nos lançamentos
-- antigos até o backfill (rota /dividendos-backfill-rate) preenchê-los a
-- partir da B3; o cálculo no /ranking usa o rate quando presente e estima
-- (valor / cotas na data) quando ausente.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE arqvalor.inv_dividendos
  ADD COLUMN IF NOT EXISTS valor_por_cota NUMERIC(20,8);

COMMENT ON COLUMN arqvalor.inv_dividendos.valor_por_cota IS
  'Dividendo por cota/ação (rate da B3/Polygon, na moeda do lançamento). '
  'Base do DY e Yield on Cost no padrão investidor10. NULL = ainda não '
  'preenchido (backfill ou provento manual).';
