-- Corrige dado já gravado pelo bug: recomputarPosicao (posicoes.ts) só
-- limpava inv_historico_mensal de meses POSTERIORES ao fechamento de uma
-- posição (venda/resgate total, inclusive vencimento de RF/Tesouro via
-- fecharPosicoesVencidas), nunca o do PRÓPRIO mês do fechamento — a linha
-- daquele mês (reescrita todo dia pelo cron/"Atualizar valores" até o
-- fechamento) ficava órfã pra sempre, inflando o total do gráfico "Evolução
-- do Patrimônio" acima do valor real (que já saía correto do card
-- "Patrimônio total", que só soma pares com posição ATIVA). Corrigido no
-- código na mesma leva (posicoes.ts, .gt → .gte) — este DELETE é só o
-- backfill do que já ficou gravado, pra qualquer fechamento passado, não só
-- o mês corrente.
--
-- Só remove quando NENHUMA posição do par (ativo, conta) segue ATIVA hoje —
-- com múltiplos lotes do mesmo título (taxas diferentes, ver "novo lote" em
-- DrawerMovimentacoes), um lote fechado não zera o par inteiro. E só a
-- partir do mês da ÚLTIMA operação registrada pro par (mês real de
-- fechamento) — meses ANTERIORES são histórico legítimo (a posição
-- realmente valia aquilo então) e não são tocados. Sem nenhuma operação
-- registrada pro par (caso raro, ex. dado importado sem as operações),
-- não dá pra saber o mês de fechamento com segurança — não mexe.
DELETE FROM arqvalor.inv_historico_mensal h
WHERE NOT EXISTS (
    SELECT 1 FROM arqvalor.inv_posicoes p
    WHERE p.ativo_id = h.ativo_id AND p.conta_id = h.conta_id AND p.status = 'ATIVA'
  )
  AND h.mes_ano >= COALESCE(
    (SELECT to_char(MAX(o.data_operacao), 'YYYY-MM')
       FROM arqvalor.inv_operacoes o
       JOIN arqvalor.inv_posicoes p2 ON p2.id = o.posicao_id
      WHERE p2.ativo_id = h.ativo_id AND p2.conta_id = h.conta_id),
    '9999-12'
  );
