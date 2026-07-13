-- ============================================================
-- Investimentos — baseline de operações por posição
--
-- Novo modelo: a posição passa a ser a SOMA das operações (a
-- operação de Compra/Venda/Aporte/Resgate mantém a posição).
-- Para não zerar posições que ainda não têm operações (criadas
-- manualmente ou importadas só com saldo), semeia uma operação
-- COMPRA reproduzindo o saldo atual de cada posição com quantidade
-- e sem nenhuma operação. Assim o recálculo "posição = soma das
-- operações" preserva o saldo existente.
--
-- Idempotente: o NOT EXISTS impede semear duas vezes.
-- ============================================================

-- Renda fixa/Tesouro usam APORTE (exibido como "Aplicação"); demais, COMPRA.
INSERT INTO arqvalor.inv_operacoes
  (user_id, posicao_id, tipo_operacao, conta_id, quantidade, preco_unitario, valor_total, data_operacao)
SELECT
  p.user_id, p.id,
  (CASE WHEN a.tipo_ativo IN ('RENDA_FIXA', 'TESOURO_DIRETO') THEN 'APORTE' ELSE 'COMPRA' END)::arqvalor.tipo_operacao_inv,
  p.conta_id, p.quantidade, p.preco_custo, p.valor_custo, p.data_compra
FROM arqvalor.inv_posicoes p
JOIN arqvalor.inv_ativos a ON a.id = p.ativo_id
WHERE p.quantidade > 0
  AND NOT EXISTS (
    SELECT 1 FROM arqvalor.inv_operacoes o WHERE o.posicao_id = p.id
  );
