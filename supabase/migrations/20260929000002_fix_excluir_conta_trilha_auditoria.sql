-- ============================================================
-- CORREÇÃO — excluir conta falhava pra qualquer usuário com histórico de
-- auditoria (achado testando a correção de segurança 20260929000001)
-- ============================================================
-- arqvalor.trilha_auditoria.user_id referencia arqvalor.usuarios(id) com
-- ON DELETE RESTRICT (de propósito — histórico de auditoria não deve
-- sumir sozinho por cascade). A tabela nasceu em 20260806000004, DEPOIS da
-- última vez que fn_excluir_dados_usuario foi atualizada (20260714000001)
-- — ninguém adicionou a limpeza dela na rotina de "excluir conta".
--
-- Efeito prático: qualquer usuário com QUALQUER linha em trilha_auditoria
-- (ou seja, qualquer usuário que já fez alguma alteração no sistema desde
-- 06/08/2026) tinha "Excluir conta" falhando com violação de FK — 100%
-- reproduzível, não edge case raro.
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
  -- Desliga SÓ os triggers de usuário (proteção) nas tabelas que os têm.
  -- FKs (triggers de sistema) seguem ativas → integridade preservada.
  ALTER TABLE arqvalor.categorias DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.transacoes DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.contas     DISABLE TRIGGER USER;

  -- Trilha de auditoria (ON DELETE RESTRICT em user_id) — precisa sair
  -- ANTES de arqvalor.usuarios, senão a FK bloqueia a exclusão.
  DELETE FROM arqvalor.trilha_auditoria WHERE user_id = p_user_id;

  -- ── Faturas (import): filhos antes; referenciam categorias/contas/transacoes ──
  DELETE FROM arqvalor.fatura_import_item   WHERE user_id = p_user_id;
  DELETE FROM arqvalor.fatura_import_sessao WHERE user_id = p_user_id;

  -- ── Investimentos (filhos → pais) ──
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

  -- ── Objetivos ──
  DELETE FROM arqvalor.objetivos_progresso
    WHERE objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = p_user_id);
  DELETE FROM arqvalor.objetivos            WHERE user_id = p_user_id;

  -- ── Dependentes ──
  DELETE FROM arqvalor.lembretes              WHERE user_id = p_user_id;
  DELETE FROM arqvalor.filtros_salvos         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.assistente_lancamentos WHERE user_id = p_user_id;

  -- ── Domínio principal ──
  DELETE FROM arqvalor.transacoes WHERE user_id = p_user_id;

  -- Categorias: subcategorias (id_pai NOT NULL) antes das pais, por causa da
  -- FK auto-referente id_pai (que continua ativa).
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id AND id_pai IS NOT NULL;
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id AND id_pai IS NULL;

  DELETE FROM arqvalor.contas     WHERE user_id = p_user_id;

  DELETE FROM arqvalor.usuarios   WHERE id = p_user_id;

  -- Reativa os triggers (o rollback também reativaria em caso de erro).
  ALTER TABLE arqvalor.categorias ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.transacoes ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.contas     ENABLE TRIGGER USER;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor._excluir_dados_usuario_interno(UUID) FROM PUBLIC, anon, authenticated, service_role;
