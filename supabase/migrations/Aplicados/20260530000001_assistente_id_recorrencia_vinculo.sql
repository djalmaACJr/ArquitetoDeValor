-- Migration: adiciona id_recorrencia_vinculo em assistente_lancamentos.
--
-- Contexto: ao confirmar uma fatura de cartão, se o usuário VINCULOU um
-- item/grupo a uma transação existente (ex.: parcela de "POCO X7 PRO -
-- Shopee"), queremos lembrar essa série de recorrência para que na
-- próxima fatura o /sugerir consiga achar automaticamente a próxima
-- parcela (mesmo id_recorrencia, nr_parcela seguinte) — mesmo que a
-- descrição da fatura ("Shopee*Goldenmoon Come") seja diferente do
-- nome amigável da projeção.
--
-- Idempotente. SET NULL no DELETE da recorrência → mantém o padrão
-- (categoria/conta) mesmo se a série for excluída no domínio.

ALTER TABLE arqvalor.assistente_lancamentos
  ADD COLUMN IF NOT EXISTS id_recorrencia_vinculo UUID;

CREATE INDEX IF NOT EXISTS idx_assistente_id_recorrencia_vinculo
  ON arqvalor.assistente_lancamentos (id_recorrencia_vinculo)
  WHERE id_recorrencia_vinculo IS NOT NULL;
