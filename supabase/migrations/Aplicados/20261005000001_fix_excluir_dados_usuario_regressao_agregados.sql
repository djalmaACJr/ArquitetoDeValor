-- 20261005000001_fix_excluir_dados_usuario_regressao_agregados.sql
--
-- Achado durante os testes da Fase 4 de agregados: tests/setup.ts's
-- limparUserBSeDinamico() vinha falhando SILENCIOSAMENTE a sessão inteira
-- ("update or delete on table usuarios violates foreign key constraint
-- trilha_auditoria_user_id_fkey"), deixando vínculos ACEITO órfãos em
-- arqvalor.agregados a cada rodada de teste — 548 linhas acumuladas ao
-- longo da sessão, o bastante pra empurrar UPDATEs em lote de transacoes
-- (PUT /transferencias, PUT /transacoes com escopo=TODOS/ESTE_E_SEGUINTES)
-- pra cima do statement_timeout quando a Fase 4 somou mais uma condição OR
-- (INVESTIMENTOS) às policies de agregado.
--
-- Causa raiz: 20260929000003_fix_excluir_dados_usuario_lista_completa.sql
-- já tinha corrigido _excluir_dados_usuario_interno com a lista COMPLETA de
-- DISABLE/ENABLE TRIGGER USER (18 tabelas auditadas por trilha_auditoria,
-- extensão de 20260820000001) + DELETE de inv_indicadores. Um dia depois,
-- 20260930000001_agregados_fundacao.sql precisava só acrescentar a limpeza
-- de `agregados` e o DELETE de trilha_auditoria antecipado — mas fez
-- CREATE OR REPLACE a partir de uma cópia DESATUALIZADA do corpo da função
-- (só categorias/transacoes/contas no DISABLE/ENABLE), revertendo sem
-- querer a correção de 20260929000003 inteira: as outras 15 tabelas
-- voltaram a rodar com o trigger de auditoria LIGADO durante a limpeza,
-- recriando linhas em trilha_auditoria DEPOIS do DELETE explícito do
-- início — exatamente o sintoma que 20260929000003 já tinha corrigido e
-- documentado. `inv_indicadores` também parou de ser limpa (fica órfã,
-- sem travar o DELETE final só porque não tem trigger de auditoria).
--
-- Esta migration funde as duas correções (nenhuma das duas estava errada
-- sozinha — cada uma só não sabia da outra): lista completa de
-- DISABLE/ENABLE TRIGGER USER + DELETE de inv_indicadores (20260929000003)
-- E a limpeza de trilha_auditoria/agregados (20260930000001).
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

  -- Vínculos de agregado — como dono OU como agregado de outra conta.
  -- Dados próprios do agregado (contas/transações/etc. dele) continuam
  -- intactos: são apartados por definição, só perde o acesso ao espaço
  -- de terceiro. Sem trigger de trilha_auditoria nessas 3 tabelas (ver
  -- 20260930000001) — não precisam entrar no bloco DISABLE/ENABLE acima.
  DELETE FROM arqvalor.agregados WHERE dono_id = p_user_id OR agregado_id = p_user_id;

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
