-- ============================================================
-- Reverte a migration 20260824000001_cotacoes_ativos_diarias.sql.
--
-- O filtro de período do ranking de "Destaques" passou a reusar o snapshot
-- MENSAL que já existia (arqvalor.inv_historico_mensal, mesma fonte dos
-- gráficos da página do ativo) em vez de manter um cache diário alimentado
-- por busca ao vivo no Yahoo/CoinGecko — essa busca ao vivo causava estouro
-- de recursos da Edge Function numa carteira grande (WORKER_RESOURCE_LIMIT,
-- "Erro 546" ao trocar de período). Ver GET /investimentos/ranking em
-- dashboard.ts.
--
-- A tabela nunca chegou a ser usada em produção de verdade além dos testes
-- desta mesma sessão — sem dado de usuário a preservar, é seguro apagar.
-- ============================================================

DROP TABLE IF EXISTS arqvalor.cotacoes_ativos_diarias;
