-- ============================================================
-- Investimentos — amplia arqvalor.inv_ativos.rf_taxa (VARCHAR(40) → 80)
--
-- Achado ago/2026: o rótulo derivado para renda fixa com taxa escalonada
-- por faixa (rf_limite_faixa/rf_percentual_indice_2, ver
-- 20260827000001_inv_rf_faixa_taxa.sql) monta uma frase do tipo
-- "120% CDI até R$ 10.000,00, 100% CDI acima" — 41+ caracteres, estourando
-- o limite antigo de 40 e travando o PUT/POST com "rf_taxa deve ter no
-- máximo 40 caracteres" assim que o usuário selecionava o índice e salvava.
-- Foi essa falha silenciosa (o cadastro original nunca chegou a gravar o
-- rótulo porque rf_indice ficou vazio) que fez o CDB "CAIXINHA MERCADO
-- PAGO" render a 100% do índice em vez dos 120% configurados na 1ª faixa.
-- ============================================================

ALTER TABLE arqvalor.inv_ativos
    ALTER COLUMN rf_taxa TYPE VARCHAR(80);

COMMENT ON COLUMN arqvalor.inv_ativos.rf_taxa IS
    'Texto livre / rótulo derivado: "110% CDI", "IPCA + 6,2%", "13,5% a.a.", "120% CDI até R$ 10.000,00, 100% CDI acima" (taxa escalonada por faixa).';
