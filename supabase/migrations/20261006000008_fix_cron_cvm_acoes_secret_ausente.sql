-- ============================================================
-- Corrige falha real do cron `cvm-acoes-mensal` (detectada por
-- cron-saude-diario, 05/10/2026, "null value in column url").
--
-- A migration 20260922000001_inv_ativos_acao_fundamentos_cvm.sql agendou o
-- job via pg_cron/pg_net lendo a URL de
-- `vault.decrypted_secrets WHERE name = 'edge_url_cvm_acoes_cron'` — mas o
-- passo manual (criar esse secret no Vault, documentado como
-- PRÉ-REQUISITO #3 no topo daquela migration) nunca foi feito. Toda
-- execução do job falhava ANTES de sair do Postgres (pg_net não consegue
-- montar um POST com url=NULL), nunca chegando a invocar a Edge Function —
-- mesma classe de bug que o próprio cron-saude-diario foi criado pra pegar
-- (ver 20260821000002_cron_saude.sql).
--
-- `cron_secret` já existe e funciona (os outros ~6 crons que dependem dele
-- estão com status=sucesso) — só faltava este `edge_url_*` específico.
-- A URL em si não é sensível (é um endpoint HTTPS público, só alcançável
-- com o x-cron-secret correto no header) — segue o mesmo padrão não-secreto
-- dos outros `edge_url_*` já no Vault.
--
-- Idempotente: só cria se ainda não existir (vault.create_secret não tem
-- "IF NOT EXISTS" nativo — checa via vault.decrypted_secrets antes).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'edge_url_cvm_acoes_cron'
  ) THEN
    PERFORM vault.create_secret(
      'https://ftpelncgrakpphytfrfo.supabase.co/functions/v1/investimentos/cvm-acoes-cron',
      'edge_url_cvm_acoes_cron',
      'URL da Edge Function do cron mensal de fundamentos de ações (CVM/DFP+FCA) — usada por net.http_post em cvm-acoes-mensal.'
    );
    RAISE NOTICE 'Secret edge_url_cvm_acoes_cron criado no Vault.';
  ELSE
    RAISE NOTICE 'Secret edge_url_cvm_acoes_cron já existia — nada a fazer.';
  END IF;
END $$;
