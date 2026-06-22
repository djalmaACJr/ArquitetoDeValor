-- ============================================================
-- Trigger: mantém inv_dividendos.tipo_ativo em sincronia com inv_ativos
-- ============================================================
-- inv_dividendos.tipo_ativo é uma cópia desnormalizada de
-- inv_ativos.tipo_ativo, gravada na criação/importação do dividendo. Quando
-- o tipo do ativo é corrigido depois (ex.: DIVD11 importado como FII e
-- reclassificado), os dividendos antigos ficavam com o tipo defasado e o
-- ativo aparecia na categoria errada na página de Dividendos / dashboard.
--
-- O backfill de 20260613000001 corrigia só uma vez; correções feitas DEPOIS
-- dele voltavam a divergir. Este trigger torna a sincronização permanente:
-- toda vez que inv_ativos.tipo_ativo muda, propaga para os dividendos do
-- ativo — independentemente da origem (edge function, SQL direto, import).
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_sync_dividendo_tipo_ativo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE arqvalor.inv_dividendos
  SET    tipo_ativo = NEW.tipo_ativo
  WHERE  ativo_id = NEW.id
    AND  tipo_ativo IS DISTINCT FROM NEW.tipo_ativo;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_dividendo_tipo_ativo ON arqvalor.inv_ativos;

CREATE TRIGGER trg_sync_dividendo_tipo_ativo
  AFTER UPDATE OF tipo_ativo ON arqvalor.inv_ativos
  FOR EACH ROW
  WHEN (NEW.tipo_ativo IS DISTINCT FROM OLD.tipo_ativo)
  EXECUTE FUNCTION arqvalor.fn_sync_dividendo_tipo_ativo();

-- Backfill imediato: alinha o que já estiver divergente agora (idempotente).
UPDATE arqvalor.inv_dividendos d
SET    tipo_ativo = a.tipo_ativo
FROM   arqvalor.inv_ativos a
WHERE  d.ativo_id = a.id
  AND  d.tipo_ativo IS DISTINCT FROM a.tipo_ativo;
