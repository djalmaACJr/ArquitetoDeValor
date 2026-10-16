-- ============================================================
-- Performance das policies de agregado (RLS)
--
-- Problema: as policies permissivas de agregado chamam
-- fn_agregado_tem_acesso() POR LINHA. Para qualquer usuário que não seja o
-- dono dos dados, o Postgres percorre as linhas dos OUTROS usuários e chama a
-- função (SQL STABLE, com RLS interna) 2x por linha: um SELECT count(*) em
-- transacoes levava ~8,7 s para a conta de teste (24,7 mil linhas na tabela)
-- e UPDATEs de série/transferência estouravam o statement_timeout.
--
-- Correção: antes de chamar a função, filtra por um conjunto barato (hashed
-- subplan, avaliado uma vez) dos donos que realmente têm vínculo ACEITO com
-- o usuário. A lógica de acesso é a MESMA — só muda a ordem de avaliação; a
-- função continua sendo a autoridade (módulo/conta/escrita).
--
-- Idempotente: só reescreve policies ainda sem o filtro.
-- ============================================================

DO $$
DECLARE
  p record;
  guard constant text :=
    'user_id IN (SELECT ag.dono_id FROM arqvalor.agregados ag '
    'WHERE ag.agregado_id = (SELECT auth.uid()) AND ag.status = ''ACEITO'')';
  sql text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'arqvalor'
      AND (qual LIKE '%fn_agregado_tem_acesso%' OR with_check LIKE '%fn_agregado_tem_acesso%')
      AND COALESCE(qual, '') NOT LIKE '%FROM arqvalor.agregados ag%'
      AND COALESCE(with_check, '') NOT LIKE '%FROM arqvalor.agregados ag%'
  LOOP
    sql := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF p.qual IS NOT NULL THEN
      sql := sql || format(' USING ((%s) AND (%s))', guard, p.qual);
    END IF;
    IF p.with_check IS NOT NULL THEN
      sql := sql || format(' WITH CHECK ((%s) AND (%s))', guard, p.with_check);
    END IF;
    EXECUTE sql;
  END LOOP;
END $$;
