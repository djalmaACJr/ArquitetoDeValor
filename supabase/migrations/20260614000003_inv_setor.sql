-- ============================================================
-- inv_ativos.setor — setor econômico do ativo (ex.: "Finance",
-- "Energy Minerals", "Utilities").
--
-- Preenchido a partir do campo `sector` da brapi (endpoint quote/list
-- com ?search=<ticker>) na atualização em lote (/investimentos/
-- atualizar-ativos). Valor cru em inglês — a tradução p/ rótulo é feita
-- no front. Apenas leitura/exibição. NULL quando a fonte não fornece
-- (renda fixa privada, tesouro direto, cripto no plano gratuito).
-- ============================================================

ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS setor TEXT;
