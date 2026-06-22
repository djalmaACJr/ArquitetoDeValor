-- ============================================================
-- Sincroniza alterações de nome/email em auth.users com arqvalor.usuarios
-- ============================================================
-- Histórico:
--   `fn_sincronizar_usuario` já existia e roda no INSERT de auth.users
--   (signup), copiando raw_user_meta_data->>'nome' para arqvalor.usuarios.nome.
--   Mas atualizações posteriores (via supabase.auth.updateUser, Studio ou
--   admin API) não tinham mirror — gerando desync entre os dois lugares.
--
--   Caso observado: convidado@arquitetodevalor.com tinha
--     arqvalor.usuarios.nome      = "Convidado"
--     raw_user_meta_data.nome     = "Djalma Jr HML"
--   A UI lê do JWT (que vem de raw_user_meta_data) e mostrava o nome errado
--   mesmo a tabela espelho estando correta. A UI agora passou a ler da
--   tabela, mas mantemos esse trigger como defesa em profundidade.
--
-- Comportamento:
--   AFTER UPDATE em auth.users. Se raw_user_meta_data.nome OU email mudou,
--   propaga para arqvalor.usuarios. Bidirecional NÃO é necessário porque
--   a UI agora lê do espelho — auth.users é só o storage do auth.
--
-- SECURITY DEFINER porque auth.users pertence ao schema auth (gerenciado
-- pelo Supabase). Roda no contexto do dono pra poder escrever em arqvalor.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_sincronizar_usuario_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
    -- Atualiza nome quando raw_user_meta_data->>'nome' mudou
    IF (NEW.raw_user_meta_data->>'nome') IS DISTINCT FROM (OLD.raw_user_meta_data->>'nome') THEN
        UPDATE arqvalor.usuarios
           SET nome = COALESCE(NEW.raw_user_meta_data->>'nome', nome)
         WHERE id = NEW.id;
    END IF;

    -- Atualiza email quando muda
    IF NEW.email IS DISTINCT FROM OLD.email THEN
        UPDATE arqvalor.usuarios
           SET email = NEW.email
         WHERE id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$;

-- Recria trigger (idempotente)
DROP TRIGGER IF EXISTS trg_sincronizar_usuario_update ON auth.users;
CREATE TRIGGER trg_sincronizar_usuario_update
    AFTER UPDATE OF raw_user_meta_data, email ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION arqvalor.fn_sincronizar_usuario_update();

-- ============================================================
-- One-off: realinha registros existentes onde os dois lugares divergem.
-- Estratégia: confia em arqvalor.usuarios.nome como fonte da verdade
-- (foi onde o usuário editou via Studio) e propaga para raw_user_meta_data.
-- Não fazemos a inversa — se o usuário corrigiu via UI futura, o trigger
-- ACIMA já cuida.
-- ============================================================
UPDATE auth.users AS au
   SET raw_user_meta_data = jsonb_set(
           COALESCE(au.raw_user_meta_data, '{}'::jsonb),
           '{nome}',
           to_jsonb(u.nome)
       )
  FROM arqvalor.usuarios u
 WHERE u.id = au.id
   AND u.nome IS NOT NULL
   AND (au.raw_user_meta_data->>'nome') IS DISTINCT FROM u.nome;
