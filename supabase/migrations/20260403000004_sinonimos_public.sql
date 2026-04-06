-- ============================================================
-- ARQUITETO DE VALOR — Migration v1.8
-- 20260403000004_sinonimos_public.sql
--
-- Cria views no schema public apontando para arqvalor.
-- Permite que o cliente Supabase acesse os objetos sem
-- precisar especificar o schema nas Edge Functions.
-- ============================================================

-- ── Tabelas (views que espelham as tabelas do arqvalor) ──────

CREATE OR REPLACE VIEW public.usuarios AS
    SELECT * FROM arqvalor.usuarios;

CREATE OR REPLACE VIEW public.contas AS
    SELECT * FROM arqvalor.contas;

CREATE OR REPLACE VIEW public.categorias AS
    SELECT * FROM arqvalor.categorias;

CREATE OR REPLACE VIEW public.transacoes AS
    SELECT * FROM arqvalor.transacoes;

CREATE OR REPLACE VIEW public.auditoria AS
    SELECT * FROM arqvalor.auditoria;

-- ── Views analíticas ─────────────────────────────────────────

CREATE OR REPLACE VIEW public.vw_saldo_contas AS
    SELECT * FROM arqvalor.vw_saldo_contas;

CREATE OR REPLACE VIEW public.vw_transacoes_com_saldo AS
    SELECT * FROM arqvalor.vw_transacoes_com_saldo;

CREATE OR REPLACE VIEW public.vw_resumo_mensal AS
    SELECT * FROM arqvalor.vw_resumo_mensal;

CREATE OR REPLACE VIEW public.vw_despesas_por_categoria AS
    SELECT * FROM arqvalor.vw_despesas_por_categoria;

-- ── RLS nas views do public ──────────────────────────────────
-- As views herdam o RLS das tabelas base do arqvalor.
-- Mas precisamos habilitar RLS nas views do public também
-- para garantir o isolamento.

ALTER VIEW public.contas OWNER TO postgres;
ALTER VIEW public.categorias OWNER TO postgres;
ALTER VIEW public.transacoes OWNER TO postgres;
ALTER VIEW public.usuarios OWNER TO postgres;

-- ============================================================
-- FIM DA MIGRATION — 20260403000004_sinonimos_public
-- ============================================================
