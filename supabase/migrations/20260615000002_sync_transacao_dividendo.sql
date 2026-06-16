-- ============================================================
-- Trigger: sincronização REVERSA extrato → inv_dividendos
-- ============================================================
-- Até aqui o vínculo dividendo ↔ extrato era unidirecional: a Edge
-- Function `investimentos` empurrava valor/data para a transação, mas
-- editar a transação DIRETO no extrato (Lançamentos) não voltava para
-- inv_dividendos. Resultado: ao pagar/alterar um provento provisionado
-- pelo extrato, os quadros de Proventos (que leem valor/data das colunas
-- de inv_dividendos) ficavam defasados.
--
-- Este trigger fecha o gap: toda vez que a transação vinculada
-- (inv_dividendos.transacao_extrato_id) tem valor, data ou conta
-- alterados no extrato, propaga para o dividendo correspondente.
--
-- Sobre STATUS (PROJECAO → PAGO): não há nada a copiar — inv_dividendos
-- NÃO guarda status. A página de Proventos deriva "provisionado" do
-- status da transação ao vivo (join transacoes(status)), então a troca
-- de status já reflete sozinha. Aqui sincronizamos só os campos que
-- inv_dividendos materializa: valor, data_pagamento e conta_id.
--
-- Sem risco de loop: não existe trigger em inv_dividendos que escreva de
-- volta em transacoes. A lookup usa o índice parcial já existente
-- idx_inv_dividendos_transacao (transacao_extrato_id IS NOT NULL), então
-- para transações comuns (sem dividendo vinculado) o custo é mínimo.
--
-- Idempotente (CREATE OR REPLACE + DROP TRIGGER IF EXISTS + backfill).
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_sync_transacao_dividendo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  UPDATE arqvalor.inv_dividendos
  SET    valor          = NEW.valor,
         data_pagamento = NEW.data,
         conta_id       = NEW.conta_id
  WHERE  transacao_extrato_id = NEW.id
    AND  (valor          IS DISTINCT FROM NEW.valor
       OR data_pagamento IS DISTINCT FROM NEW.data
       OR conta_id       IS DISTINCT FROM NEW.conta_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_transacao_dividendo ON arqvalor.transacoes;

CREATE TRIGGER trg_sync_transacao_dividendo
  AFTER UPDATE OF valor, data, conta_id ON arqvalor.transacoes
  FOR EACH ROW
  WHEN (NEW.valor    IS DISTINCT FROM OLD.valor
     OR NEW.data     IS DISTINCT FROM OLD.data
     OR NEW.conta_id IS DISTINCT FROM OLD.conta_id)
  EXECUTE FUNCTION arqvalor.fn_sync_transacao_dividendo();

-- Backfill: alinha dividendos que já divergiram da sua transação antes
-- do trigger existir (idempotente).
UPDATE arqvalor.inv_dividendos d
SET    valor          = t.valor,
       data_pagamento = t.data,
       conta_id       = t.conta_id
FROM   arqvalor.transacoes t
WHERE  d.transacao_extrato_id = t.id
  AND  (d.valor          IS DISTINCT FROM t.valor
     OR d.data_pagamento IS DISTINCT FROM t.data
     OR d.conta_id       IS DISTINCT FROM t.conta_id);
