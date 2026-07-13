-- ============================================================
-- Hardening a partir de `supabase db advisors --linked` (varredura
-- completa de segurança/performance pedida pelo usuário). Cobre só os
-- achados REAIS e seguros de corrigir por migration; achados descartados
-- como falso-positivo/fora de escopo de migration ficam documentados
-- abaixo (não geram DDL):
--
--   • unused_index (11 ocorrências) — app de uso pessoal, baixíssimo
--     tráfego: os contadores de uso do Postgres (pg_stat_user_indexes)
--     ficam perto de zero mesmo para índices corretos. Ex.: o advisor
--     acusou idx_inv_proventos_fundo_ativo_data como "não usado" minutos
--     depois de criado — claramente estatística ainda não populada, não
--     índice desnecessário. NÃO dropar sem uma janela maior de uso real.
--   • auth_leaked_password_protection — toggle do Auth (Dashboard →
--     Authentication → Policies), não é schema/DDL.
--   • auth_db_connections_absolute — estratégia de pool do Auth
--     (Dashboard → Settings → Database), não é schema/DDL.
--   • extension_in_public (pg_net) — extensão gerenciada pela própria
--     Supabase (owner supabase_admin) para os webhooks internos; mover de
--     schema por conta própria arrisca quebrar esse encanamento. Baixo
--     risco real (funções do pg_net não expõem dados do usuário).
--   • SECURITY DEFINER "callable by anon/authenticated" nas funções
--     fn_dividendo_tipo_do_ativo / fn_seed_tipos_dividendo — são
--     RETURNS TRIGGER; testado direto no banco (`select
--     arqvalor.fn_seed_tipos_dividendo()`) e o Postgres recusa com
--     "trigger functions can only be called as triggers", mesmo para
--     service_role. Ou seja, o GRANT existe (default do Postgres p/
--     PUBLIC) mas NÃO é explorável — mesmo assim revogamos abaixo por
--     higiene/silenciar o advisor, sem custo funcional.
--   • fn_excluir_dados_usuario "callable by authenticated" — intencional
--     (fluxo de exclusão de conta do usuário; a função já valida
--     p_user_id = auth.uid() internamente). Nada a mudar.
--
-- Idempotente.
-- ============================================================

-- ── A) DRIFT: fn_dividendo_tipo_do_ativo existia só no banco (nenhuma
--    migration no repo a documentava). Trazendo para o histórico, com a
--    definição exata já em produção, + hardening de EXECUTE. ──────────
CREATE OR REPLACE FUNCTION arqvalor.fn_dividendo_tipo_do_ativo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
    SELECT a.tipo_ativo INTO NEW.tipo_ativo
    FROM arqvalor.inv_ativos a
    WHERE a.id = NEW.ativo_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dividendo_tipo_do_ativo ON arqvalor.inv_dividendos;
CREATE TRIGGER trg_dividendo_tipo_do_ativo
    BEFORE INSERT OR UPDATE OF ativo_id, tipo_ativo ON arqvalor.inv_dividendos
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_dividendo_tipo_do_ativo();

REVOKE ALL ON FUNCTION arqvalor.fn_dividendo_tipo_do_ativo() FROM PUBLIC;
REVOKE ALL ON FUNCTION arqvalor.fn_dividendo_tipo_do_ativo() FROM anon, authenticated;

-- ── B) Hardening — fn_seed_tipos_dividendo (trigger, já documentada em
--    20260609000002; só faltava o REVOKE). ─────────────────────────────
REVOKE ALL ON FUNCTION arqvalor.fn_seed_tipos_dividendo() FROM PUBLIC;
REVOKE ALL ON FUNCTION arqvalor.fn_seed_tipos_dividendo() FROM anon, authenticated;

-- ── C) Índice/constraint duplicado em inv_tipos_dividendo — a migration
--    de dedup (20260629000001) recriou a UNIQUE (user_id, nome) sem
--    saber que a fundação (20260609000002) já a tinha com outro nome.
--    Mantém a mais recente (uq_inv_tipos_dividendo_user_nome), remove a
--    antiga. ────────────────────────────────────────────────────────────
ALTER TABLE arqvalor.inv_tipos_dividendo
    DROP CONSTRAINT IF EXISTS uq_inv_tipos_div_user_nome;

-- ── D) Foreign keys sem índice de cobertura — impacta joins/deletes por
--    conta_id, categoria_id, transacao_*_id e lancamento_id. ───────────
CREATE INDEX IF NOT EXISTS idx_assistente_lancamentos_categoria_id
    ON arqvalor.assistente_lancamentos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_assistente_lancamentos_conta_destino_id
    ON arqvalor.assistente_lancamentos(conta_destino_id);
CREATE INDEX IF NOT EXISTS idx_assistente_lancamentos_conta_origem_id
    ON arqvalor.assistente_lancamentos(conta_origem_id);
CREATE INDEX IF NOT EXISTS idx_fatura_import_item_categoria_escolhida_id
    ON arqvalor.fatura_import_item(categoria_escolhida_id);
CREATE INDEX IF NOT EXISTS idx_fatura_import_item_categoria_sugerida_id
    ON arqvalor.fatura_import_item(categoria_sugerida_id);
CREATE INDEX IF NOT EXISTS idx_fatura_import_item_transacao_criada_id
    ON arqvalor.fatura_import_item(transacao_criada_id);
CREATE INDEX IF NOT EXISTS idx_fatura_import_item_transacao_existente_id
    ON arqvalor.fatura_import_item(transacao_existente_id);
