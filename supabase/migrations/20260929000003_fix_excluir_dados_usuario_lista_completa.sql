-- ============================================================
-- CORREÇÃO — a migration anterior (20260929000002) foi escrita a partir de
-- uma versão DESATUALIZADA do corpo de _excluir_dados_usuario_interno
-- (20260714000001), sem perceber que existiam DUAS revisões mais recentes
-- (20260820000001 e 20260825000004) que já tinham incorporado a lista
-- completa de DISABLE/ENABLE TRIGGER USER pras tabelas auditadas depois de
-- 06/08 (inv_operacoes, lembretes, filtros_salvos, assistente_lancamentos,
-- objetivos, inv_ativos, inv_alocacoes_tipo, inv_posicoes, inv_dividendos,
-- inv_historico_mensal, inv_tipos_dividendo, inv_questionarios,
-- inv_avaliacoes, inv_indicadores, fatura_import_sessao, fatura_import_item).
--
-- Sem essas linhas, apagar qualquer uma dessas tabelas durante "excluir
-- conta" recriava uma linha em trilha_auditoria DEPOIS da limpeza dela
-- (que roda logo no início), e o DELETE final de usuarios voltava a
-- quebrar por FK RESTRICT — confirmado ao vivo com um usuário de teste
-- (que tinha lançamento de exemplo, então a lacuna já batia na prática).
--
-- Esta migration substitui _excluir_dados_usuario_interno pela lista
-- completa de 20260825000004 (a mais recente antes desta sessão), mantendo
-- a arquitetura de autorização introduzida em 20260929000001 (função
-- pública fina que autoriza via auth.uid()/role do JWT, nunca current_user,
-- + função interna sem GRANT nenhum pra API).
--
-- Idempotente (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor._excluir_dados_usuario_interno(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
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

REVOKE ALL ON FUNCTION arqvalor._excluir_dados_usuario_interno(UUID) FROM PUBLIC, anon, authenticated, service_role;
