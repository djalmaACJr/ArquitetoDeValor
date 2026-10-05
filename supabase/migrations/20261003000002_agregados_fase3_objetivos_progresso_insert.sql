-- 20261003000002_agregados_fase3_objetivos_progresso_insert.sql
--
-- Achado em teste (CA-AGR52): fn_sincronizar_progresso_objetivo é
-- SECURITY INVOKER, então o INSERT que ela faz em objetivos_progresso roda
-- com a identidade de quem chamou a RPC — inclusive um agregado com
-- OBJETIVOS liberado e pode_escrever=true, sincronizando os objetivos do
-- dono. A migration 20261003000001_agregados_fase3_objetivos.sql só
-- acrescentou a policy adicional de SELECT em objetivos_progresso
-- (pol_objetivos_progresso_agregado_select) — faltou o equivalente de
-- INSERT. Sem isso, o INSERT falhava com "new row violates row-level
-- security policy for table objetivos_progresso" assim que um agregado
-- com escrita tentava sincronizar.
DO $$ BEGIN
  CREATE POLICY pol_objetivos_progresso_agregado_insert ON arqvalor.objetivos_progresso
    FOR INSERT WITH CHECK (
      objetivo_id IN (
        SELECT o.id FROM arqvalor.objetivos o
        WHERE arqvalor.fn_agregado_pode_ver_objetivo(
          o.user_id, o.tipo, o.conta_id, o.contas_sonho, o.contas_projeto, true
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
