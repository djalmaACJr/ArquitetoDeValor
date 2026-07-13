-- ============================================================
-- Investimentos — limpeza de proventos com data-sentinela (ano 9999)
--
-- A B3 devolve datas "a definir" como 31/12/9999 nos proventos de FIIs/ações.
-- Sem filtro na fonte, esses proventos viravam projeções lançadas no extrato
-- com data no ano 9999 (o filtro foi adicionado no código da Edge Function
-- investimentos — dataPagamentoPlausivel). Esta migration limpa o que já foi
-- gravado antes da correção:
--   1) Apaga as transações do extrato com data >= 9999-01-01 (a FK
--      inv_dividendos.transacao_extrato_id é ON DELETE SET NULL);
--   2) Apaga as linhas de inv_dividendos com data_pagamento >= 9999-01-01
--      (inclui as órfãs cuja transação já foi excluída manualmente).
--
-- Vale para TODOS os usuários. Idempotente: após rodar, nada mais casa.
-- Ano 9999 é uma sentinela inequívoca — nenhum lançamento legítimo do app
-- fica nessa data, então o alvo por data é seguro.
-- ============================================================

DELETE FROM arqvalor.transacoes
 WHERE data >= DATE '9999-01-01';

DELETE FROM arqvalor.inv_dividendos
 WHERE data_pagamento >= DATE '9999-01-01';
