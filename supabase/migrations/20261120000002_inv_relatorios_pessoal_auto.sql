-- ============================================================
-- Análise automática (cron) também gera a etapa 2 "Para você" (v7.9.0)
-- Opt-in separado e subordinado a `inv_relatorios_auto`: só tem efeito com a análise
-- automática ligada. Gasta uma 2ª chamada de IA por análise nova, na chave do usuário.
-- ============================================================
ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS inv_relatorios_pessoal_auto BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN arqvalor.usuarios.inv_relatorios_pessoal_auto IS
    'Só vale com inv_relatorios_auto = true: o cron também gera a etapa 2 (Para você) de cada análise nova.';
