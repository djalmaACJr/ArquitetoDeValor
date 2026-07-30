-- Releases OTA do app Android (Capacitor + @capgo/capacitor-updater).
-- Não é dado de usuário (sem user_id) — metadado global do app, servido
-- publicamente pela edge function `app_updates` (sem sessão/JWT).
DO $$ BEGIN

  CREATE TABLE IF NOT EXISTS arqvalor.app_releases (
    id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    plataforma TEXT        NOT NULL DEFAULT 'android',
    canal      TEXT        NOT NULL DEFAULT 'production',
    versao     TEXT        NOT NULL,
    bundle_url TEXT        NOT NULL,
    checksum   TEXT        NOT NULL,
    notas      TEXT,
    ativo      BOOLEAN     NOT NULL DEFAULT true,
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_app_releases_versao CHECK (length(trim(versao)) > 0)
  );

EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- RLS: leitura pública (o app nativo consulta sem JWT); escrita só via
-- service_role (dbAdmin), publicada pelo script de release, nunca pela API.
ALTER TABLE arqvalor.app_releases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_releases_leitura_publica ON arqvalor.app_releases
    FOR SELECT USING (ativo = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_app_releases_plataforma_canal
  ON arqvalor.app_releases(plataforma, canal, criado_em DESC);

GRANT SELECT ON arqvalor.app_releases TO anon, authenticated;

-- Bucket público pros zips de bundle (upload só via service_role no script
-- de publish — sem policy de INSERT pra anon/authenticated, que ficam
-- bloqueados por padrão).
INSERT INTO storage.buckets (id, name, public)
VALUES ('app-releases', 'app-releases', true)
ON CONFLICT (id) DO NOTHING;
