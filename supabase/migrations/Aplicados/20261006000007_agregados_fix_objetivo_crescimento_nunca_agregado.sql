-- ============================================================
-- "Usuários agregados" — decisão final (confirmada com o usuário,
-- out/2026): objetivos OBJETIVO/CRESCIMENTO NUNCA ficam visíveis a um
-- agregado, mesmo com o módulo OBJETIVOS liberado.
--
-- Motivo: ao contrário de SONHO/PROJETO (amarrados a `contas_sonho[]`/
-- `contas_projeto[]`, dá pra checar se TODAS as contas monitoradas estão
-- no escopo liberado), OBJETIVO/CRESCIMENTO somam por CATEGORIA em TODAS
-- as contas do dono — não existe "escopo de categoria" nesta feature. Se
-- a mesma categoria recebe lançamentos numa conta liberada E numa conta
-- NÃO liberada, o TOTAL exibido ao agregado soma as duas — um vazamento
-- parcial (nunca o lançamento individual, mas o efeito agregado dele) de
-- uma conta que o agregado nem deveria saber que existe.
--
-- `20261003000001_agregados_fase3_objetivos.sql` liberava os dois tipos
-- sempre que o módulo estava concedido (`WHEN p_tipo IN ('OBJETIVO',
-- 'CRESCIMENTO') THEN true`) — essa era a decisão provisória documentada
-- como "trade-off a validar" no plano original. Revertida aqui: agora
-- `false` incondicional pros dois tipos, independente de módulo/escrita.
--
-- SONHO/PROJETO continuam exatamente como antes (escopo por conta).
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_agregado_pode_ver_objetivo(
  p_dono_id        UUID,
  p_tipo           arqvalor.tipo_objetivo,
  p_conta_id       UUID,
  p_contas_sonho   UUID[],
  p_contas_projeto UUID[],
  p_escrita        BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT CASE
    -- Módulo OBJETIVOS (+ escrita, se exigida) precisa estar liberado
    -- antes de qualquer outra checagem, sempre.
    WHEN NOT arqvalor.fn_agregado_tem_acesso(p_dono_id, 'OBJETIVOS', NULL, p_escrita) THEN false
    -- OBJETIVO/CRESCIMENTO: nunca visível a agregado — somam por categoria
    -- em TODAS as contas do dono, sem escopo de conta possível (decisão
    -- confirmada com o usuário, ver BUSINESS_RULES.md).
    WHEN p_tipo IN ('OBJETIVO', 'CRESCIMENTO') THEN false
    -- SONHO: todas as contas monitoradas (array, com fallback legado)
    -- precisam estar na lista de contas liberadas do vínculo.
    WHEN p_tipo = 'SONHO' THEN (
      CASE
        WHEN array_length(p_contas_sonho, 1) > 0 THEN NOT EXISTS (
          SELECT 1 FROM unnest(p_contas_sonho) AS conta
          WHERE NOT arqvalor.fn_agregado_tem_acesso(p_dono_id, 'OBJETIVOS', conta, p_escrita)
        )
        WHEN p_conta_id IS NOT NULL THEN
          arqvalor.fn_agregado_tem_acesso(p_dono_id, 'OBJETIVOS', p_conta_id, p_escrita)
        ELSE false
      END
    )
    -- PROJETO: mesma lógica de SONHO, só com o array de contas_projeto
    -- (não tem fallback singular — contas_projeto é sempre obrigatório).
    WHEN p_tipo = 'PROJETO' THEN (
      array_length(p_contas_projeto, 1) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(p_contas_projeto) AS conta
        WHERE NOT arqvalor.fn_agregado_tem_acesso(p_dono_id, 'OBJETIVOS', conta, p_escrita)
      )
    )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_agregado_pode_ver_objetivo(UUID, arqvalor.tipo_objetivo, UUID, UUID[], UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arqvalor.fn_agregado_pode_ver_objetivo(UUID, arqvalor.tipo_objetivo, UUID, UUID[], UUID[], BOOLEAN) TO authenticated;
