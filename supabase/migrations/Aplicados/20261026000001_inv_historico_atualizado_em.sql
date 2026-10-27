-- Data/hora da última cotação gravada no snapshot mensal (exibida no card
-- "Valor atual cota" da página do ativo). Preenchida por gravarSnapshot
-- (captura automática / "Atualizar cotação" / cron); linhas antigas herdam
-- created_at.
ALTER TABLE arqvalor.inv_historico_mensal
    ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;

UPDATE arqvalor.inv_historico_mensal
   SET atualizado_em = created_at
 WHERE atualizado_em IS NULL;
