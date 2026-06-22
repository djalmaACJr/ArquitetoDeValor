-- ============================================================
-- Fix idempotente: garante que as colunas categorias_objetivo,
-- contas_sonho existem e recria a view com todas elas.
--
-- Resolve o erro "column categorias_objetivo does not exist"
-- que ocorre quando as migrations 005/006 são aplicadas em
-- ambientes onde o ALTER TABLE e o CREATE VIEW rodam em
-- contextos de execução distintos.
-- ============================================================

-- Garante categorias_objetivo (migration 005)
ALTER TABLE arqvalor.objetivos
    ADD COLUMN IF NOT EXISTS categorias_objetivo UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- Garante contas_sonho (migration 006)
ALTER TABLE arqvalor.objetivos
    ADD COLUMN IF NOT EXISTS contas_sonho UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- Migra dados existentes (idempotente)
UPDATE arqvalor.objetivos
SET categorias_objetivo = ARRAY[categoria_id]
WHERE tipo = 'OBJETIVO'
  AND categoria_id IS NOT NULL
  AND array_length(categorias_objetivo, 1) IS NULL;

UPDATE arqvalor.objetivos
SET contas_sonho = ARRAY[conta_id]
WHERE tipo = 'SONHO'
  AND conta_id IS NOT NULL
  AND array_length(contas_sonho, 1) IS NULL;

-- Recria a view com TODAS as colunas atuais
-- DROP + CREATE porque as novas colunas ficam antes de revisoes/criado_em
DROP VIEW IF EXISTS arqvalor.vw_objetivos_detalhes;

CREATE VIEW arqvalor.vw_objetivos_detalhes
WITH (security_invoker = true)
AS
SELECT
    o.id, o.user_id, o.tipo, o.nome, o.descricao, o.icone, o.cor, o.ativo,
    o.valor_meta, o.valor_atingido, o.percentual, o.status,
    o.data_inicio, o.data_fim,
    GREATEST(0, (o.data_fim - CURRENT_DATE)::INT) AS dias_restantes,
    o.conta_id,
    c.nome        AS conta_nome,
    o.categoria_id,
    cat.descricao AS categoria_descricao,
    o.frequencia,
    o.contas_projeto,
    o.contas_sonho,
    o.categorias_objetivo,
    o.revisoes,
    o.criado_em,
    o.atualizado_em
FROM arqvalor.objetivos o
LEFT JOIN arqvalor.contas     c   ON c.id   = o.conta_id
LEFT JOIN arqvalor.categorias cat ON cat.id = o.categoria_id;
