-- ============================================================
-- "Usuários agregados" — Fase 2: escrita no Extrato (lançamentos e
-- transferências) por um agregado com o módulo EXTRATO liberado E
-- `pode_escrever = true`.
--
-- Achado-chave da pesquisa: TODAS as RPCs de transacoes/transferencias
-- (fn_criar_transferencia, fn_atualizar_par_transferencia,
-- fn_atualizar_transacoes_transferencia, fn_atualizar_transacoes_lote,
-- fn_excluir_transferencias, fn_criar_transacoes_com_dividendos,
-- fn_excluir_transacoes_e_dividendos) já são SECURITY INVOKER de
-- propósito — rodam com o papel do chamador e dependem só da RLS de
-- `transacoes` pra decidir o que pode afetar. Isso significa que as 3
-- policies abaixo (INSERT/UPDATE/DELETE) são SUFICIENTES pra liberar
-- escrita de agregado em TODO o fluxo (lançamento simples, recorrente,
-- transferência, edição em lote por escopo) — nenhuma RPC precisa ser
-- reescrita.
--
-- Só policies ADICIONAIS permissivas (nunca reescreve pol_transacoes_user)
-- — mesmo padrão da Fase 0/1.
--
-- Idempotente: ALTER TABLE IF NOT EXISTS / DO-EXCEPTION / CREATE OR REPLACE.
-- ============================================================

-- ── Coluna criado_por — "quem de fato lançou" ─────────────────
-- Sempre presente (não só pra agregados): pro dono comum, criado_por = user_id
-- (default do trigger abaixo); pra escrita de agregado, a Edge Function seta
-- explicitamente o id de quem está autenticado de verdade. ON DELETE SET
-- NULL (não RESTRICT) — é metadado de auditoria, não pode travar a exclusão
-- de um usuário por causa de um lançamento alheio que ele só digitou.
ALTER TABLE arqvalor.transacoes
  ADD COLUMN IF NOT EXISTS criado_por UUID REFERENCES arqvalor.usuarios(id) ON DELETE SET NULL;

UPDATE arqvalor.transacoes SET criado_por = user_id WHERE criado_por IS NULL;

CREATE OR REPLACE FUNCTION arqvalor.fn_default_criado_por()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.criado_por IS NULL THEN NEW.criado_por := NEW.user_id; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_transacoes_default_criado_por ON arqvalor.transacoes;
CREATE TRIGGER trg_transacoes_default_criado_por
  BEFORE INSERT ON arqvalor.transacoes
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_default_criado_por();

-- ── RLS: transacoes — escrita de agregado ─────────────────────
-- INSERT: só com acesso de escrita ao módulo EXTRATO na conta de destino,
-- e só podendo assinar o lançamento com o PRÓPRIO auth.uid() em criado_por
-- (nunca em nome de outra pessoa — a Edge Function nunca aceita criado_por
-- vindo do body do cliente, mas a RLS reforça isso mesmo que algo escape
-- dessa checagem).
DO $$ BEGIN
  CREATE POLICY pol_transacoes_agregado_insert ON arqvalor.transacoes
    FOR INSERT WITH CHECK (
      arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true)
      AND criado_por = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UPDATE: USING valida a linha ATUAL (conta de origem), WITH CHECK valida a
-- linha NOVA (se a edição mudar conta_id, a conta de destino também precisa
-- estar liberada com escrita — não dá pra "mover" um lançamento pra uma
-- conta que o agregado não enxerga).
DO $$ BEGIN
  CREATE POLICY pol_transacoes_agregado_update ON arqvalor.transacoes
    FOR UPDATE
    USING      (arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true))
    WITH CHECK (arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY pol_transacoes_agregado_delete ON arqvalor.transacoes
    FOR DELETE USING (arqvalor.fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── fn_criar_transferencia — propagar criado_por ──────────────
-- Único ajuste de RPC necessário: sem isto, toda transferência criada por um
-- agregado ficaria com criado_por = user_id (o dono) via default do trigger
-- — tecnicamente correto o suficiente (não quebra nada), mas o badge
-- "lançado por" mostraria o dono em vez de quem realmente lançou. Campo
-- opcional no jsonb: ausente, o trigger assume o default de sempre.
CREATE OR REPLACE FUNCTION arqvalor.fn_criar_transferencia(p_rows jsonb)
RETURNS SETOF arqvalor.transacoes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO arqvalor.transacoes (
    user_id, conta_id, categoria_id, data, descricao, valor, tipo, status,
    id_par_transferencia, id_recorrencia, nr_parcela, total_parcelas, tipo_recorrencia,
    criado_por
  )
  SELECT
    (x->>'user_id')::uuid,
    (x->>'conta_id')::uuid,
    (x->>'categoria_id')::uuid,
    (x->>'data')::date,
    x->>'descricao',
    (x->>'valor')::numeric,
    (x->>'tipo')::arqvalor.tipo_transacao,
    (x->>'status')::arqvalor.status_transacao,
    (x->>'id_par_transferencia')::uuid,
    NULLIF(x->>'id_recorrencia', '')::uuid,
    NULLIF(x->>'nr_parcela', '')::int,
    NULLIF(x->>'total_parcelas', '')::int,
    NULLIF(x->>'tipo_recorrencia', '')::arqvalor.tipo_recorrencia,
    NULLIF(x->>'criado_por', '')::uuid
  FROM jsonb_array_elements(p_rows) AS x
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_criar_transferencia(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_criar_transferencia(jsonb) TO authenticated, service_role;
