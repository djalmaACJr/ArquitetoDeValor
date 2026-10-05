-- Remove a função de diagnóstico temporária criada em
-- 20261004000099_debug_explain_temp.sql, usada só para investigar (via
-- EXPLAIN ANALYZE sob o JWT real de um usuário de teste) uma regressão de
-- performance em UPDATE de transacoes causada por acúmulo de linhas de
-- teste em arqvalor.agregados — achado e resolvido durante a Fase 4.
DROP FUNCTION IF EXISTS arqvalor.fn_debug_explain_par(uuid);