CREATE INDEX IF NOT EXISTS idx_inv_dividendos_conta_id
    ON arqvalor.inv_dividendos(conta_id);
CREATE INDEX IF NOT EXISTS idx_inv_historico_mensal_conta_id
    ON arqvalor.inv_historico_mensal(conta_id);
CREATE INDEX IF NOT EXISTS idx_inv_operacoes_conta_id
    ON arqvalor.inv_operacoes(conta_id);
CREATE INDEX IF NOT EXISTS idx_inv_tipos_dividendo_categoria_id
    ON arqvalor.inv_tipos_dividendo(categoria_id);
CREATE INDEX IF NOT EXISTS idx_lembretes_lancamento_id
    ON arqvalor.lembretes(lancamento_id);

-- ── E) RLS: auth.uid() reavaliado por linha (initplan) — envolve em
--    "(select auth.uid())" para o Postgres resolver uma vez por query em
--    vez de uma vez por linha. Mesma semântica de segurança, só muda o
--    plano de execução. 55 policies (todas as tabelas com RLS por
--    user_id). ALTER POLICY é idempotente por natureza (reaplicar a
--    mesma expressão não tem efeito colateral). ─────────────────────────

ALTER POLICY "assistente_user_isolado" ON arqvalor."assistente_lancamentos"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "pol_categorias_user" ON arqvalor."categorias"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "pol_contas_user" ON arqvalor."contas"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "pol_fatura_item_user" ON arqvalor."fatura_import_item"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "pol_fatura_sessao_user" ON arqvalor."fatura_import_sessao"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "filtros_salvos_usuario" ON arqvalor."filtros_salvos"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_alocacoes_tipo_delete" ON arqvalor."inv_alocacoes_tipo"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_alocacoes_tipo_insert" ON arqvalor."inv_alocacoes_tipo"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_alocacoes_tipo_select" ON arqvalor."inv_alocacoes_tipo"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_alocacoes_tipo_update" ON arqvalor."inv_alocacoes_tipo"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_ativos_delete" ON arqvalor."inv_ativos"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_ativos_insert" ON arqvalor."inv_ativos"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_ativos_select" ON arqvalor."inv_ativos"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_ativos_update" ON arqvalor."inv_ativos"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_avaliacoes_delete" ON arqvalor."inv_avaliacoes"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_avaliacoes_insert" ON arqvalor."inv_avaliacoes"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_avaliacoes_select" ON arqvalor."inv_avaliacoes"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_avaliacoes_update" ON arqvalor."inv_avaliacoes"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_dividendos_delete" ON arqvalor."inv_dividendos"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_dividendos_insert" ON arqvalor."inv_dividendos"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_dividendos_select" ON arqvalor."inv_dividendos"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_dividendos_update" ON arqvalor."inv_dividendos"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_historico_mensal_delete" ON arqvalor."inv_historico_mensal"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_historico_mensal_insert" ON arqvalor."inv_historico_mensal"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_historico_mensal_select" ON arqvalor."inv_historico_mensal"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_historico_mensal_update" ON arqvalor."inv_historico_mensal"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_operacoes_delete" ON arqvalor."inv_operacoes"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_operacoes_insert" ON arqvalor."inv_operacoes"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_operacoes_select" ON arqvalor."inv_operacoes"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_operacoes_update" ON arqvalor."inv_operacoes"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_posicoes_delete" ON arqvalor."inv_posicoes"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_posicoes_insert" ON arqvalor."inv_posicoes"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_posicoes_select" ON arqvalor."inv_posicoes"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_posicoes_update" ON arqvalor."inv_posicoes"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_proventos_fundo_delete" ON arqvalor."inv_proventos_fundo"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_proventos_fundo_insert" ON arqvalor."inv_proventos_fundo"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_proventos_fundo_select" ON arqvalor."inv_proventos_fundo"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_proventos_fundo_update" ON arqvalor."inv_proventos_fundo"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_questionarios_delete" ON arqvalor."inv_questionarios"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_questionarios_insert" ON arqvalor."inv_questionarios"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_questionarios_select" ON arqvalor."inv_questionarios"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_questionarios_update" ON arqvalor."inv_questionarios"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_tipos_dividendo_delete" ON arqvalor."inv_tipos_dividendo"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_tipos_dividendo_insert" ON arqvalor."inv_tipos_dividendo"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "inv_tipos_dividendo_select" ON arqvalor."inv_tipos_dividendo"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "inv_tipos_dividendo_update" ON arqvalor."inv_tipos_dividendo"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "lembretes_user" ON arqvalor."lembretes"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "obj_delete" ON arqvalor."objetivos"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "obj_insert" ON arqvalor."objetivos"
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "obj_select" ON arqvalor."objetivos"
  USING ((user_id = (select auth.uid())));

ALTER POLICY "obj_update" ON arqvalor."objetivos"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "prog_insert" ON arqvalor."objetivos_progresso"
  WITH CHECK ((objetivo_id IN ( SELECT objetivos.id
   FROM arqvalor.objetivos
  WHERE (objetivos.user_id = (select auth.uid())))));

ALTER POLICY "prog_select" ON arqvalor."objetivos_progresso"
  USING ((objetivo_id IN ( SELECT objetivos.id
   FROM arqvalor.objetivos
  WHERE (objetivos.user_id = (select auth.uid())))));

ALTER POLICY "pol_transacoes_user" ON arqvalor."transacoes"
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "pol_usuarios_user" ON arqvalor."usuarios"
  USING ((id = (select auth.uid())))
  WITH CHECK ((id = (select auth.uid())));
