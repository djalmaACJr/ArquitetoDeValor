-- ============================================================
-- Demais indicadores do Informe Mensal de FII da CVM, aproveitados na MESMA
-- passada de download/parse já feita para o VP (fii_vp) — ver cvm.ts.
-- Todos nullable, só para tipo_ativo = FII, escritos exclusivamente pelo
-- cron `cvm-fii-cron`/pelo cadastro de um FII novo (não são editáveis pelo
-- usuário — sem campo correspondente em DrawerAtivo).
--
--   fii_segmento     ← Segmento_Atuacao (inf_mensal_fii_geral)       — ex.: "Shoppings", "Logística"
--   fii_mandato      ← Mandato (inf_mensal_fii_geral)                — ex.: "Tijolo", "Papel", "Híbrido"
--   fii_num_cotistas ← Total_Numero_Cotistas (inf_mensal_fii_complemento)
--   fii_dy_mes_cvm   ← Percentual_Dividend_Yield_Mes (…complemento), em % (×100 no parse — a
--                      CVM entrega fração, ex.: 0.0084 → gravamos 0.84, mesma escala do resto do app)
--
-- Diferente do setor/segmento já existente em inv_ativos (`setor`, vindo da
-- brapi e sabidamente ERRADO para FII — ver comentário em QuadroTipoAtivos),
-- `fii_segmento` é um campo NOVO e separado: evita qualquer efeito colateral
-- em código que já lê `setor` hoje. Uma eventual migração para usar
-- `fii_segmento` no lugar de `setor` para FII fica para depois, fora deste
-- escopo (só exibição na página do ativo por enquanto).
-- ============================================================
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS fii_segmento TEXT;
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS fii_mandato TEXT;
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS fii_num_cotistas INTEGER;
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS fii_dy_mes_cvm NUMERIC;
