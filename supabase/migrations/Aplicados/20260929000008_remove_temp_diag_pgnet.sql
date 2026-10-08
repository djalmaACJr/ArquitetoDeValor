-- Remove a função de diagnóstico temporária de 20260929000007 — já cumpriu
-- o propósito (verificar se dava pra mover pg_net com segurança).
DROP FUNCTION IF EXISTS arqvalor._diag_pgnet();
