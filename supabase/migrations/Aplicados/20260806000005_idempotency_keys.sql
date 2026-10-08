-- ============================================================
-- idempotency_keys — proteção contra duplicação em endpoints financeiros
-- de criação (achado de auditoria AUD-06)
--
-- Antes, POST /transacoes e POST /transferencias não tinham nenhuma
-- proteção de idempotência — só o botão "Salvar" desabilitado no client
-- durante o envio, o que não cobre um retry de rede real (requisição que
-- chega e cria o registro, mas a resposta se perde, e o cliente reenvia).
-- Mais relevante no app Android, onde conexão móvel instável é mais comum.
--
-- Cache transitório de dedup: guarda a resposta da 1ª execução de uma
-- chave, pra qualquer repetição da MESMA chave devolver o mesmo resultado
-- em vez de criar um registro duplicado. A UNIQUE (user_id, rota, chave)
-- também serializa tentativas CONCORRENTES com a mesma chave (2 cliques
-- quase simultâneos) — a 2ª tentativa esbarra na constraint antes de
-- conseguir criar nada.
--
-- ON DELETE CASCADE (não RESTRICT, ao contrário de trilha_auditoria): isto
-- é cache, não registro permanente — pode desaparecer junto com o usuário
-- sem cerimônia.
--
-- Idempotente: CREATE TABLE/POLICY IF NOT EXISTS, DO/EXCEPTION.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.idempotency_keys (
  user_id     UUID        NOT NULL REFERENCES arqvalor.usuarios(id) ON DELETE CASCADE,
  rota        TEXT        NOT NULL,
  chave       TEXT        NOT NULL,
  status_code INTEGER,
  resposta    JSONB,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, rota, chave)
);

ALTER TABLE arqvalor.idempotency_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY idempotency_keys_user ON arqvalor.idempotency_keys
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON arqvalor.idempotency_keys TO authenticated;
