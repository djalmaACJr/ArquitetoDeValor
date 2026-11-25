-- Assembleias de FIIs (v8.0.0): endereços web e e-mails citados no documento oficial
-- ([{tipo:'link'|'email', valor}]), extraídos do texto do PDF, para o cartão mostrar o caminho de voto.
ALTER TABLE arqvalor.inv_assembleias_fii
    ADD COLUMN IF NOT EXISTS links JSONB;
