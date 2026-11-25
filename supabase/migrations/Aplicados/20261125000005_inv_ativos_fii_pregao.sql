-- FIIs (v8.0.1): nome de pregão do fundo na B3 (ex.: "FII XP MALLS"), usado para casar o ativo
-- com os relatórios gerenciais e as assembleias do Fundos.NET (que usam o mesmo pregão).
-- Preenchido sob demanda pela edge function `investimentos` a partir da B3; NULL = ainda não resolvido.
ALTER TABLE arqvalor.inv_ativos
    ADD COLUMN IF NOT EXISTS fii_pregao TEXT;
