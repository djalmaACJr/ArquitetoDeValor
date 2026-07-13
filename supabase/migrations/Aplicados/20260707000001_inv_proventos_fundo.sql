-- ============================================================
-- inv_proventos_fundo — CACHE do histórico de distribuição por
-- cota do FUNDO/empresa (B3), independente da posição do usuário.
--
-- Problema que resolve: o DY/YoC "padrão investidor10" precisa da
-- distribuição do fundo nos 12 meses COMPLETOS, mas inv_dividendos
-- só tem proventos de quando o usuário já possuía o ativo. Para
-- posições com menos de 1 ano, o Σ rate ficava truncado e o DY/YoC
-- saía subestimado (ex.: KORE11 8% vs 16% no investidor10).
--
-- Esta tabela guarda TODOS os cashDividends que a B3 devolve para o
-- ticker (paydate + rate por cota), gravados nas mesmas rotinas que
-- já consultam a B3 (dividendos-buscar-br e dividendos-backfill-rate).
-- O /ranking soma os rates da janela 12m daqui; se o ativo ainda não
-- tem cache, cai no cálculo antigo (rates de inv_dividendos).
--
-- É um CACHE de dado público, reconstruível pelo botão "Atualizar
-- DY/YoC" — por isso NÃO entra no backup/restore da ImportExportPage.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS arqvalor.inv_proventos_fundo (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ativo_id       UUID          NOT NULL REFERENCES arqvalor.inv_ativos(id) ON DELETE CASCADE,
    data_pagamento DATE          NOT NULL,
    -- Rótulo bruto da B3 (RENDIMENTO, DIVIDENDO, JRS CAP PROPRIO, …)
    label          TEXT          NOT NULL DEFAULT '',
    valor_por_cota NUMERIC(20,8) NOT NULL CHECK (valor_por_cota > 0),
    atualizado_em  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    -- Chave do upsert: 1 linha por provento anunciado do ativo
    CONSTRAINT uq_inv_proventos_fundo UNIQUE (ativo_id, data_pagamento, label)
);

CREATE INDEX IF NOT EXISTS idx_inv_proventos_fundo_user
    ON arqvalor.inv_proventos_fundo(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_proventos_fundo_ativo_data
    ON arqvalor.inv_proventos_fundo(ativo_id, data_pagamento DESC);

COMMENT ON TABLE arqvalor.inv_proventos_fundo IS
  'Cache do histórico de proventos por cota do fundo (B3), independente da '
  'posição. Base do DY/YoC projetado (padrão investidor10) no /ranking. '
  'Reconstruível via rota dividendos-backfill-rate — fora do backup.';

-- RLS (mesmo padrão das demais tabelas inv_*)
ALTER TABLE arqvalor.inv_proventos_fundo ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_proventos_fundo' AND policyname='inv_proventos_fundo_select') THEN
        CREATE POLICY inv_proventos_fundo_select ON arqvalor.inv_proventos_fundo FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_proventos_fundo' AND policyname='inv_proventos_fundo_insert') THEN
        CREATE POLICY inv_proventos_fundo_insert ON arqvalor.inv_proventos_fundo FOR INSERT WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_proventos_fundo' AND policyname='inv_proventos_fundo_update') THEN
        CREATE POLICY inv_proventos_fundo_update ON arqvalor.inv_proventos_fundo FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='arqvalor' AND tablename='inv_proventos_fundo' AND policyname='inv_proventos_fundo_delete') THEN
        CREATE POLICY inv_proventos_fundo_delete ON arqvalor.inv_proventos_fundo FOR DELETE USING (user_id = auth.uid());
    END IF;
END$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.inv_proventos_fundo TO authenticated;

-- ============================================================
-- fn_excluir_dados_usuario — incluir inv_proventos_fundo.
-- Redefinição completa (espelha 20260618000001), acrescentando a
-- nova tabela antes de inv_ativos (referencia inv_ativos).
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_excluir_dados_usuario(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_role TEXT := current_user;
  v_auth_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
BEGIN
  IF v_role NOT IN ('postgres','supabase_admin') AND v_auth_role <> 'service_role' THEN
    IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'ACESSO_NEGADO'
        USING DETAIL = 'p_user_id deve coincidir com o usuário autenticado.';
    END IF;
  END IF;

  SET LOCAL session_replication_role = replica;

  -- Investimentos (filhos → pais)
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

  -- Objetivos
  DELETE FROM arqvalor.objetivos_progresso
    WHERE objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = p_user_id);
  DELETE FROM arqvalor.objetivos            WHERE user_id = p_user_id;

  -- Dependentes
  DELETE FROM arqvalor.lembretes              WHERE user_id = p_user_id;
  DELETE FROM arqvalor.filtros_salvos         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.assistente_lancamentos WHERE user_id = p_user_id;

  -- Domínio principal
  DELETE FROM arqvalor.transacoes WHERE user_id = p_user_id;
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id;
  DELETE FROM arqvalor.contas     WHERE user_id = p_user_id;

  DELETE FROM arqvalor.usuarios WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION arqvalor.fn_excluir_dados_usuario(UUID) TO authenticated, service_role;
