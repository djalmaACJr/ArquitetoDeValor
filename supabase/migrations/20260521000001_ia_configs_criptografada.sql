-- ============================================================
-- ia_configs.api_key passa a ser CRIPTOGRAFADO (AES-256-GCM).
--
-- Antes: { id, provedor, api_key: '<plaintext>', nome }
-- Agora: { id, provedor, api_key: { v, cipher, iv }, mascara, nome }
--
-- A criptografia é feita pela edge function `ia_configs` usando o
-- secret `IA_KEYS_ENCRYPTION_KEY` (32 bytes base64). A função
-- `chat_mascote` decripta antes de chamar o provedor.
--
-- Esta migration:
--   1. Limpa configs em formato antigo (plaintext) — perda intencional
--      porque manter plaintext após ativar cripto é o oposto do
--      objetivo. Usuários precisam re-cadastrar as chaves.
--   2. NÃO altera a forma da coluna (continua JSONB) — só o conteúdo do
--      campo api_key dentro do JSON muda. A validação fica no app.
--
-- Idempotente: roda múltiplas vezes sem efeito após primeira execução.
-- ============================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  -- Conta quantos usuários têm ao menos uma config em formato antigo
  -- (api_key como string em vez de objeto)
  SELECT COUNT(*) INTO v_count
  FROM arqvalor.usuarios
  WHERE ia_configs ? 'configs'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(ia_configs -> 'configs') c
      WHERE jsonb_typeof(c -> 'api_key') = 'string'
    );

  IF v_count > 0 THEN
    RAISE NOTICE 'Limpando % usuario(s) com chaves em formato antigo (plaintext).', v_count;

    -- Zera ia_configs em todos os usuários que têm pelo menos uma config legada.
    -- Decisão de design: limpar tudo é mais simples que tentar filtrar só as
    -- legadas (e mais seguro — não corremos risco de manter chaves em
    -- plaintext acidentalmente).
    UPDATE arqvalor.usuarios
       SET ia_configs = '{"ativa": null, "configs": []}'::jsonb
     WHERE ia_configs ? 'configs'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(ia_configs -> 'configs') c
         WHERE jsonb_typeof(c -> 'api_key') = 'string'
       );
  END IF;
END $$;

-- Comentário documentando o novo formato (visível em \d+ ou pg_description)
COMMENT ON COLUMN arqvalor.usuarios.ia_configs IS
'Configurações de IA do usuário. Forma:
  { ativa: <id>|null,
    configs: [{
      id:        uuid,
      provedor:  claude|gpt|gemini|deepseek,
      nome:      string|null,
      api_key:   { v: 1, cipher: <b64>, iv: <b64> },  -- AES-256-GCM
      mascara:   string  -- ex. "sk-ant-...f4a2", só pra UI
    }] }
Escrita só via edge function ia_configs (frontend NÃO grava direto).';
