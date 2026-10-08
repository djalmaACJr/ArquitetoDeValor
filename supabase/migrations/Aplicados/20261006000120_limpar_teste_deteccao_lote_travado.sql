-- Limpa as linhas de teste usadas pra validar a nova detecção de "cadeia de
-- lotes travada" em fn_verificar_saude_cron() (20261006000119) — simulou um
-- lote parado há 3h (tem_mais=true) e confirmou que a função gera o alerta
-- + dedup (não duplica no mesmo dia). Comportamento validado, teste limpo.
DELETE FROM arqvalor.cron_execucoes WHERE job_nome = 'teste-temp-lote-travado';
