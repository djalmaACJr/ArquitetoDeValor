-- Rótulo de taxa por LOTE (posição), não só por ativo. Um mesmo título de
-- Renda Fixa/Tesouro (mesmo ticker = mesmo indexador+vencimento) pode ser
-- comprado em datas diferentes com taxas contratadas diferentes (ex.: IPCA+
-- 8,22% e depois IPCA+ 8% no mesmo "Tesouro IPCA+ 2023") — hoje o sistema
-- funde tudo numa posição só (preço médio ponderado), o que já dá o P&L
-- agregado certo mas esconde a diferença por taxa. Este campo permite tratar
-- cada compra em taxa diferente como um lote (posição) separado e rotulado,
-- sem mudar o modelo padrão (posição = soma das operações) quando o usuário
-- não pede lote separado. Nullable, mesma semântica livre de inv_ativos.rf_taxa.
ALTER TABLE arqvalor.inv_posicoes ADD COLUMN IF NOT EXISTS rf_taxa TEXT;
