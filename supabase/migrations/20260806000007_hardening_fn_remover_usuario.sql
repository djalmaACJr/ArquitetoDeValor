-- 20260806000007_hardening_fn_remover_usuario.sql
--
-- AUD-12 residual (auditoria 06/08/2026): reforça o trigger BEFORE DELETE
-- em auth.users para não depender de quem chama auth.admin.deleteUser().
--
-- ORIGEM DO PROBLEMA (achado durante a limpeza dos usuários órfãos de
-- teste jest-rls, sessão de 06/08/2026): fn_remover_usuario fazia apenas
-- `DELETE FROM arqvalor.usuarios WHERE id = OLD.id`, sem ordem FK-safe.
-- Isso funciona SOMENTE quando os dados do usuário já foram limpos antes
-- (é o que a Edge Function excluir_conta sempre faz, chamando
-- fn_excluir_dados_usuario primeiro) — mas falha com "Database error
-- deleting user" para qualquer outro caller: botão "Delete User" do
-- Dashboard, scripts ad-hoc, o próprio teardown dos testes. Módulos
-- adicionados depois da versão original do trigger (Investimentos,
-- Objetivos, Fatura) têm FKs para arqvalor.usuarios que a DELETE simples
-- nunca soube tratar.
--
-- CORREÇÃO: fn_remover_usuario agora delega para fn_excluir_dados_usuario
-- (já FK-safe, já desliga/religa triggers de usuário, já apaga
-- arqvalor.usuarios como último passo) — a MESMA rotina que a Edge
-- Function excluir_conta usa. Isso torna QUALQUER caminho de exclusão de
-- auth.users seguro, não só o fluxo da aplicação.
--
-- Por que isso não quebra a checagem de autorização de
-- fn_excluir_dados_usuario: SECURITY DEFINER faz current_user, dentro da
-- função chamada, refletir o OWNER da função (não o role de quem disparou
-- o DELETE em auth.users) — o mesmo owner que já passava no bypass
-- ('postgres'/'supabase_admin'). Chamar uma SECURITY DEFINER de dentro de
-- outra SECURITY DEFINER preserva esse bypass.
--
-- Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION arqvalor.fn_remover_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
    -- fn_excluir_dados_usuario já apaga arqvalor.usuarios como último
    -- passo (FK-safe, com triggers de usuário desligados durante o wipe).
    -- Idempotente por natureza: se o usuário já não tem dados em nenhuma
    -- tabela (ex.: conta nunca chegou a usar o app), os DELETEs viram
    -- no-ops e a função retorna normalmente.
    PERFORM arqvalor.fn_excluir_dados_usuario(OLD.id);
    RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION arqvalor.fn_remover_usuario() FROM PUBLIC, anon, authenticated;
