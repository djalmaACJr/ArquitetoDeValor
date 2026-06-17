-- ============================================================
-- usuarios.inv_pesos_criterio — pesos GLOBAIS dos critérios de avaliação.
--
-- Os pesos (FUNDAMENTOS / CRESCIMENTO / DIVIDENDOS) valem para TODOS os
-- tipos de ativo — apenas as PERGUNTAS dos questionários são separadas por
-- tipo. Antes os pesos ficavam em inv_questionarios.pesos (por tipo); agora
-- a fonte da verdade da pontuação é este campo único por usuário.
--
-- Lido/escrito direto via supabase client (exceção arqvalor.usuarios, como
-- PerfilPage / useInvPerfil). O backend de questionários ainda recebe um
-- objeto `pesos` no PUT (para validação), mas a nota dos ativos usa este.
--
-- Formato (JSONB): { "FUNDAMENTOS": int, "CRESCIMENTO": int, "DIVIDENDOS": int }
--   com soma 100. NULL = usa o padrão do app (sugerido pelo perfil).
-- ============================================================

ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS inv_pesos_criterio JSONB;

COMMENT ON COLUMN arqvalor.usuarios.inv_pesos_criterio IS
    'Pesos globais dos critérios (FUNDAMENTOS/CRESCIMENTO/DIVIDENDOS), soma 100. '
    'Valem para todos os tipos de ativo. NULL = padrão do app.';
