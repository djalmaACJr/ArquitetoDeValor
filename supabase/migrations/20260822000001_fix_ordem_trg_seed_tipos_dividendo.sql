-- ============================================================
-- Fix: "Database error saving new user" ao cadastrar novo usuário
--
-- Causa raiz: 20260820000001_trilha_auditoria_extensao.sql passou a
-- auditar arqvalor.inv_tipos_dividendo (trg_trilha_auditoria). Quem semeia
-- essa tabela pra usuário novo é trg_seed_tipos_dividendo (AFTER INSERT ON
-- auth.users, criado em 20260609000002) — e o Postgres dispara múltiplos
-- triggers do MESMO evento em ordem ALFABÉTICA do nome:
-- "trg_seed_tipos_dividendo" ordena ANTES de "trg_sincronizar_usuario", que
-- é quem cria a linha em arqvalor.usuarios.
--
-- Resultado: o INSERT em inv_tipos_dividendo (dentro de
-- fn_seed_tipos_dividendo) dispara fn_registrar_trilha_auditoria, que tenta
-- gravar trilha_auditoria.user_id referenciando arqvalor.usuarios(id) — FK
-- RESTRICT — ANTES dessa linha existir (trg_sincronizar_usuario ainda nem
-- rodou). FK violation → todo o INSERT em auth.users falha dentro da mesma
-- transação, e o Supabase Auth devolve "Database error saving new user"
-- pra QUALQUER cadastro novo.
--
-- Mesmo problema, mesma solução já usada em trg_seed_investimentos_exemplo
-- (20260723000001): prefixo "z_" no nome do trigger força execução por
-- último (depois de trg_sincronizar_usuario já ter criado usuarios+contas
-- base). Aplicando aqui o mesmo padrão — a função em si (fn_seed_tipos_dividendo)
-- não muda, só o nome/ordem do trigger.
--
-- Idempotente: DROP/CREATE TRIGGER.
-- ============================================================

DROP TRIGGER IF EXISTS trg_seed_tipos_dividendo ON auth.users;
DROP TRIGGER IF EXISTS trg_z_seed_tipos_dividendo ON auth.users;
CREATE TRIGGER trg_z_seed_tipos_dividendo
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_seed_tipos_dividendo();
