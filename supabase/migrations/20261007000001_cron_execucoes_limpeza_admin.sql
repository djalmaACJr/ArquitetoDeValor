-- Limpeza manual do histórico de execução dos cron jobs (tela /admin/crons).
--
-- `cron_execucoes` só crescia (nenhum job a purgava; ~8 linhas/dia). A tela agora tem um
-- botão "Limpar logs antigos". A regra "nunca apagar menos de 1 mês" mora AQUI, no banco —
-- não só na tela — pra nenhum cliente (nem a API chamada à mão) conseguir apagar histórico
-- recente, que é o que serve pra diagnosticar falha de cron.
--
-- SECURITY DEFINER + checagem explícita de `usuarios.admin` (a tabela só tem policy de
-- SELECT pra admin; não existe policy de DELETE, de propósito — toda remoção passa por aqui).
-- `p_simular = true` só conta (usado pela tela pra mostrar "N execuções serão apagadas"
-- antes de confirmar), sem apagar nada.
CREATE OR REPLACE FUNCTION arqvalor.fn_limpar_cron_execucoes(
  p_dias    INTEGER DEFAULT 30,
  p_simular BOOLEAN DEFAULT FALSE
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
  v_total INTEGER;
BEGIN
  IF auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM arqvalor.usuarios WHERE id = auth.uid() AND admin = TRUE) THEN
    RAISE EXCEPTION 'ACESSO_NEGADO';
  END IF;

  IF p_dias IS NULL OR p_dias < 30 THEN
    RAISE EXCEPTION 'PERIODO_MINIMO: só é possível limpar execuções com mais de 30 dias.';
  END IF;

  IF p_simular THEN
    SELECT count(*) INTO v_total FROM arqvalor.cron_execucoes
     WHERE executado_em < now() - make_interval(days => p_dias);
  ELSE
    WITH apagadas AS (
      DELETE FROM arqvalor.cron_execucoes
       WHERE executado_em < now() - make_interval(days => p_dias)
      RETURNING 1
    )
    SELECT count(*) INTO v_total FROM apagadas;
  END IF;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_limpar_cron_execucoes(INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_limpar_cron_execucoes(INTEGER, BOOLEAN) TO authenticated;
