-- ============================================================
-- Extensão da trilha de auditoria para o sistema inteiro
--
-- Motivação: 20260806000004_trilha_auditoria.sql nasceu com escopo mínimo
-- de propósito (só transacoes + inv_operacoes — "por que meu saldo/minha
-- posição mudou?"), com o comentário explícito de que "pode ser estendido
-- do mesmo jeito (é só adicionar o trigger na tabela)". Esta migration faz
-- exatamente isso: liga o mesmo trigger genérico (fn_registrar_trilha_auditoria,
-- já existente, sem mudanças) em todas as demais tabelas de dados do
-- usuário, fechando a lacuna apontada numa investigação de duplicação de
-- provento (ago/2026) — sem rastro de "quem mudou o quê", cada bug de
-- reconciliação exigia inspeção manual via SQL Editor.
--
-- Tabelas SEM trigger de trilha, de propósito:
--   • usuarios — não é "dado transacional", é o próprio perfil/preferências
--     do usuário (tutoriais_vistos, ia_configs, avisos/novidades de
--     dividendo mutam a cada login/execução de cron); auditar isso não
--     ajuda a rastrear "por que meu saldo/posição mudou" e geraria uma
--     linha de trilha extra a cada cron de proventos só por tocar
--     inv_dividendos_novidades — ruído, não sinal.
--   • objetivos_progresso — não tem coluna user_id (só objetivo_id), o
--     trigger genérico (que assume NEW.user_id/OLD.user_id) não se aplica
--     sem alteração de schema; fica de fora nesta rodada.
--   • Tabelas compartilhadas sem user_id (cotacoes_ptax, cotacoes_ativos,
--     indices_economicos, cotacoes_tesouro, inv_proventos_fundo,
--     inv_etf_holdings, app_releases, cron_execucoes, idempotency_keys,
--     a própria trilha_auditoria) — não são dado de um usuário específico.
--
-- Idempotente: DROP/CREATE TRIGGER, DO/EXCEPTION, CREATE OR REPLACE.
-- ============================================================

-- ── Triggers novos ────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'contas', 'categorias',
    'lembretes', 'filtros_salvos', 'assistente_lancamentos',
    'objetivos',
    'inv_ativos', 'inv_alocacoes_tipo', 'inv_posicoes', 'inv_dividendos',
    'inv_historico_mensal', 'inv_tipos_dividendo', 'inv_questionarios', 'inv_avaliacoes',
    'fatura_import_sessao', 'fatura_import_item'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_trilha_auditoria ON arqvalor.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_trilha_auditoria AFTER INSERT OR UPDATE OR DELETE ON arqvalor.%I '
      'FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_registrar_trilha_auditoria()', t);
  END LOOP;
END $$;

-- ── RLS: admin enxerga a trilha de TODOS os usuários ──────────
-- Policy adicional (permissiva) — soma-se à trilha_auditoria_select_own já
-- existente (Postgres faz OR entre policies permissivas do mesmo comando).
-- Usuário comum continua só vendo a própria trilha; admin vê tudo. Mesmo
-- padrão de cron_execucoes_admin_select (20260806000002).
DO $$ BEGIN
  CREATE POLICY trilha_auditoria_admin_select ON arqvalor.trilha_auditoria
    FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM arqvalor.usuarios u
      WHERE u.id = auth.uid() AND u.admin = true
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── fn_excluir_dados_usuario: desligar o trigger novo antes de apagar ──
-- Mesmo raciocínio já documentado em 20260806000004 para inv_operacoes:
-- sem desligar o trigger nas tabelas recém-auditadas, cada DELETE abaixo
-- recriaria uma linha em trilha_auditoria DEPOIS da limpeza da trilha (que
-- roda logo no início da função), deixando linha órfã que travaria o
-- DELETE final de usuarios (FK RESTRICT). contas/categorias/transacoes/
-- inv_operacoes já estavam cobertos pelas linhas DISABLE/ENABLE existentes.
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
  ALTER TABLE arqvalor.inv_operacoes DISABLE TRIGGER USER;

  -- Tabelas recém-auditadas por esta migration (ver comentário acima).
  ALTER TABLE arqvalor.lembretes              DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.filtros_salvos         DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.assistente_lancamentos DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.objetivos              DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_ativos             DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_alocacoes_tipo     DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_posicoes           DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_dividendos         DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_historico_mensal   DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_tipos_dividendo    DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_questionarios      DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_avaliacoes         DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.fatura_import_sessao   DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.fatura_import_item     DISABLE TRIGGER USER;

  -- Trilha de auditoria primeiro — referencia usuarios diretamente (FK
  -- RESTRICT) e também as demais tabelas indiretamente via registro_id
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

  ALTER TABLE arqvalor.lembretes              ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.filtros_salvos         ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.assistente_lancamentos ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.objetivos              ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_ativos             ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_alocacoes_tipo     ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_posicoes           ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_dividendos         ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_historico_mensal   ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_tipos_dividendo    ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_questionarios      ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.inv_avaliacoes         ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.fatura_import_sessao   ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.fatura_import_item     ENABLE TRIGGER USER;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;
