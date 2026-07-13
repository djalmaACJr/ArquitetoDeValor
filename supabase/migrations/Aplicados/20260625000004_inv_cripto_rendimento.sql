-- ============================================================
-- Investimentos — rendimento (yield) de criptomoedas
--
-- Algumas criptos rendem ao longo do tempo creditando MAIS TOKENS
-- (ex.: USDC ~3,5% a.a.). Modelamos como operação RENDIMENTO: aumenta a
-- quantidade da posição com custo ZERO (token grátis) — o preço médio cai e
-- o ganho aparece como valorização (mais tokens × preço). NÃO é provento
-- (cripto não tem quadro de dividendos).
--
-- Materialização: 1 operação RENDIMENTO por mês por posição (upsert),
-- com juros compostos diários: tokens = qtd × ((1+taxa)^(dias/365) − 1).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + ADD VALUE IF NOT EXISTS.
-- ============================================================

-- Taxa de rendimento anual (% a.a.), só faz sentido p/ CRIPTOMOEDAS.
ALTER TABLE arqvalor.inv_ativos
  ADD COLUMN IF NOT EXISTS cripto_rendimento_aa NUMERIC(8,4);

COMMENT ON COLUMN arqvalor.inv_ativos.cripto_rendimento_aa IS
  'Rendimento anual da cripto em % a.a. (ex.: 3.5). Gera operações '
  'RENDIMENTO (mais tokens, custo zero) com juros compostos diários. '
  'NULL/0 = sem rendimento.';

-- Novo tipo de operação: crédito de rendimento (yield em tokens).
-- PG15 permite ADD VALUE dentro de transação desde que o valor não seja
-- USADO na mesma transação (aqui só adicionamos; o uso é em runtime).
ALTER TYPE arqvalor.tipo_operacao_inv ADD VALUE IF NOT EXISTS 'RENDIMENTO';
