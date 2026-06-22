-- Corrige fn_validar_isolamento_usuario para permitir UPDATE de campos
-- como categoria_id mesmo quando a conta associada à transação está inativa.
-- Antes: toda UPDATE revalidava ativa=TRUE na conta, bloqueando reclassificações.
-- Agora: conta só é revalidada quando conta_id muda; categoria só quando categoria_id muda.

CREATE OR REPLACE FUNCTION arqvalor.fn_validar_isolamento_usuario()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Valida conta: no INSERT sempre; no UPDATE só se conta_id foi alterado
    IF TG_OP = 'INSERT' OR NEW.conta_id IS DISTINCT FROM OLD.conta_id THEN
        IF NOT EXISTS (
            SELECT 1 FROM arqvalor.contas
            WHERE id = NEW.conta_id AND user_id = NEW.user_id AND ativa = TRUE
        ) THEN
            RAISE EXCEPTION 'CONTA_INVALIDA: A conta nao pertence ao usuario ou esta inativa.';
        END IF;
    END IF;

    -- Valida categoria: no INSERT sempre (se preenchida); no UPDATE só se categoria_id mudou
    IF NEW.categoria_id IS NOT NULL THEN
        IF TG_OP = 'INSERT' OR NEW.categoria_id IS DISTINCT FROM OLD.categoria_id THEN
            IF NOT EXISTS (
                SELECT 1 FROM arqvalor.categorias
                WHERE id = NEW.categoria_id AND user_id = NEW.user_id AND ativa = TRUE
            ) THEN
                RAISE EXCEPTION 'CATEGORIA_INVALIDA: A categoria nao pertence ao usuario ou esta inativa.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
