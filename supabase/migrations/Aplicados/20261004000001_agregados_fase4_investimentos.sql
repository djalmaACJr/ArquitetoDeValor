-- 20261004000001_agregados_fase4_investimentos.sql
--
-- Fase 4 do plano de agregados: módulo INVESTIMENTOS. `pol_contas_agregado_select`
-- já reconhece INVESTIMENTOS desde a Fase 1 (20261001000001) — esta migration
-- cobre as tabelas `inv_*` propriamente ditas, que até aqui só tinham RLS
-- owner-only (`user_id = auth.uid()`).
--
-- Escopo decidido (ver tabela no plano, seção 2 — RLS):
--   • inv_posicoes / inv_operacoes / inv_dividendos / inv_historico_mensal:
--     são por CONTA (têm conta_id próprio) — leitura/escrita condicionada à
--     conta estar liberada (fn_agregado_tem_acesso com conta_id).
--   • inv_ativos: não tem conta_id — visível/editável só se existir ALGUMA
--     posição do ativo numa conta liberada (fn_agregado_pode_ver_ativo, novo
--     helper, join em inv_posicoes). INSERT exige só o módulo liberado com
--     escrita (ainda não existe posição pra checar — mesma ordem do fluxo
--     real da UI: cadastra o ativo, depois a 1ª posição).
--   • inv_avaliacoes: mesma lógica de inv_ativos (tem ativo_id, sem conta_id
--     própria) — mas SÓ LEITURA. Nota de mentor de IA é dado derivado do
--     dono, não faz sentido um agregado sobrescrever.
--   • inv_questionarios / inv_alocacoes_tipo / inv_tipos_dividendo /
--     inv_indicadores: preferências globais do dono, sem conceito de conta
--     — SÓ LEITURA, liberadas só pelo módulo INVESTIMENTOS (sem escopo
--     fino). Simplificação deliberada: são configuração de baixo risco
--     (textos de questionário, % de alocação ideal, nomes de tipo de
--     dividendo, watchlist pessoal), não dado financeiro por conta: dar
--     escrita a um agregado aqui teria custo de implementação (RLS +
--     Edge Function) desproporcional ao valor (editar a config de IA de
--     outra pessoa não é um caso de uso real do pedido original).
--     Se um agregado com pode_escrever=true tentar PUT/POST/DELETE nessas
--     4 tabelas mesmo assim, o resolverContexto da Edge Function deixa
--     passar (módulo liberado + escrita), mas a gravação em si é barrada
--     pela RLS (nenhuma policy de INSERT/UPDATE/DELETE de agregado) — erro
--     menos amigável que um 403 cedo, mas a garantia de segurança real
--     (nunca escreve) continua valendo.
--
-- `inv_operacoes.criado_por`/`inv_dividendos.criado_por`: mesmo padrão de
-- `transacoes`/`objetivos` (Fases 2/3) — quem efetivamente lançou, pra
-- exibir "lançado por Fulano" futuramente. Reusa o trigger genérico
-- `fn_default_criado_por()` já existente, sem criar um novo.

