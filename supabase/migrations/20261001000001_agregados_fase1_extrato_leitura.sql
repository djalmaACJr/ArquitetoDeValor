-- ============================================================
-- "Usuários agregados" — Fase 1: leitura do Extrato (contas, categorias,
-- transações) por um agregado com o módulo EXTRATO liberado.
--
-- Só policies ADICIONAIS permissivas (nunca reescreve pol_contas_user/
-- pol_categorias_user/pol_transacoes_user) — mesmo padrão de
-- trilha_auditoria_admin_select, já usado em 20260930000001.
--
-- Idempotente: DO/EXCEPTION nas policies.
-- ============================================================

-- ── RLS: contas ────────────────────────────────────────────────
-- Visível se o módulo EXTRATO ou INVESTIMENTOS estiver liberado pra essa
-- conta específica (a mesma conta pode servir aos dois módulos — é a
-- mesma tabela, ver fundação da feature).
DO $$ BEGIN
  CREATE POLICY pol_contas_agregado_select ON arqvalor.contas
    FOR SELECT USING (
      arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', id)
      OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', id)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── RLS: categorias ────────────────────────────────────────────
-- Sem escopo de conta — categoria não é por conta. Só depende do módulo
-- EXTRATO estar liberado (o agregado precisa ver os nomes/cores das
-- categorias pra entender os lançamentos que já pode ler).
DO $$ BEGIN
  CREATE POLICY pol_categorias_agregado_select ON arqvalor.categorias
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── RLS: transacoes ────────────────────────────────────────────
DO $$ BEGIN
  CREATE POLICY pol_transacoes_agregado_select ON arqvalor.transacoes
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── RPC: convites que EU recebi (base do "seletor de espaço") ─────────
-- Dois casos, unidos numa função só pra Edge Function ficar um wrapper fino:
--   1) Vínculos já ACEITOS (ou qualquer status, pra UI mostrar histórico)
--      onde agregado_id = eu.
--   2) Convites PENDENTES endereçados ao MEU e-mail, mas que eu ainda não
--      aceitei (agregado_id ainda é NULL nesse caso) — a RLS normal de
--      `agregados` não deixaria eu ver essa linha (não sou dono nem
--      agregado ainda), então só uma função SECURITY DEFINER, fazendo a
--      correspondência de e-mail ela mesma, resolve isso com segurança
--      (só devolve convites endereçados ao e-mail do PRÓPRIO chamador,
--      nunca de terceiros).
CREATE OR REPLACE FUNCTION arqvalor.fn_meus_vinculos_como_agregado()
RETURNS SETOF arqvalor.agregados
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT ag.*
  FROM arqvalor.agregados ag
  WHERE ag.agregado_id = auth.uid()
     OR (
       ag.status = 'PENDENTE'
       AND lower(ag.email_convidado) = lower((SELECT email FROM arqvalor.usuarios WHERE id = auth.uid()))
     );
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_meus_vinculos_como_agregado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_meus_vinculos_como_agregado() TO authenticated;
