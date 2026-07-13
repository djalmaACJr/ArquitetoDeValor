-- ============================================================
-- Investimentos — reparo de proventos legados no extrato
--
-- Duas limpezas de dados gravados por bugs já corrigidos no código da
-- Edge Function `investimentos`:
--
-- 1) PROVENTOS USD COM VALOR CRU NO EXTRATO
--    Antes da conversão por PTAX no lançamento/importação, proventos de
--    ativos em moeda estrangeira eram gravados na transação do extrato
--    com o valor EM DÓLAR como se fosse reais (ex.: JEPI 05/01/2026:
--    extrato 32,31 = US$ 32,31; o correto é R$ 175,61). O inv_dividendos
--    vinculado ficou com o valor certo em BRL (líquido × PTAX da data) —
--    a página de Proventos mostrava 7.361,70 no ano e o Extrato 5.024,63.
--    Correção: copia o valor BRL do dividendo para a transação vinculada.
--    `valor_projetado`, quando existir, é escalado pela mesma razão
--    (era o bruto em USD; vira o bruto em BRL).
--    Guarda de segurança: só encosta em transação de ativo com moeda
--    estrangeira cuja razão dividendo/transação esteja na faixa plausível
--    de câmbio (3.5–8) — preserva correções manuais legítimas.
--
-- 2) PROVENTOS B3 DUPLICADOS PELO CRON RETROATIVO
--    Até 08/07/2026, confirmar um provento (PROJECAO → PAGO, com valor
--    real) fazia a busca diária seguinte não reconhecer o registro e
--    recriar o mesmo provento (ex.: BBDC3 JSCP 01/07/2026 lançado 5x).
--    O guard por data exata (`mesmaData`) já impede novos casos; aqui
--    removemos os já gravados: réplicas EXATAS — mesma chave (usuário,
--    ativo, conta, tipo, data de pagamento) E MESMO VALOR — mantendo o
--    registro mais antigo e apagando os demais junto com suas transações
--    no extrato. O valor faz parte da chave de propósito: dois proventos
--    do mesmo tipo na mesma data com valores DIFERENTES são legítimos
--    (ex.: WEGE3/CMIG4 pagam mais de um JCP no mesmo dia) e não são
--    tocados; posições do mesmo ativo em contas diferentes idem (a conta
--    faz parte da chave).
--
-- Vale para TODOS os usuários. Idempotente: após rodar, a razão
-- dividendo/transação vira 1 (fora da faixa 3.5–8) e não sobram réplicas.
-- ============================================================

-- ── 1) Extrato de proventos USD: valor cru → valor BRL do dividendo ──
UPDATE arqvalor.transacoes t
SET    valor = d.valor,
       valor_projetado = CASE
         WHEN t.valor_projetado IS NOT NULL
           THEN round(t.valor_projetado * d.valor / t.valor, 2)
         ELSE t.valor_projetado
       END
FROM   arqvalor.inv_dividendos d
JOIN   arqvalor.inv_ativos a ON a.id = d.ativo_id
WHERE  d.transacao_extrato_id = t.id
  AND  upper(coalesce(a.moeda, 'BRL')) <> 'BRL'
  AND  t.valor > 0
  AND  d.valor / t.valor BETWEEN 3.5 AND 8;

-- ── 2) Dedup de réplicas exatas recriadas pelo cron retroativo ──
-- Mantém o registro mais antigo de cada (user, ativo, conta, tipo, data,
-- valor); apaga as réplicas e suas transações no extrato.
WITH ranqueados AS (
  SELECT id, transacao_extrato_id,
         row_number() OVER (
           PARTITION BY user_id, ativo_id, conta_id, tipo_dividendo_id,
                        data_pagamento, valor
           ORDER BY created_at
         ) AS rn
  FROM   arqvalor.inv_dividendos
  WHERE  tipo_dividendo_id IS NOT NULL
),
removidos AS (
  DELETE FROM arqvalor.inv_dividendos
  WHERE  id IN (SELECT id FROM ranqueados WHERE rn > 1)
  RETURNING transacao_extrato_id
)
DELETE FROM arqvalor.transacoes
WHERE  id IN (
  SELECT transacao_extrato_id FROM removidos
  WHERE  transacao_extrato_id IS NOT NULL
);
