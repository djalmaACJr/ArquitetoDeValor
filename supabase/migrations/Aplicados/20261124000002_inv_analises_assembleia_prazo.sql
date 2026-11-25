-- Assembleias de FIIs (v8.0.0): data/hora estruturada do prazo para votar à distância,
-- para o calendário do Dashboard. `prazo_voto` (texto livre da IA) continua para exibição.
ALTER TABLE arqvalor.inv_analises_assembleia
    ADD COLUMN IF NOT EXISTS prazo_voto_em TIMESTAMPTZ;
