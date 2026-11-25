-- ============================================================
-- E-mail de entrada (v8.0.0) — retenção configurável POR USUÁRIO + limpeza automática
--
-- • inv_email_enderecos.retencao_dias: quantos dias as mensagens da caixa de entrada ficam
--   guardadas (padrão 90; o usuário escolhe de 7 a 365). Editável pelo dono (UPDATE de coluna).
-- • fn_email_purgar_mensagens(): apaga as mensagens mais antigas que a retenção de cada dono
--   (sem endereço cadastrado vale o padrão de 90 dias). Só service_role — chamada pelo cron diário
--   `relatorios-fii-diario`, que não tem usuário logado.
-- ============================================================

ALTER TABLE arqvalor.inv_email_enderecos
    ADD COLUMN IF NOT EXISTS retencao_dias INTEGER NOT NULL DEFAULT 90
    CHECK (retencao_dias BETWEEN 7 AND 365);

-- Dono pode ligar/desligar e escolher a retenção; apelido e código continuam só pelas RPCs.
GRANT UPDATE (ativo, retencao_dias) ON arqvalor.inv_email_enderecos TO authenticated;

CREATE OR REPLACE FUNCTION arqvalor.fn_email_purgar_mensagens()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE v_com INTEGER; v_sem INTEGER;
BEGIN
    DELETE FROM arqvalor.inv_email_mensagens m
     USING arqvalor.inv_email_enderecos e
     WHERE e.user_id = m.user_id
       AND m.recebido_em < NOW() - make_interval(days => e.retencao_dias);
    GET DIAGNOSTICS v_com = ROW_COUNT;

    DELETE FROM arqvalor.inv_email_mensagens m
     WHERE NOT EXISTS (SELECT 1 FROM arqvalor.inv_email_enderecos e WHERE e.user_id = m.user_id)
       AND m.recebido_em < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_sem = ROW_COUNT;

    RETURN v_com + v_sem;
END $$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_email_purgar_mensagens() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_email_purgar_mensagens() TO service_role;
