-- ============================================================
-- usuarios.admin — flag de administrador do sistema
--
-- Única fonte da verdade pra gating de funcionalidades admin (ex.: tela de
-- histórico de execução dos cron jobs). Definida SÓ no banco — nada no
-- frontend decide quem é admin, só lê esse campo (via o mesmo padrão já
-- usado para outras preferências de `usuarios`, direto pelo cliente
-- Supabase) e a proteção real de dados fica nas policies RLS que checam
-- esse campo (ver 20260806000002_cron_execucoes.sql).
--
-- Sem endpoint de auto-promoção: setar `admin = true` é sempre manual, via
-- SQL Editor do Supabase Dashboard.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE arqvalor.usuarios
  ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT false;
