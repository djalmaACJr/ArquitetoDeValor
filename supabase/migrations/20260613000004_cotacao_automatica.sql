-- ============================================================
-- inv_ativos.cotacao_automatica — opção "não buscar cotações deste ativo".
--
-- Quando FALSE, o ativo é PULADO pela captura automática (snapshot-auto),
-- pelo backfill e pelo job diário, e sai do aviso de lacuna no front. Útil
-- para ativos sem fonte gratuita de cotação (ex.: FIIs pequenos, papéis
-- deslistados) — o ativo permanece na carteira, valorado pelo último valor
-- registrado manualmente.
--
-- Default TRUE: todos os ativos existentes continuam buscando cotação.
-- ============================================================

ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS cotacao_automatica BOOLEAN NOT NULL DEFAULT TRUE;
