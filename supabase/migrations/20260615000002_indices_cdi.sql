-- ============================================================
-- Inclui o CDI em arqvalor.indices_economicos
--
-- A migration 20260615000001 criou a tabela com CHECK (indice IN
-- ('IPCA','SELIC')). Para bancos que já a aplicaram, o CREATE TABLE
-- IF NOT EXISTS não re-roda — então o CHECK precisa ser recriado aqui
-- para liberar o valor 'CDI' (série SGS 4391, acumulada no mês).
--
-- Idempotente: dropa o constraint pelo nome padrão (auto-gerado pelo
-- Postgres para CHECK de coluna) e recria com a lista completa.
-- ============================================================

ALTER TABLE arqvalor.indices_economicos
    DROP CONSTRAINT IF EXISTS indices_economicos_indice_check;

ALTER TABLE arqvalor.indices_economicos
    ADD CONSTRAINT indices_economicos_indice_check
    CHECK (indice IN ('IPCA', 'SELIC', 'CDI'));
