-- ============================================================
-- Importação de fatura de cartão — reconciliação do schema (2026-08-04)
--
-- Este arquivo ocupava originalmente a criação de `fatura_import_sessao`/
-- `fatura_import_item`, mas seu conteúdo foi corrompido para a string
-- literal "f1 o" (5 bytes) em todo o histórico do git e, posteriormente,
-- o arquivo foi deletado por completo (commit "test"). O DDL original
-- nunca existiu em nenhum outro arquivo versionado — migrations
-- posteriores (20260527000002, 20260530000002/3, 20260709000001) fazem
-- ALTER TABLE nessas duas tabelas assumindo que já existem, então um banco
-- novo restaurado do zero a partir de `supabase/migrations/` falhava nelas.
--
-- Este arquivo reconstrói o schema real por evidência indireta (código de
-- `supabase/functions/faturas/index.ts`, as próprias migrations ALTER
-- supracitadas, tipos do frontend e `ARCHITECTURE.md`), incluindo já as
-- colunas que as migrations seguintes adicionariam — elas continuam no
-- histórico com seus `IF NOT EXISTS`/checagem em information_schema e
-- viram no-op ao rodar depois desta (mantém o histórico idempotente).
--
-- Também recria `trg_validar_conta_cartao_fatura`, mencionada em comentário
-- em `faturas/index.ts:285` ("Trigger ... bloqueia se conta não for
-- CARTAO") mas cuja migration nunca existiu no repo — sem ela, nada
-- impedia criar uma sessão de importação contra uma conta CORRENTE/
-- REMUNERAÇÃO/etc.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, DROP TRIGGER/POLICY IF EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.fatura_import_sessao (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES arqvalor.usuarios(id) ON DELETE CASCADE,
  conta_id            UUID        NOT NULL REFERENCES arqvalor.contas(id),
  arquivo_nome        TEXT        NOT NULL,
  vencimento_fatura   DATE,
  valor_total         NUMERIC,
  status              VARCHAR(12) NOT NULL DEFAULT 'EM_ANALISE'
                        CHECK (status IN ('EM_ANALISE', 'CONFIRMADA', 'CANCELADA')),
  observacao          TEXT,
  -- Colunas abaixo pertencem originalmente a 20260530000003 — incluídas
  -- aqui para que essa migration vire no-op idempotente ao rodar depois.
  modo_importacao     VARCHAR(10)
                        CHECK (modo_importacao IS NULL OR modo_importacao IN ('REGISTRO', 'CATEGORIA')),
  separar_por_cartao  BOOLEAN,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS arqvalor.fatura_import_item (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id               UUID        NOT NULL REFERENCES arqvalor.fatura_import_sessao(id) ON DELETE CASCADE,
  user_id                 UUID        NOT NULL REFERENCES arqvalor.usuarios(id) ON DELETE CASCADE,
  data_compra             DATE        NOT NULL,
  descricao               TEXT        NOT NULL,
  estabelecimento         TEXT,
  valor                   NUMERIC     NOT NULL CHECK (valor > 0),
  -- Coluna abaixo pertence originalmente a 20260527000002 — incluída aqui
  -- para que essa migration vire no-op idempotente ao rodar depois.
  tipo                    VARCHAR(10) NOT NULL DEFAULT 'DESPESA'
                            CHECK (tipo IN ('RECEITA', 'DESPESA')),
  parcela_atual           INTEGER,
  parcela_total           INTEGER,
  decisao                 VARCHAR(10) NOT NULL DEFAULT 'PENDENTE'
                            CHECK (decisao IN ('PENDENTE', 'CRIAR', 'ATUALIZAR', 'IGNORAR')),
  categoria_sugerida_id   UUID        REFERENCES arqvalor.categorias(id) ON DELETE SET NULL,
  categoria_escolhida_id  UUID        REFERENCES arqvalor.categorias(id) ON DELETE SET NULL,
  transacao_existente_id  UUID        REFERENCES arqvalor.transacoes(id) ON DELETE SET NULL,
  transacao_criada_id     UUID        REFERENCES arqvalor.transacoes(id) ON DELETE SET NULL,
  hash_match              TEXT,
  observacao              TEXT,
  -- Colunas abaixo pertencem originalmente a 20260530000002 — incluídas
  -- aqui para que essa migration vire no-op idempotente ao rodar depois.
  grupo_chave             TEXT,
  descricao_override      TEXT,
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fatura_import_sessao_user
  ON arqvalor.fatura_import_sessao(user_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_fatura_import_sessao_conta
  ON arqvalor.fatura_import_sessao(conta_id);
CREATE INDEX IF NOT EXISTS idx_fatura_import_item_sessao
  ON arqvalor.fatura_import_item(sessao_id, criado_em ASC);

ALTER TABLE arqvalor.fatura_import_sessao ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqvalor.fatura_import_item    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'arqvalor' AND tablename = 'fatura_import_sessao' AND policyname = 'pol_fatura_sessao_user'
  ) THEN
    CREATE POLICY pol_fatura_sessao_user ON arqvalor.fatura_import_sessao
      USING      (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'arqvalor' AND tablename = 'fatura_import_item' AND policyname = 'pol_fatura_item_user'
  ) THEN
    CREATE POLICY pol_fatura_item_user ON arqvalor.fatura_import_item
      USING      (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- atualizado_em gerenciado por trigger (fn_set_atualizado_em já existe desde 20260403000001).
DROP TRIGGER IF EXISTS trg_fatura_sessao_atualizado_em ON arqvalor.fatura_import_sessao;
CREATE TRIGGER trg_fatura_sessao_atualizado_em
  BEFORE UPDATE ON arqvalor.fatura_import_sessao
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_set_atualizado_em();

DROP TRIGGER IF EXISTS trg_fatura_item_atualizado_em ON arqvalor.fatura_import_item;
CREATE TRIGGER trg_fatura_item_atualizado_em
  BEFORE UPDATE ON arqvalor.fatura_import_item
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_set_atualizado_em();

-- ── trg_validar_conta_cartao_fatura ──────────────────────────────────────
-- Referenciada em comentário em supabase/functions/faturas/index.ts:285
-- ("bloqueia se conta não for CARTAO"), mas nunca existiu como migration —
-- a Edge Function não valida isso em JS, então sem esta trigger nada
-- impedia criar uma sessão de importação contra conta CORRENTE/CARTEIRA/etc.
CREATE OR REPLACE FUNCTION arqvalor.fn_validar_conta_cartao_fatura()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_tipo arqvalor.tipo_conta;
BEGIN
  SELECT tipo INTO v_tipo FROM arqvalor.contas WHERE id = NEW.conta_id;
  IF v_tipo IS DISTINCT FROM 'CARTAO' THEN
    RAISE EXCEPTION 'conta_id deve ser uma conta do tipo CARTAO para importar fatura'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_conta_cartao_fatura ON arqvalor.fatura_import_sessao;
CREATE TRIGGER trg_validar_conta_cartao_fatura
  BEFORE INSERT OR UPDATE OF conta_id ON arqvalor.fatura_import_sessao
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_validar_conta_cartao_fatura();
