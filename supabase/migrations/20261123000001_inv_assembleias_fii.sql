-- ============================================================
-- Assembleias de FIIs (v8.0.0 — fase 1)
--
-- Fonte: Fundos.NET (B3), categoria "Assembleia" (id 2). Espécies de convocação
-- (Edital de Convocação, Proposta do Administrador, Carta Consulta) trazem em
-- `dataReferencia` a data/hora da assembleia. Um passo do cron diário
-- `relatorios-fii-diario` cacheia os metadados (tabela COMPARTILHADA) e, para quem
-- ligou a análise automática (usuarios.inv_relatorios_auto), pede à IA do próprio
-- usuário um resumo: quando, como votar, prazo e pauta em linguagem simples.
--
--   inv_assembleias_fii       compartilhada, sem user_id (escrita só service_role)
--   inv_analises_assembleia   por usuário (RLS user_id = auth.uid()); dado derivado,
--                             apagado em cascata com o usuário/ativo (como inv_analises_relatorio)
--
-- Sem cron novo: reaproveita o agendamento existente.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_assembleias_fii (
    id              BIGINT      PRIMARY KEY,            -- id do documento no Fundos.NET
    fundo_nome      TEXT        NOT NULL,
    fundo_pregao    TEXT,
    tipo            TEXT        NOT NULL,               -- AGO | AGE | AGO/E
    especie         TEXT        NOT NULL,               -- Edital de Convocação | Proposta do Administrador | Carta Consulta
    data_evento     TIMESTAMPTZ,                        -- data/hora da assembleia (ou da apuração, na consulta formal)
    data_entrega    TIMESTAMPTZ NOT NULL,
    url_documento   TEXT        NOT NULL,
    texto           TEXT,
    texto_status    TEXT        NOT NULL DEFAULT 'PENDENTE'
                    CHECK (texto_status IN ('PENDENTE', 'OK', 'ERRO')),
    baixado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_assembleias_fii_evento
    ON arqvalor.inv_assembleias_fii (data_evento DESC);
CREATE INDEX IF NOT EXISTS idx_inv_assembleias_fii_entrega
    ON arqvalor.inv_assembleias_fii (data_entrega DESC);

ALTER TABLE arqvalor.inv_assembleias_fii ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'inv_assembleias_fii'
          AND policyname = 'inv_assembleias_fii_select'
    ) THEN
        CREATE POLICY inv_assembleias_fii_select ON arqvalor.inv_assembleias_fii
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

GRANT SELECT                         ON arqvalor.inv_assembleias_fii TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_assembleias_fii TO service_role;

-- ── Análises por usuário ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arqvalor.inv_analises_assembleia (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ativo_id         UUID        NOT NULL REFERENCES arqvalor.inv_ativos(id) ON DELETE CASCADE,
    assembleia_id    BIGINT      NOT NULL REFERENCES arqvalor.inv_assembleias_fii(id) ON DELETE CASCADE,
    data_evento      TIMESTAMPTZ,
    relevancia       TEXT        NOT NULL CHECK (relevancia IN ('ROTINA', 'IMPORTANTE')),
    resumo           TEXT        NOT NULL,
    quando           TEXT,                               -- "09/12/2026 às 18h"
    como_participar  TEXT,                               -- presencial/virtual/consulta formal + como votar
    prazo_voto       TEXT,                               -- até quando dá para votar à distância
    pauta            JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{item, explicacao}]
    pontos_atencao   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    provedor         TEXT,
    modelo           TEXT,
    mentor_nome      TEXT,
    origem           TEXT        NOT NULL DEFAULT 'MANUAL' CHECK (origem IN ('CRON', 'MANUAL')),
    visto_em         TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_inv_analise_assembleia UNIQUE (user_id, ativo_id, assembleia_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_analises_assembleia_user
    ON arqvalor.inv_analises_assembleia (user_id, data_evento DESC);
CREATE INDEX IF NOT EXISTS idx_inv_analises_assembleia_ativo
    ON arqvalor.inv_analises_assembleia (ativo_id);
CREATE INDEX IF NOT EXISTS idx_inv_analises_assembleia_assembleia
    ON arqvalor.inv_analises_assembleia (assembleia_id);

ALTER TABLE arqvalor.inv_analises_assembleia ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'arqvalor' AND tablename = 'inv_analises_assembleia'
          AND policyname = 'inv_analises_assembleia_dono'
    ) THEN
        CREATE POLICY inv_analises_assembleia_dono ON arqvalor.inv_analises_assembleia
            FOR ALL TO authenticated
            USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_analises_assembleia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_analises_assembleia TO service_role;
