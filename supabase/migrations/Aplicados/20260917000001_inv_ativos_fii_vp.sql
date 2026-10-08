-- Valor patrimonial por cota do FII (informado manualmente pelo usuário —
-- não há fonte gratuita/sem-chave confiável para isso, ao contrário da
-- cotação). Usado para calcular o indicador P/VP (preço atual ÷ VP) no
-- quadro de FIIs e no topo da página de detalhe do ativo. Nullable e livre
-- para qualquer tipo de ativo (mesma convenção de fii_categoria), mas só
-- exibido/editado no formulário quando tipo_ativo = FII.
ALTER TABLE arqvalor.inv_ativos ADD COLUMN IF NOT EXISTS fii_vp NUMERIC;
