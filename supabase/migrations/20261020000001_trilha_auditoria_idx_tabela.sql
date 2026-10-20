-- Card "Últimas alterações" (Dashboard) lê trilha_auditoria filtrando por
-- user_id + tabela ('transacoes') e ordenando por alterado_em DESC LIMIT n.
-- Os índices existentes (user_id, registro_id, ...) e (user_id, alterado_em)
-- não cobrem `tabela`: o Postgres varria a trilha do usuário inteira (inclui
-- investimentos, contas, categorias...) descartando linhas de outras tabelas.
-- Com este índice a leitura vira um range scan já ordenado, parando no LIMIT.
CREATE INDEX IF NOT EXISTS idx_trilha_auditoria_user_tabela_data
  ON arqvalor.trilha_auditoria (user_id, tabela, alterado_em DESC);
