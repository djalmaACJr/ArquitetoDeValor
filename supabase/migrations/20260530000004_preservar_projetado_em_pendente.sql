-- Migration: a trigger fn_preservar_valor_projetado agora também preserva
-- o valor projetado quando uma PROJECAO vira PENDENTE (não só PAGO).
--
-- Motivação: importação de fatura de cartão. Quando o usuário vincula um
-- item da fatura a uma transação PROJECAO existente (recorrência/projeção
-- automática), o valor real da fatura sobrescreve o projetado, e o status
-- vira PENDENTE (a despesa foi reconhecida, mas o pagamento ainda não
-- aconteceu). Sem este ajuste, o valor projetado original seria perdido.
--
-- O comportamento original (PROJECAO → PAGO) continua igual — esta migration
-- apenas amplia o conjunto de transições cobertas.
--
-- Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION arqvalor.fn_preservar_valor_projetado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Cobre dois cenários:
    --   1. PROJECAO → PAGO     (pagamento direto de uma projeção)
    --   2. PROJECAO → PENDENTE (importação de fatura — projeção é
    --                           "atualizada" com o valor real da fatura)
    IF OLD.status = 'PROJECAO'
       AND NEW.status IN ('PAGO', 'PENDENTE')
       AND NEW.valor_projetado IS NULL
    THEN
        NEW.valor_projetado = OLD.valor;
    END IF;
    RETURN NEW;
END;
$$ SET search_path = arqvalor, pg_catalog;
