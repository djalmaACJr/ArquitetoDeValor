-- 20260828000001_objetivos_tendencia.sql
--
-- Expõe valor_atingido_anterior em vw_objetivos_detalhes: o valor_atingido
-- do snapshot mais recente com pelo menos ~25 dias de idade (objetivos_progresso).
-- Usado pelo frontend (CardObjetivo/ObjetivoDetalhe) para destacar objetivos
-- com tendência de PIORA (valor_atingido atual < valor_atingido_anterior),
-- sem precisar de um round-trip extra por objetivo.
--
-- NULL até existir um snapshot velho o suficiente — a sincronização diária
-- automática (useSincronizarObjetivosDiario) só começou a rodar em
-- 2026-08-28, então este campo vai "acender" sozinho conforme
-- objetivos_progresso acumular histórico nas próximas semanas.
--
-- Coluna adicionada ao FINAL da view (após crescimento_mensal_necessario) →
-- CREATE OR REPLACE basta, sem precisar de DROP (só é obrigatório quando se
-- insere uma coluna no meio, como em 20260602000005/20260605000001).

CREATE OR REPLACE VIEW arqvalor.vw_objetivos_detalhes
WITH (security_invoker = true)
AS
SELECT
    o.id, o.user_id, o.tipo, o.nome, o.descricao, o.icone, o.cor, o.ativo,
    o.valor_meta,
    o.saldo_base,
    o.valor_atingido,
    o.percentual,
    o.status,
    o.data_inicio,
    o.data_fim,
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
    o.atualizado_em,
    -- Estimativa mensal: quanto precisa crescer por mês para atingir a meta
    -- Fórmula: (valor_meta − saldo_atual) / meses_restantes
    -- Apenas para SONHO em progresso com prazo futuro.
    CASE
        WHEN o.tipo = 'SONHO' AND o.status = 'EM_PROGRESSO' THEN
            GREATEST(0, o.valor_meta - o.saldo_base - o.valor_atingido) /
            NULLIF(
                GREATEST(1,
                    (DATE_PART('year',  o.data_fim) - DATE_PART('year',  CURRENT_DATE))::INT * 12 +
                    (DATE_PART('month', o.data_fim) - DATE_PART('month', CURRENT_DATE))::INT
                ),
            0)
        ELSE NULL
    END AS crescimento_mensal_necessario,
    -- Tendência: snapshot mais recente com >= 25 dias de idade. Com
    -- sincronização diária, isso fica sempre "próximo de 25 dias atrás"
    -- (não um snapshot antigo demais) assim que houver histórico suficiente.
    (
        SELECT p.valor_atingido
        FROM arqvalor.objetivos_progresso p
        WHERE p.objetivo_id   = o.id
          AND p.data_snapshot <= CURRENT_DATE - 25
        ORDER BY p.data_snapshot DESC
        LIMIT 1
    ) AS valor_atingido_anterior
FROM arqvalor.objetivos o
LEFT JOIN arqvalor.contas     c   ON c.id   = o.conta_id
LEFT JOIN arqvalor.categorias cat ON cat.id = o.categoria_id;
