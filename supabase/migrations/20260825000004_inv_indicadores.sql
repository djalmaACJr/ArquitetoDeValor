-- ============================================================
-- arqvalor.inv_indicadores — indicadores de mercado (ETF nacional, ETF
-- internacional ou ÍNDICE B3 puro — ex.: SMLL/Small Cap, IBOV/Ibovespa,
-- IFIX...) que o usuário escolhe acompanhar como BENCHMARK de
-- comparação, ao lado dos indicadores econômicos fixos (PTAX/IPCA/
-- SELIC/CDI) na página "Gerenciar dados". Só a LISTA de tickers
-- acompanhados é por usuário — a cotação em si reaproveita a mesma
-- infraestrutura compartilhada (arqvalor.cotacoes_ativos, Yahoo/brapi)
-- já usada pelos ativos da carteira (ver mercado.ts).
--
-- Índice puro (tipo INDICE) é diferente de ETF: não é negociável, então
-- não aparece na busca de tickers (brapi só lista ativos comprÁveis) —
-- a lista de índices suportados é curada no backend (INDICES_B3 em
-- indicadores.ts), não descoberta por busca externa.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_indicadores (
    id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ticker    TEXT        NOT NULL,
    tipo      TEXT        NOT NULL CHECK (tipo IN ('ETF', 'ETF_INTERNACIONAL', 'INDICE')),
    nome      TEXT        NOT NULL,
    moeda     TEXT        NOT NULL DEFAULT 'BRL',
    cor       TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inv_indicadores_user_ticker UNIQUE (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_inv_indicadores_user_id
    ON arqvalor.inv_indicadores(user_id);

-- Upgrade explícito da CHECK (redundante se a tabela acabou de ser criada
-- já com os 3 valores acima, mas necessário se esta migration já tinha
-- rodado antes só com 'ETF'/'ETF_INTERNACIONAL' — CREATE TABLE IF NOT
-- EXISTS não re-aplica o corpo da tabela numa 2ª execução).
ALTER TABLE arqvalor.inv_indicadores DROP CONSTRAINT IF EXISTS inv_indicadores_tipo_check;
ALTER TABLE arqvalor.inv_indicadores ADD CONSTRAINT inv_indicadores_tipo_check
    CHECK (tipo IN ('ETF', 'ETF_INTERNACIONAL', 'INDICE'));

ALTER TABLE arqvalor.inv_indicadores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'arqvalor' AND tablename = 'inv_indicadores' AND policyname = 'inv_indicadores_select') THEN
        CREATE POLICY inv_indicadores_select ON arqvalor.inv_indicadores FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'arqvalor' AND tablename = 'inv_indicadores' AND policyname = 'inv_indicadores_insert') THEN
        CREATE POLICY inv_indicadores_insert ON arqvalor.inv_indicadores FOR INSERT WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'arqvalor' AND tablename = 'inv_indicadores' AND policyname = 'inv_indicadores_delete') THEN
        CREATE POLICY inv_indicadores_delete ON arqvalor.inv_indicadores FOR DELETE USING (user_id = auth.uid());
    END IF;
END $$;

GRANT SELECT, INSERT, DELETE ON arqvalor.inv_indicadores TO authenticated;

-- ============================================================
-- fn_excluir_dados_usuario — inclui inv_indicadores (mesma diligência
-- das demais tabelas inv_*: apagada explicitamente aqui em vez de só
-- confiar no ON DELETE CASCADE de auth.users, que só dispara quando a
-- conta Auth é excluída MAIS TARDE pela API admin — ver comentário na
-- versão anterior desta função, 20260820000001).
-- ============================================================

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
  ALTER TABLE arqvalor.inv_indicadores        DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.fatura_import_sessao   DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.fatura_import_item     DISABLE TRIGGER USER;

  DELETE FROM arqvalor.trilha_auditoria WHERE user_id = p_user_id;

  DELETE FROM arqvalor.fatura_import_item   WHERE user_id = p_user_id;
  DELETE FROM arqvalor.fatura_import_sessao WHERE user_id = p_user_id;

  DELETE FROM arqvalor.inv_indicadores      WHERE user_id = p_user_id;
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
  ALTER TABLE arqvalor.inv_indicadores        ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.fatura_import_sessao   ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.fatura_import_item     ENABLE TRIGGER USER;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;
