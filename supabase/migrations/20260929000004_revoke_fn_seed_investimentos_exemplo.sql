-- ============================================================
-- Higiene — REVOKE do GRANT padrão em fn_seed_investimentos_exemplo
-- ============================================================
-- Achado do Security Advisor do Supabase: EXECUTE ficou concedido a
-- PUBLIC (privilégio padrão do Postgres pra função nova) porque a
-- migration original (20260723000001) nunca revogou explicitamente —
-- inconsistente com o resto do projeto, que sempre revoga EXECUTE de
-- funções-trigger (ver fn_remover_usuario, fn_registrar_trilha_auditoria).
--
-- Verificado ao vivo: NÃO é exploitável na prática — é `RETURNS TRIGGER`,
-- e o PostgREST não expõe funções desse tipo como RPC (POST
-- /rest/v1/rpc/fn_seed_investimentos_exemplo devolve 404 "function not
-- found", não roda o corpo). Revogado mesmo assim por defesa em
-- profundidade / consistência com o resto do projeto.
--
-- Idempotente.
-- ============================================================

REVOKE EXECUTE ON FUNCTION arqvalor.fn_seed_investimentos_exemplo() FROM PUBLIC, anon, authenticated;
