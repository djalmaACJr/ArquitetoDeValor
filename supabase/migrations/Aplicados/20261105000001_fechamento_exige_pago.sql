-- ============================================================
-- Fechamento de período só com lançamentos PAGOS
--
-- O saldo guardado em conta_fechamento passa a ser definitivo de fato: só dá
-- para fechar numa data se TODOS os lançamentos do usuário até ela (qualquer
-- conta, qualquer tipo) estão com status PAGO. Com pendências, fn_fechar_periodo
-- levanta FECHAMENTO_COM_PENDENCIAS e a tela lista os lançamentos para o
-- usuário editar/excluir (fn_pendencias_fechamento).
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_fechar_periodo(p_data DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_uid  UUID := auth.uid();
    v_qtd  INTEGER;
    v_pend BIGINT;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
    IF p_data IS NULL THEN
        RAISE EXCEPTION 'DATA_FECHAMENTO_INVALIDA' USING DETAIL = 'Informe a data de fechamento.';
    END IF;
    IF p_data > (CURRENT_DATE - INTERVAL '1 year')::date THEN
        RAISE EXCEPTION 'DATA_FECHAMENTO_INVALIDA'
            USING DETAIL = 'A data de fechamento não pode ser posterior a hoje menos 1 ano.';
    END IF;

    SELECT COUNT(*) INTO v_pend
      FROM arqvalor.transacoes t
     WHERE t.user_id = v_uid AND t.data <= p_data AND t.status <> 'PAGO';
    IF v_pend > 0 THEN
        RAISE EXCEPTION 'FECHAMENTO_COM_PENDENCIAS'
            USING DETAIL = v_pend || ' lançamento(s) até a data de fechamento não estão com status PAGO.';
    END IF;

    INSERT INTO arqvalor.conta_fechamento
           (conta_id, user_id, data_fechamento, saldo_fechamento, saldo_fechamento_bruto, atualizado_em)
    SELECT c.id, c.user_id, p_data,
           c.saldo_inicial + COALESCE(SUM(
               CASE WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                    WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END), 0),
           c.saldo_inicial + COALESCE(SUM(
               CASE WHEN t.tipo = 'RECEITA' THEN t.valor ELSE -t.valor END), 0),
           now()
      FROM arqvalor.contas c
      LEFT JOIN arqvalor.transacoes t ON t.conta_id = c.id AND t.data <= p_data
     WHERE c.user_id = v_uid
     GROUP BY c.id, c.user_id, c.saldo_inicial, c.tipo
    ON CONFLICT (conta_id) DO UPDATE
       SET data_fechamento        = EXCLUDED.data_fechamento,
           saldo_fechamento       = EXCLUDED.saldo_fechamento,
           saldo_fechamento_bruto = EXCLUDED.saldo_fechamento_bruto,
           atualizado_em          = now();
    GET DIAGNOSTICS v_qtd = ROW_COUNT;
    RETURN v_qtd;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_fechar_periodo(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_fechar_periodo(DATE) TO authenticated;

-- Lançamentos do PRÓPRIO usuário até p_data que não estão PAGOS (mais antigos
-- primeiro). `total` = quantos existem no todo; a lista traz no máximo 500.
CREATE OR REPLACE FUNCTION arqvalor.fn_pendencias_fechamento(p_data DATE)
RETURNS TABLE (
    id         UUID,
    data       DATE,
    descricao  TEXT,
    valor      NUMERIC,
    tipo       TEXT,
    status     TEXT,
    conta_id   UUID,
    conta_nome TEXT,
    total      BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
    SELECT t.id, t.data, t.descricao::text, t.valor, t.tipo::text, t.status::text,
           t.conta_id, c.nome::text, COUNT(*) OVER ()
      FROM arqvalor.transacoes t
      JOIN arqvalor.contas c ON c.id = t.conta_id
     WHERE t.user_id = auth.uid()
       AND t.data   <= p_data
       AND t.status <> 'PAGO'
     ORDER BY t.data, t.criado_em, t.id
     LIMIT 500;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_pendencias_fechamento(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_pendencias_fechamento(DATE) TO authenticated;

-- ── RV-012: com fechamento, lançamento até a data de fechamento só PAGO ──
-- Expande a RV-008 (PROJECAO só para datas futuras): se o usuário tem período
-- fechado, nenhum lançamento com data <= fechamento pode estar PENDENTE ou
-- PROJECAO (inclui criar, mudar status/data/conta e mover para dentro do
-- período). BEFORE trigger para valer em qualquer caminho (API, transferências,
-- import/restore, cron). user_id = dono dos dados (agregado grava sob o dono).
CREATE OR REPLACE FUNCTION arqvalor.fn_validar_lancamento_periodo_fechado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_fech DATE;
BEGIN
    IF NEW.status = 'PAGO' THEN RETURN NEW; END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.status   IS NOT DISTINCT FROM OLD.status
       AND NEW.data     IS NOT DISTINCT FROM OLD.data
       AND NEW.conta_id IS NOT DISTINCT FROM OLD.conta_id THEN
        RETURN NEW;   -- outro campo mudou: não revalida
    END IF;

    SELECT MAX(f.data_fechamento) INTO v_fech
      FROM arqvalor.conta_fechamento f
     WHERE f.user_id = NEW.user_id;

    IF v_fech IS NOT NULL AND NEW.data <= v_fech THEN
        RAISE EXCEPTION 'RV-012: lançamentos até % (período fechado) só podem ter status PAGO',
            to_char(v_fech, 'DD/MM/YYYY')
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_validar_lancamento_periodo_fechado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validar_lancamento_periodo_fechado ON arqvalor.transacoes;
CREATE TRIGGER trg_validar_lancamento_periodo_fechado
    BEFORE INSERT OR UPDATE ON arqvalor.transacoes
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_validar_lancamento_periodo_fechado();
