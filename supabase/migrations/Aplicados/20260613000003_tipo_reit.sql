-- ============================================================
-- Novo tipo de ativo: REIT (Real Estate Investment Trust) — o "FII" dos
-- EUA. É um ativo cotado em USD (listado nas bolsas americanas), então a
-- valoração usa a mesma trilha dos demais cotados (Yahoo Finance pelo
-- ticker puro + conversão pela PTAX).
--
-- ALTER TYPE ... ADD VALUE é idempotente com IF NOT EXISTS. Em Postgres 12+
-- pode rodar em transação desde que o novo valor não seja usado na mesma
-- transação (aqui só adicionamos).
-- ============================================================

ALTER TYPE arqvalor.tipo_ativo_inv ADD VALUE IF NOT EXISTS 'REIT';
