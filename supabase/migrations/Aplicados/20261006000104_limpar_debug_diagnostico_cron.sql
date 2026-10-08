-- Limpa as linhas de diagnóstico (prefixo "debug-") inseridas em
-- cron_execucoes pelas migrations 20261006000099/101/102/103 ao investigar
-- as falhas reais de cvm-acoes-mensal e dividendos-br-diario — não são
-- execuções de cron de verdade, só não há outra forma de ler NOTICE/
-- net._http_response fora do schema `arqvalor` exposto via PostgREST.
-- Achados (ver CLAUDE.md/ARCHITECTURE.md): ambos os jobs batem no limite de
-- recursos/tempo da Edge Function quando processam a carga real de dados —
-- não é falta de secret (essa parte já corrigida em 20261006000008).
DELETE FROM arqvalor.cron_execucoes
WHERE job_nome LIKE 'debug-%';
