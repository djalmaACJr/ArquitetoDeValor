-- ============================================================
-- Atividade dos agregados visível ao dono
--
-- Até aqui a trilha (trilha_auditoria) gravava só o DONO da linha (user_id).
-- Quando um agregado com escrita criava/editava/excluía um lançamento na
-- conta do dono, não havia como saber QUEM fez a alteração (criado_por só
-- guarda quem criou; a edição e a exclusão não deixavam autor).
--
-- 1) trilha_auditoria.ator_id = auth.uid() de quem executou a operação
--    (NULL em cron/service_role). Sem FK de propósito: a trilha é histórica
--    e sobrevive à exclusão do usuário ator.
-- 2) fn_atividade_agregados(): o DONO lê só as operações feitas por OUTROS
--    usuários (agregados) nos dados dele, com o nome do ator — SECURITY
--    DEFINER devolvendo apenas id+nome (nunca a linha de usuarios).
-- Idempotente.
-- ============================================================

ALTER TABLE arqvalor.trilha_auditoria ADD COLUMN IF NOT EXISTS ator_id uuid;

CREATE OR REPLACE FUNCTION arqvalor.fn_registrar_trilha_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'arqvalor', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO arqvalor.trilha_auditoria (user_id, tabela, operacao, registro_id, dados_novos, ator_id)
    VALUES (NEW.user_id, TG_TABLE_NAME, 'INSERT', NEW.id, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO arqvalor.trilha_auditoria (user_id, tabela, operacao, registro_id, dados_antigos, dados_novos, ator_id)
    VALUES (NEW.user_id, TG_TABLE_NAME, 'UPDATE', NEW.id, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO arqvalor.trilha_auditoria (user_id, tabela, operacao, registro_id, dados_antigos, ator_id)
    VALUES (OLD.user_id, TG_TABLE_NAME, 'DELETE', OLD.id, to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- Só as linhas em que o ator é outra pessoa que não o dono (o caso do aviso).
CREATE INDEX IF NOT EXISTS idx_trilha_auditoria_atividade_agregados
  ON arqvalor.trilha_auditoria (user_id, alterado_em DESC)
  WHERE ator_id IS NOT NULL AND ator_id <> user_id;

CREATE OR REPLACE FUNCTION arqvalor.fn_atividade_agregados(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, tabela text, operacao text, registro_id uuid, alterado_em timestamptz,
  ator_id uuid, ator_nome text, dados_antigos jsonb, dados_novos jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'arqvalor', 'pg_catalog'
AS $function$
  SELECT t.id, t.tabela, t.operacao, t.registro_id, t.alterado_em,
         t.ator_id, u.nome, t.dados_antigos, t.dados_novos
  FROM arqvalor.trilha_auditoria t
  LEFT JOIN arqvalor.usuarios u ON u.id = t.ator_id
  WHERE t.user_id = auth.uid()
    AND t.ator_id IS NOT NULL
    AND t.ator_id <> t.user_id
  ORDER BY t.alterado_em DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$function$;

REVOKE ALL ON FUNCTION arqvalor.fn_atividade_agregados(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_atividade_agregados(integer) TO authenticated;
