-- ============================================================
-- E-mail de entrada (v8.2.0): ver o e-mail na íntegra e abrir no Gmail.
--
--  • inv_email_enderecos.guardar_corpo  (padrão FALSE — opt-in): com ele ligado, o webhook guarda o texto
--    (higienizado, até 20 mil caracteres) das mensagens de remetentes PERMITIDOS. Desligar apaga os corpos já guardados.
--  • inv_email_enderecos.abrir_no_gmail (padrão FALSE): mostra o atalho "Abrir no Gmail" (busca pelo Message-ID).
--  • inv_email_mensagens.corpo / tem_corpo: o texto fica fora da listagem (a rota só o devolve em GET /mensagens/:id/corpo);
--    `tem_corpo` é a coluna gerada que a listagem usa para saber se há o que mostrar.
-- Retenção e RLS são as já existentes (dono; purga por retencao_dias apaga a linha inteira, corpo incluído).
-- ============================================================
ALTER TABLE arqvalor.inv_email_enderecos
    ADD COLUMN IF NOT EXISTS guardar_corpo  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS abrir_no_gmail BOOLEAN NOT NULL DEFAULT FALSE;

GRANT UPDATE (guardar_corpo, abrir_no_gmail) ON arqvalor.inv_email_enderecos TO authenticated;

ALTER TABLE arqvalor.inv_email_mensagens
    ADD COLUMN IF NOT EXISTS corpo TEXT;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'arqvalor' AND table_name = 'inv_email_mensagens' AND column_name = 'tem_corpo') THEN
        ALTER TABLE arqvalor.inv_email_mensagens
            ADD COLUMN tem_corpo BOOLEAN GENERATED ALWAYS AS (corpo IS NOT NULL) STORED;
    END IF;
END $$;

-- O dono só pode LIMPAR o corpo (ao desligar a opção); quem grava é o webhook (service_role).
GRANT UPDATE (corpo) ON arqvalor.inv_email_mensagens TO authenticated;
