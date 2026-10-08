-- Novo tipo de conta OUTROS — cobre contas que não se encaixam em
-- corrente/remunerada/cartão/investimento/carteira (ex.: vale-refeição,
-- conta de terceiros, poupança de uso pontual).
--
-- ALTER TYPE ... ADD VALUE não pode rodar dentro de bloco de transação nem
-- ser seguido de uso do valor novo na MESMA transação implícita do arquivo —
-- por isso fica em statement solto (idempotente via IF NOT EXISTS, suportado
-- desde PG 12) e sem nenhum outro comando depois que dependa do valor novo
-- nesta mesma migration.
ALTER TYPE arqvalor.tipo_conta ADD VALUE IF NOT EXISTS 'OUTROS';
