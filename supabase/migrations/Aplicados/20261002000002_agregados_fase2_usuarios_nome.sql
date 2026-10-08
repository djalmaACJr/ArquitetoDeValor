-- ============================================================
-- "Usuários agregados" — Fase 2: liberar leitura do NOME entre dono e
-- agregado com vínculo ACEITO.
--
-- Achado durante a Fase 2: pra mostrar "lançado por Fulano" no Extrato, o
-- dono precisa ler o `nome` do agregado que lançou (e o agregado precisa
-- ler o do dono, em outros contextos) — mas `pol_usuarios_user` só libera
-- `id = auth.uid()` (cada um só lê o próprio registro). Sem uma policy
-- adicional, a consulta de nomes falha silenciosamente (RLS devolve vazio,
-- não erro) e o badge nunca aparece pro dono.
--
-- Escopo mínimo: só libera leitura quando existe um vínculo ACEITO entre as
-- duas pessoas (nas duas direções) — nunca abre `usuarios` para qualquer
-- usuário autenticado.
--
-- Só policy ADICIONAL permissiva (nunca reescreve pol_usuarios_user) —
-- mesmo padrão da Fase 0/1/2.
--
-- Idempotente: DO/EXCEPTION.
-- ============================================================

DO $$ BEGIN
  CREATE POLICY pol_usuarios_agregado_select ON arqvalor.usuarios
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM arqvalor.agregados ag
        WHERE ag.status = 'ACEITO'
          AND (
            (ag.dono_id = auth.uid() AND ag.agregado_id = usuarios.id)
            OR (ag.agregado_id = auth.uid() AND ag.dono_id = usuarios.id)
          )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
