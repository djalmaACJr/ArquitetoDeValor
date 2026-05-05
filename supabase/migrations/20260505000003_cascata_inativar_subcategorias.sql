-- Trigger: ao inativar uma categoria pai, inativa todas as filhas automaticamente.
-- Garante consistência mesmo em updates feitos fora da Edge Function (ex: admin SQL).

CREATE OR REPLACE FUNCTION arqvalor.fn_cascata_inativar_subcategorias()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Só age quando ativa muda de TRUE para FALSE em uma categoria pai (sem id_pai)
    IF OLD.ativa = TRUE AND NEW.ativa = FALSE AND NEW.id_pai IS NULL THEN
        UPDATE arqvalor.categorias
           SET ativa = FALSE
         WHERE id_pai = NEW.id
           AND ativa = TRUE;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascata_inativar_subcategorias ON arqvalor.categorias;

CREATE TRIGGER trg_cascata_inativar_subcategorias
    AFTER UPDATE OF ativa ON arqvalor.categorias
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_cascata_inativar_subcategorias();