-- ── 1. fn_agregado_pode_ver_ativo — ativo não tem conta_id próprio; a
-- visibilidade pro agregado depende de existir alguma posição do ativo
-- numa conta liberada (INSERT novo usa p_escrita=false de propósito — ver
-- policy de INSERT abaixo, que não pode depender de uma posição que ainda
-- não existe) ──
CREATE OR REPLACE FUNCTION arqvalor.fn_agregado_pode_ver_ativo(
  p_ativo_id UUID,
  p_dono_id  UUID,
  p_escrita  BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM arqvalor.inv_posicoes p
    WHERE p.ativo_id = p_ativo_id
      AND arqvalor.fn_agregado_tem_acesso(p_dono_id, 'INVESTIMENTOS', p.conta_id, p_escrita)
  );
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_agregado_pode_ver_ativo(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_agregado_pode_ver_ativo(UUID, UUID, BOOLEAN) TO authenticated;

-- ── 2. criado_por em inv_operacoes / inv_dividendos ──
ALTER TABLE arqvalor.inv_operacoes
  ADD COLUMN IF NOT EXISTS criado_por UUID REFERENCES arqvalor.usuarios(id) ON DELETE SET NULL;
ALTER TABLE arqvalor.inv_dividendos
  ADD COLUMN IF NOT EXISTS criado_por UUID REFERENCES arqvalor.usuarios(id) ON DELETE SET NULL;

UPDATE arqvalor.inv_operacoes  SET criado_por = user_id WHERE criado_por IS NULL;
UPDATE arqvalor.inv_dividendos SET criado_por = user_id WHERE criado_por IS NULL;

DROP TRIGGER IF EXISTS trg_inv_operacoes_default_criado_por ON arqvalor.inv_operacoes;
CREATE TRIGGER trg_inv_operacoes_default_criado_por
  BEFORE INSERT ON arqvalor.inv_operacoes
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_default_criado_por();

DROP TRIGGER IF EXISTS trg_inv_dividendos_default_criado_por ON arqvalor.inv_dividendos;
CREATE TRIGGER trg_inv_dividendos_default_criado_por
  BEFORE INSERT ON arqvalor.inv_dividendos
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_default_criado_por();

-- ── 3. RLS — tabelas por conta: inv_posicoes / inv_operacoes /
-- inv_dividendos / inv_historico_mensal ──

DO $$ BEGIN
  CREATE POLICY pol_inv_posicoes_agregado_select ON arqvalor.inv_posicoes
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_posicoes_agregado_insert ON arqvalor.inv_posicoes
    FOR INSERT WITH CHECK (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_posicoes_agregado_update ON arqvalor.inv_posicoes
    FOR UPDATE
    USING      (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true))
    WITH CHECK (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_posicoes_agregado_delete ON arqvalor.inv_posicoes
    FOR DELETE USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY pol_inv_operacoes_agregado_select ON arqvalor.inv_operacoes
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_operacoes_agregado_insert ON arqvalor.inv_operacoes
    FOR INSERT WITH CHECK (
      arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
      AND criado_por = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_operacoes_agregado_update ON arqvalor.inv_operacoes
    FOR UPDATE
    USING      (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true))
    WITH CHECK (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_operacoes_agregado_delete ON arqvalor.inv_operacoes
    FOR DELETE USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY pol_inv_dividendos_agregado_select ON arqvalor.inv_dividendos
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_dividendos_agregado_insert ON arqvalor.inv_dividendos
    FOR INSERT WITH CHECK (
      arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
      AND criado_por = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_dividendos_agregado_update ON arqvalor.inv_dividendos
    FOR UPDATE
    USING      (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true))
    WITH CHECK (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_dividendos_agregado_delete ON arqvalor.inv_dividendos
    FOR DELETE USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY pol_inv_historico_mensal_agregado_select ON arqvalor.inv_historico_mensal
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_historico_mensal_agregado_insert ON arqvalor.inv_historico_mensal
    FOR INSERT WITH CHECK (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_historico_mensal_agregado_update ON arqvalor.inv_historico_mensal
    FOR UPDATE
    USING      (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true))
    WITH CHECK (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_historico_mensal_agregado_delete ON arqvalor.inv_historico_mensal
    FOR DELETE USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. RLS — inv_ativos (via fn_agregado_pode_ver_ativo) ──
DO $$ BEGIN
  CREATE POLICY pol_inv_ativos_agregado_select ON arqvalor.inv_ativos
    FOR SELECT USING (arqvalor.fn_agregado_pode_ver_ativo(id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  -- Sem posição ainda (ativo novo) — só dá pra exigir o módulo liberado
  -- com escrita; a conta entra em cena na posição, criada em seguida.
  CREATE POLICY pol_inv_ativos_agregado_insert ON arqvalor.inv_ativos
    FOR INSERT WITH CHECK (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', NULL, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_ativos_agregado_update ON arqvalor.inv_ativos
    FOR UPDATE
    USING      (arqvalor.fn_agregado_pode_ver_ativo(id, user_id, true))
    WITH CHECK (arqvalor.fn_agregado_pode_ver_ativo(id, user_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_ativos_agregado_delete ON arqvalor.inv_ativos
    FOR DELETE USING (arqvalor.fn_agregado_pode_ver_ativo(id, user_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. RLS — inv_avaliacoes (só leitura, via fn_agregado_pode_ver_ativo) ──
DO $$ BEGIN
  CREATE POLICY pol_inv_avaliacoes_agregado_select ON arqvalor.inv_avaliacoes
    FOR SELECT USING (arqvalor.fn_agregado_pode_ver_ativo(ativo_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. RLS — preferências globais do dono (só leitura, só módulo) ──
DO $$ BEGIN
  CREATE POLICY pol_inv_questionarios_agregado_select ON arqvalor.inv_questionarios
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_alocacoes_tipo_agregado_select ON arqvalor.inv_alocacoes_tipo
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_tipos_dividendo_agregado_select ON arqvalor.inv_tipos_dividendo
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pol_inv_indicadores_agregado_select ON arqvalor.inv_indicadores
    FOR SELECT USING (arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 7. transacoes — extensão pro módulo INVESTIMENTOS ──
-- Achado em implementação: dividendos (inv_dividendos) sempre geram uma
-- transação espelhada no extrato (arqvalor.transacoes) na MESMA conta do
-- dividendo. As policies de agregado em `transacoes` (Fases 1/2) só
-- reconheciam o módulo EXTRATO — um agregado com SÓ o módulo INVESTIMENTOS
-- liberado (sem EXTRATO) conseguiria criar o `inv_dividendos`, mas o INSERT
-- na transação vinculada falharia por RLS. Mesmo espírito da extensão já
-- feita em `pol_contas_agregado_select`/`pol_categorias_agregado_select`
-- (Fases 1/3): reconhece mais um módulo como razão válida de acesso à MESMA
-- conta, sem tocar a condição original de EXTRATO.
ALTER POLICY pol_transacoes_agregado_select ON arqvalor.transacoes
  USING (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id)
  );

ALTER POLICY pol_transacoes_agregado_insert ON arqvalor.transacoes
  WITH CHECK (
    (
      arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true)
      OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
    )
    AND criado_por = auth.uid()
  );

ALTER POLICY pol_transacoes_agregado_update ON arqvalor.transacoes
  USING (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
  )
  WITH CHECK (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
  );

ALTER POLICY pol_transacoes_agregado_delete ON arqvalor.transacoes
  USING (
    arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true)
    OR arqvalor.fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, true)
  );

-- `categorias` precisou da MESMA extensão (fn_validar_isolamento_usuario
-- também valida categoria_id contra a RLS de quem insere) — achado só
-- depois desta migration já ter sido aplicada (CA-AGR59), corrigido em
-- 20261004000002_agregados_fase4_categorias_investimentos.sql.
