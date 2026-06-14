-- ============================================================
-- inv_ativos.logo_url — URL do ícone/logo oficial do ativo.
--
-- Preenchido a partir do campo `logourl` da brapi (ex.:
-- https://icons.brapi.dev/icons/BBAS3.svg) na atualização em lote
-- (/investimentos/atualizar-ativos). Apenas leitura/exibição no front
-- (lista e detalhe do ativo). NULL quando a fonte não fornece logo
-- (renda fixa privada, tesouro direto, cripto no plano gratuito).
-- ============================================================

ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS logo_url TEXT;
