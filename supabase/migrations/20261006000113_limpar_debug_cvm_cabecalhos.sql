-- Limpa a linha de diagnóstico do debug_listar_cabecalhos (investigação da
-- remoção de fca_cia_aberta_capital_social_<ano>.csv pela CVM, out/2026).
-- Achado: nenhum dos 3 CSVs restantes do FCA 2026 (índice, geral,
-- valor_mobiliario) tem Quantidade_Total_Acoes ou equivalente — não foi
-- renomeado/movido dentro do FCA, foi removido de vez. Documentado no topo
-- de cvmAcoes.ts; redesenho (FRE ou API de mercado) ainda pendente.
DELETE FROM arqvalor.cron_execucoes WHERE resumo ? 'debug_cabecalhos';
