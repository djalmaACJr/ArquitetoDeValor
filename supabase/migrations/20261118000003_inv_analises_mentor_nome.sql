-- ============================================================
-- Análises de relatório de FII: guarda o APELIDO do mentor (config de IA) que
-- fez a análise, para o aviso de login e os cartões mostrarem o nome que o
-- usuário deu (Perfil → Integração com IA) mesmo que a config seja renomeada
-- ou removida depois. `provedor`/`modelo` seguem como detalhe técnico.
-- ============================================================
ALTER TABLE arqvalor.inv_analises_relatorio
    ADD COLUMN IF NOT EXISTS mentor_nome TEXT;
