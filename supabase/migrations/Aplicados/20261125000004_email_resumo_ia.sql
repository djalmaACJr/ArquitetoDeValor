-- E-mail de entrada (v8.0.0): resumo por IA dos e-mails de remetentes PERMITIDOS.
-- `resumo_ia` liga/desliga por usuário (padrão ligado). O resumo usa a chave de IA do próprio usuário
-- (consome tokens), com teto diário aplicado no webhook (MAX_RESUMOS_POR_DIA).
ALTER TABLE arqvalor.inv_email_enderecos
    ADD COLUMN IF NOT EXISTS resumo_ia BOOLEAN NOT NULL DEFAULT TRUE;

GRANT UPDATE (resumo_ia) ON arqvalor.inv_email_enderecos TO authenticated;

-- Teto diário por usuário: conta resumos gerados nas últimas 24h.
CREATE INDEX IF NOT EXISTS idx_inv_email_mensagens_resumo
    ON arqvalor.inv_email_mensagens (user_id, created_at DESC) WHERE resumo IS NOT NULL;
