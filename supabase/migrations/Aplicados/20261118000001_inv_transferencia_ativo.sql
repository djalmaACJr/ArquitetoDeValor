-- ============================================================
-- Transferência de ativo (v7.7.0)
--
-- Caso de uso: o ativo A deixa de existir e o investidor recebe cotas do
-- ativo B (ex.: FII em liquidação que entrega cotas de outro fundo —
-- RBRR11 → PCIP11; incorporação/fusão/migração de ticker). A posição de
-- A sai e a de B entra CARREGANDO O CUSTO, sem gerar ganho/perda.
--
-- Modelagem (sem tipo de operação novo, pra não tocar em recomputarPosicao,
-- snapshot, dashboard e DY/YoC): a transferência é um PAR de operações
--   • VENDA   na posição de origem (valor_total = custo transferido)
--   • COMPRA  na posição de destino (valor_total = o mesmo custo)
-- ligadas por `id_par_transferencia` (mesmo padrão do par de transferências
-- do Extrato). A coluna só serve pra agrupar/rotular e impedir edição/
-- exclusão isolada de uma perna (a API exige /transferencias-ativo/:par).
-- ============================================================

ALTER TABLE arqvalor.inv_operacoes
    ADD COLUMN IF NOT EXISTS id_par_transferencia UUID;

CREATE INDEX IF NOT EXISTS idx_inv_operacoes_par_transferencia
    ON arqvalor.inv_operacoes (id_par_transferencia)
    WHERE id_par_transferencia IS NOT NULL;
