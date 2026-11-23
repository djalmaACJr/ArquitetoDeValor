-- ============================================================
-- Análise de resultados — etapa 2, "o que isso significa para mim" (v7.9.0)
--
-- A etapa 1 (genérica, reaproveitável por emissor) continua como está. A etapa 2
-- é gravada na MESMA linha da análise, em JSONB, gerada sob demanda a partir da
-- etapa 1 + perfil de investidor + posição + peso na carteira + data de entrada:
--   { alinhamento: ADEQUADO|ATENCAO|REVISAR, resumo, pontos[],
--     gerada_em, provedor, modelo, mentor_nome }
-- NULL = ainda não gerada (ou invalidada porque a etapa 1 foi refeita).
-- Sem tabela nova: herda RLS (dono), backup e exclusão de `inv_analises_relatorio`.
-- ============================================================
ALTER TABLE arqvalor.inv_analises_relatorio
    ADD COLUMN IF NOT EXISTS analise_pessoal JSONB;

COMMENT ON COLUMN arqvalor.inv_analises_relatorio.analise_pessoal IS
    'Etapa 2 da análise (personalizada: perfil, posição, peso, tempo de carteira). NULL = não gerada.';
