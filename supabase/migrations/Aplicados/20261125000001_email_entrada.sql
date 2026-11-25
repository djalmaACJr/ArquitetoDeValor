-- ============================================================
-- E-mail de entrada por usuário (v8.0.0 — fase 2, fundação)
--
-- Cada usuário ganha um endereço próprio `apelido-codigo@entrada.<domínio>` para onde
-- encaminha os e-mails de administradoras/B3. Um webhook (Edge Function `entrada_email`,
-- chamada pelo provedor de e-mail de entrada) resolve o usuário pelo código do destinatário,
-- aplica a lista de remetentes permitidos e grava a mensagem.
--
--   inv_email_enderecos    1 por usuário (apelido + código secreto); criado/renovado só pelas RPCs
--   inv_email_remetentes   remetentes permitidos/bloqueados do usuário ('a@b.com' ou '@dominio.com')
--   inv_email_mensagens    caixa de entrada: assunto + resumo. O CORPO NÃO é guardado
--                          (só um trecho curto, e só das mensagens em quarentena, para o usuário decidir)
--
-- Tudo por usuário com RLS dono; mensagens só entram pelo webhook (service_role — não é rota de usuário).
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_email_enderecos (
    user_id     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    apelido     TEXT        NOT NULL CHECK (apelido ~ '^[a-z0-9]{3,20}$'),
    codigo      TEXT        NOT NULL UNIQUE CHECK (codigo ~ '^[0-9a-f]{16}$'),
    ativo       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE arqvalor.inv_email_enderecos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'arqvalor' AND tablename = 'inv_email_enderecos' AND policyname = 'inv_email_enderecos_dono') THEN
        CREATE POLICY inv_email_enderecos_dono ON arqvalor.inv_email_enderecos
            FOR SELECT TO authenticated USING (user_id = auth.uid());
        CREATE POLICY inv_email_enderecos_dono_upd ON arqvalor.inv_email_enderecos
            FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
END $$;
-- O usuário só pode LIGAR/DESLIGAR (ativo); apelido e código só mudam pelas RPCs abaixo.
REVOKE ALL ON arqvalor.inv_email_enderecos FROM authenticated;
GRANT SELECT ON arqvalor.inv_email_enderecos TO authenticated;
GRANT UPDATE (ativo) ON arqvalor.inv_email_enderecos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_email_enderecos TO service_role;

-- ── Remetentes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arqvalor.inv_email_remetentes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    padrao      TEXT        NOT NULL CHECK (padrao = lower(padrao) AND padrao ~ '^[a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$'),
    status      TEXT        NOT NULL CHECK (status IN ('PERMITIDO', 'BLOQUEADO')),
    origem      TEXT        NOT NULL DEFAULT 'USUARIO' CHECK (origem IN ('PADRAO', 'USUARIO', 'APROVADO')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_inv_email_remetente UNIQUE (user_id, padrao)
);
ALTER TABLE arqvalor.inv_email_remetentes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'arqvalor' AND tablename = 'inv_email_remetentes' AND policyname = 'inv_email_remetentes_dono') THEN
        CREATE POLICY inv_email_remetentes_dono ON arqvalor.inv_email_remetentes
            FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_email_remetentes TO authenticated, service_role;

-- ── Caixa de entrada ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arqvalor.inv_email_mensagens (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message_id    TEXT        NOT NULL,                  -- Message-ID do e-mail (evita duplicata em reenvio do webhook)
    remetente     TEXT        NOT NULL,
    assunto       TEXT        NOT NULL DEFAULT '',
    recebido_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status        TEXT        NOT NULL CHECK (status IN ('PENDENTE', 'PROCESSADO', 'QUARENTENA', 'IGNORADO', 'ERRO')),
    classificacao TEXT,                                  -- ex.: ASSEMBLEIA, RENDIMENTO, FATO_RELEVANTE, OUTRO
    resumo        TEXT,
    trecho        TEXT,                                  -- só em QUARENTENA (curto), p/ o usuário decidir
    ativo_id      UUID        REFERENCES arqvalor.inv_ativos(id) ON DELETE SET NULL,
    visto_em      TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_inv_email_mensagem UNIQUE (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_email_mensagens_user ON arqvalor.inv_email_mensagens (user_id, recebido_em DESC);
CREATE INDEX IF NOT EXISTS idx_inv_email_mensagens_ativo ON arqvalor.inv_email_mensagens (ativo_id);

ALTER TABLE arqvalor.inv_email_mensagens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'arqvalor' AND tablename = 'inv_email_mensagens' AND policyname = 'inv_email_mensagens_dono') THEN
        CREATE POLICY inv_email_mensagens_dono ON arqvalor.inv_email_mensagens
            FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
END $$;
-- Mensagens só ENTRAM pelo webhook (service_role); o usuário lê, marca como vista e apaga.
REVOKE ALL ON arqvalor.inv_email_mensagens FROM authenticated;
GRANT SELECT, DELETE ON arqvalor.inv_email_mensagens TO authenticated;
GRANT UPDATE (visto_em, status) ON arqvalor.inv_email_mensagens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_email_mensagens TO service_role;

-- ── RPCs: criar e renovar o endereço (o código nasce no servidor) ──────
CREATE OR REPLACE FUNCTION arqvalor.fn_email_criar_endereco(p_apelido TEXT)
RETURNS TABLE(apelido TEXT, codigo TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE v_uid UUID := auth.uid(); v_ap TEXT := lower(btrim(coalesce(p_apelido, '')));
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
    IF v_ap !~ '^[a-z0-9]{3,20}$' THEN RAISE EXCEPTION 'APELIDO_INVALIDO' USING DETAIL = 'Use de 3 a 20 letras minúsculas e números.'; END IF;
    INSERT INTO arqvalor.inv_email_enderecos AS e (user_id, apelido, codigo)
    VALUES (v_uid, v_ap, substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
    ON CONFLICT (user_id) DO NOTHING;
    RETURN QUERY SELECT e.apelido, e.codigo FROM arqvalor.inv_email_enderecos e WHERE e.user_id = v_uid;
END $$;

-- Código vazou (ou spam)? Gera outro; o endereço antigo deixa de funcionar na hora.
CREATE OR REPLACE FUNCTION arqvalor.fn_email_renovar_codigo()
RETURNS TABLE(apelido TEXT, codigo TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
    UPDATE arqvalor.inv_email_enderecos e
       SET codigo = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
     WHERE e.user_id = v_uid;
    RETURN QUERY SELECT e.apelido, e.codigo FROM arqvalor.inv_email_enderecos e WHERE e.user_id = v_uid;
END $$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_email_criar_endereco(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_email_renovar_codigo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_email_criar_endereco(TEXT) TO authenticated;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_email_renovar_codigo() TO authenticated;
