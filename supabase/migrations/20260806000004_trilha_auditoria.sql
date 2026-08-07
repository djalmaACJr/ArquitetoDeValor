-- ============================================================
-- Trilha de auditoria mínima (append-only) — achado de auditoria AUD-04
--
-- Motivação: a única tabela de auditoria que o sistema já teve foi
-- removida em 20260523000002 por estar sem nenhum produtor de dados (nunca
-- foi conectada a um trigger, 0 registros em 7 semanas). Nada a substituiu
-- desde então — hoje não há como reconstruir "quem alterou o quê, quando"
-- numa transação ou operação de investimento a partir da própria aplicação.
-- Aprendendo com o erro anterior: esta versão já nasce conectada a
-- triggers reais (não é uma tabela "pra usar depois").
--
-- Escopo mínimo, de propósito: só `transacoes` (cobre lançamentos E
-- transferências, que são linhas de transacoes com id_par_transferencia) e
-- `inv_operacoes` (compra/venda/aporte/resgate/dividendo/rendimento) — as
-- duas fontes de "por que meu saldo/minha posição mudou?". Não cobre
-- contas/categorias/objetivos nesta 1ª versão; pode ser estendido do mesmo
-- jeito (é só adicionar o trigger na tabela).
--
-- Append-only de verdade: RLS não tem policy de UPDATE/DELETE pra ninguém,
-- e a ÚNICA policy de INSERT é o trigger em si (roda como owner da função,
-- SECURITY DEFINER) — nem authenticated nem service_role inserem direto.
-- SELECT é só pro próprio dono do registro (user_id = auth.uid()), mesmo
-- padrão RLS de qualquer outra tabela de domínio.
--
-- Idempotente: CREATE TABLE/POLICY/TRIGGER IF NOT EXISTS, DO/EXCEPTION.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.trilha_auditoria (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES arqvalor.usuarios(id) ON DELETE RESTRICT,
  tabela        TEXT        NOT NULL,
  operacao      TEXT        NOT NULL CHECK (operacao IN ('INSERT', 'UPDATE', 'DELETE')),
  registro_id   UUID        NOT NULL,
  dados_antigos JSONB,
  dados_novos   JSONB,
  alterado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trilha_auditoria_user_registro
  ON arqvalor.trilha_auditoria(user_id, registro_id, alterado_em DESC);

ALTER TABLE arqvalor.trilha_auditoria ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY trilha_auditoria_select_own ON arqvalor.trilha_auditoria
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sem policy de INSERT/UPDATE/DELETE para anon/authenticated/service_role
-- — só o trigger (SECURITY DEFINER, roda como owner da tabela) grava.
GRANT SELECT ON arqvalor.trilha_auditoria TO authenticated;

-- ── Trigger genérico ──────────────────────────────────────────
-- Um único trigger function reusável em qualquer tabela com coluna
-- `user_id` e chave primária `id`. Grava o snapshot ANTES (UPDATE/DELETE)
-- e/ou DEPOIS (INSERT/UPDATE) como JSONB — suficiente pra reconstruir "o
-- que mudou" sem precisar de um formato de diff mais sofisticado.
CREATE OR REPLACE FUNCTION arqvalor.fn_registrar_trilha_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO arqvalor.trilha_auditoria (user_id, tabela, operacao, registro_id, dados_novos)
    VALUES (NEW.user_id, TG_TABLE_NAME, 'INSERT', NEW.id, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO arqvalor.trilha_auditoria (user_id, tabela, operacao, registro_id, dados_antigos, dados_novos)
    VALUES (NEW.user_id, TG_TABLE_NAME, 'UPDATE', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO arqvalor.trilha_auditoria (user_id, tabela, operacao, registro_id, dados_antigos)
    VALUES (OLD.user_id, TG_TABLE_NAME, 'DELETE', OLD.id, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_registrar_trilha_auditoria() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trilha_auditoria ON arqvalor.transacoes;
CREATE TRIGGER trg_trilha_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON arqvalor.transacoes
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_registrar_trilha_auditoria();

DROP TRIGGER IF EXISTS trg_trilha_auditoria ON arqvalor.inv_operacoes;
CREATE TRIGGER trg_trilha_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON arqvalor.inv_operacoes
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_registrar_trilha_auditoria();

-- ── Limpeza ao excluir conta ──────────────────────────────────
-- fn_excluir_dados_usuario precisa apagar a trilha também (FK RESTRICT
-- bloquearia o DELETE de usuarios sem isso) — mesmo padrão das outras
-- tabelas dependentes já tratadas ali.
CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_dados_usuario(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_role      TEXT := current_user;
  v_auth_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
BEGIN
  IF v_role NOT IN ('postgres','supabase_admin') AND v_auth_role <> 'service_role' THEN
    IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'ACESSO_NEGADO'
        USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
    END IF;
  END IF;

  ALTER TABLE arqvalor.categorias    DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.transacoes    DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.contas        DISABLE TRIGGER USER;
  -- inv_operacoes também tem o trigger de trilha_auditoria (novo nesta
  -- migration) — sem desligar aqui, o DELETE de inv_operacoes abaixo
  -- recriaria entradas em trilha_auditoria DEPOIS do DELETE dela logo a
  -- seguir, deixando linha órfã que travaria o DELETE de usuarios no fim
  -- (FK RESTRICT). transacoes já cobre o mesmo risco pro lado financeiro.
  ALTER TABLE arqvalor.inv_operacoes DISABLE TRIGGER USER;

  -- Trilha de auditoria primeiro — referencia usuarios diretamente (FK
  -- RESTRICT) e também transacoes/inv_operacoes indiretamente via registro_id
  -- (sem FK formal ali, mas semanticamente já não faz sentido manter
  -- entradas de auditoria de linhas que estão prestes a deixar de existir).
  DELETE FROM arqvalor.trilha_auditoria WHERE user_id = p_user_id;

  DELETE FROM arqvalor.fatura_import_item   WHERE user_id = p_user_id;
  DELETE FROM arqvalor.fatura_import_sessao WHERE user_id = p_user_id;

  DELETE FROM arqvalor.inv_historico_mensal WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_dividendos       WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_operacoes        WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_posicoes         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_alocacoes_tipo   WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_avaliacoes       WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_questionarios    WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_proventos_fundo  WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_tipos_dividendo  WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_ativos           WHERE user_id = p_user_id;

  DELETE FROM arqvalor.objetivos_progresso
    WHERE objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = p_user_id);
  DELETE FROM arqvalor.objetivos            WHERE user_id = p_user_id;

  DELETE FROM arqvalor.lembretes              WHERE user_id = p_user_id;
  DELETE FROM arqvalor.filtros_salvos         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.assistente_lancamentos WHERE user_id = p_user_id;

  DELETE FROM arqvalor.transacoes WHERE user_id = p_user_id;

  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id AND id_pai IS NOT NULL;
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id AND id_pai IS NULL;

  DELETE FROM arqvalor.contas     WHERE user_id = p_user_id;

  DELETE FROM arqvalor.usuarios   WHERE id = p_user_id;

  ALTER TABLE arqvalor.categorias    ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.transacoes    ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.contas        ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_operacoes ENABLE TRIGGER USER;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;
