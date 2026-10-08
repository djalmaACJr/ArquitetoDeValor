-- 20261006000002_agregados_fase5_expurgo_convites.sql
--
-- Fase 5 (hardening) do plano de agregados: expurgo de convites expirados.
-- Sem isso, um convite PENDENTE cujo `token_expira_em` (7 dias) já passou
-- fica "vivo" pra sempre do ponto de vista do índice único
-- `ux_agregados_dono_email_ativo` (dono_id, email, status IN
-- ('PENDENTE','ACEITO')) — o dono não consegue convidar aquele e-mail de
-- novo sem antes revogar manualmente o convite morto, mesmo ele já não
-- servindo (fn_aceitar_convite_agregado já rejeita com CONVITE_EXPIRADO).
--
-- Mesmo padrão de fn_purgar_trilha_auditoria (20260820000002): SQL puro,
-- sem pg_net (não chama nenhuma Edge Function), loga em cron_execucoes
-- (reaproveita a mesma tabela/tela /admin/crons), roda via pg_cron diário.
-- Marca como REVOGADO (reaproveita o enum existente — não é um status
-- "visível" diferente de uma revogação manual pro propósito de liberar o
-- e-mail de novo) em vez de apagar a linha: mantém o histórico do vínculo
-- (criado_em, token_expira_em) rastreável, mesmo espírito de nunca fazer
-- hard-delete de agregados fora de fn_excluir_dados_usuario.
CREATE OR REPLACE FUNCTION arqvalor.fn_expurgar_convites_agregados_expirados()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_expurgados BIGINT;
  v_inicio     TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE arqvalor.agregados
     SET status = 'REVOGADO', revogado_em = now(), atualizado_em = now()
   WHERE status = 'PENDENTE' AND token_expira_em < now();
  GET DIAGNOSTICS v_expurgados = ROW_COUNT;

  INSERT INTO arqvalor.cron_execucoes (job_nome, status, resumo, duracao_ms)
  VALUES (
    'agregados-expurgo-convites-diario', 'sucesso',
    jsonb_build_object('expurgados', v_expurgados),
    GREATEST(EXTRACT(MILLISECONDS FROM clock_timestamp() - v_inicio)::INTEGER, 0)
  );
EXCEPTION WHEN OTHERS THEN
  INSERT INTO arqvalor.cron_execucoes (job_nome, status, erro, duracao_ms)
  VALUES (
    'agregados-expurgo-convites-diario', 'erro', SQLERRM,
    GREATEST(EXTRACT(MILLISECONDS FROM clock_timestamp() - v_inicio)::INTEGER, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_expurgar_convites_agregados_expirados() FROM PUBLIC, anon, authenticated;

-- ── Agendamento (pg_cron, sem pg_net — SQL puro) ────────────────
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron: habilite pelas Extensions do Dashboard (%).', SQLERRM;
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente — agendamento de expurgo NÃO criado. Reexecute após habilitar.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('agregados-expurgo-convites-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agregados-expurgo-convites-diario');

  -- 08:30 UTC = 05:30 BRT, diário — fora do horário dos outros 9 jobs.
  PERFORM cron.schedule(
    'agregados-expurgo-convites-diario',
    '30 8 * * *',
    $cron$SELECT arqvalor.fn_expurgar_convites_agregados_expirados();$cron$
  );
  RAISE NOTICE 'Agendamento "agregados-expurgo-convites-diario" criado (08:30 UTC = 05:30 BRT, diário).';
END $$;

-- Roda uma vez agora — expurga qualquer convite já expirado hoje, sem
-- esperar a próxima janela do cron. Não crítico: se pg_cron não estiver
-- disponível no ambiente, a migration não quebra por causa disso.
DO $$ BEGIN
  PERFORM arqvalor.fn_expurgar_convites_agregados_expirados();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Execução inicial do expurgo falhou (%), será tentada de novo no próximo agendamento.', SQLERRM;
END $$;
