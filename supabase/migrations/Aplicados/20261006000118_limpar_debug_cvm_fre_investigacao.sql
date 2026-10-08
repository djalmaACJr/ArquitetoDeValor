-- Limpa as 3 linhas de diagnóstico do FRE (tamanho dos ZIPs, listagem de
-- arquivos, cabeçalhos/amostras) gravadas em cron_execucoes durante a
-- investigação que levou ao fix real: cvm-acoes-mensal agora usa
-- fre_cia_aberta_capital_social_<ano>.csv (Tipo_Capital = "Capital
-- Emitido") em vez do extinto fca_cia_aberta_capital_social_<ano>.csv.
-- Validado em produção: 177/200 ativos atualizados (antes: 0/199).
DELETE FROM arqvalor.cron_execucoes
WHERE resumo ? 'debug_fre_tamanhos' OR resumo ? 'debug_fre_arquivos' OR resumo ? 'debug_fre_cabecalhos';
