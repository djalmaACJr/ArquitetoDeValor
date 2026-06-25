-- ============================================================
-- Investimentos — re-sincronização do baseline de operações
--
-- Objetivo: deixar inv_operacoes consistente com as posições que o
-- usuário corrigiu manualmente, para que o cálculo de Yield on Cost
-- ponto-a-ponto (rota /investimentos/ranking) reconstrua o custo
-- histórico corretamente.
--
-- Contexto: o modelo é "posição = soma das operações", mas o
-- PUT /posicoes edita a posição SEM atualizar a operação baseline.
-- Além disso, posições criadas via POST /posicoes nascem SEM operação,
-- e o baseline original (20260623000001) só cobriu o que existia quando
-- rodou. Este script fecha os dois casos.
--
-- Decisão "PRESERVAR": só mexe em posições com 0 ou 1 operação. Posições
-- com histórico real (>= 2 operações) ficam INTACTAS — não há como um
-- script saber que a baseline de 1 operação deveria virar várias.
--
-- Idempotente: rodar de novo não duplica nem altera nada já consistente.
-- NÃO reconstrói datas de aportes que nunca foram registradas — para
-- esses, o custo histórico fica plano desde data_compra (YoC simples).
-- ============================================================

-- ------------------------------------------------------------
-- DIAGNÓSTICO (rode separado, NÃO altera dados):
-- mostra cada posição ATIVA, quantas operações tem e se o baseline
-- diverge do estado atual da posição.
-- ------------------------------------------------------------
-- SELECT
--   p.id            AS posicao_id,
--   a.ticker,
--   a.tipo_ativo,
--   p.quantidade,
--   p.preco_custo,
--   p.valor_custo,
--   p.data_compra,
--   (SELECT COUNT(*) FROM arqvalor.inv_operacoes o WHERE o.posicao_id = p.id) AS n_operacoes
-- FROM arqvalor.inv_posicoes p
-- JOIN arqvalor.inv_ativos a ON a.id = p.ativo_id
-- WHERE p.status = 'ATIVA' AND p.quantidade > 0
-- ORDER BY n_operacoes, a.ticker;

-- ============================================================
-- PARTE 1 — Semeia baseline para posições ATIVAS SEM nenhuma operação
-- (criadas via POST /posicoes ou anteriores ao baseline original).
-- Renda fixa/Tesouro usam APORTE ("Aplicação"); demais, COMPRA.
-- ============================================================
INSERT INTO arqvalor.inv_operacoes
  (user_id, posicao_id, tipo_operacao, conta_id, quantidade, preco_unitario, valor_total, data_operacao)
SELECT
  p.user_id, p.id,
  (CASE WHEN a.tipo_ativo IN ('RENDA_FIXA', 'TESOURO_DIRETO') THEN 'APORTE' ELSE 'COMPRA' END)::arqvalor.tipo_operacao_inv,
  p.conta_id, p.quantidade, p.preco_custo, p.valor_custo, p.data_compra
FROM arqvalor.inv_posicoes p
JOIN arqvalor.inv_ativos a ON a.id = p.ativo_id
WHERE p.status = 'ATIVA'
  AND p.quantidade > 0
  AND NOT EXISTS (
    SELECT 1 FROM arqvalor.inv_operacoes o WHERE o.posicao_id = p.id
  );

-- ============================================================
-- PARTE 2 — Re-sincroniza posições com EXATAMENTE 1 operação cujo
-- baseline divergiu da posição corrigida (ex.: você editou
-- quantidade/preço/data na posição via PUT /posicoes).
--
-- Posições com >= 2 operações NÃO entram (preserva histórico real).
-- Posições com 1 operação que já bate NÃO são tocadas (idempotência).
-- ============================================================
UPDATE arqvalor.inv_operacoes o
SET tipo_operacao  = (CASE WHEN a.tipo_ativo IN ('RENDA_FIXA', 'TESOURO_DIRETO')
                           THEN 'APORTE' ELSE 'COMPRA' END)::arqvalor.tipo_operacao_inv,
    conta_id       = p.conta_id,
    quantidade     = p.quantidade,
    preco_unitario = p.preco_custo,
    valor_total    = p.valor_custo,
    data_operacao  = p.data_compra
FROM arqvalor.inv_posicoes p
JOIN arqvalor.inv_ativos a ON a.id = p.ativo_id
WHERE o.posicao_id = p.id
  AND p.status = 'ATIVA'
  AND p.quantidade > 0
  -- só posições com UMA operação (a baseline) — preserva histórico real
  AND (SELECT COUNT(*) FROM arqvalor.inv_operacoes o2 WHERE o2.posicao_id = p.id) = 1
  -- só atualiza o que de fato divergiu (evita rewrite desnecessário)
  AND (
        o.quantidade     IS DISTINCT FROM p.quantidade
     OR o.preco_unitario IS DISTINCT FROM p.preco_custo
     OR o.valor_total    IS DISTINCT FROM p.valor_custo
     OR o.data_operacao  IS DISTINCT FROM p.data_compra
     OR o.conta_id       IS DISTINCT FROM p.conta_id
  );
