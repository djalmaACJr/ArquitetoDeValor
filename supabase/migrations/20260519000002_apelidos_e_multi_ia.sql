-- 1) Apelidos personalizados por mascote.
--    JSON com a forma { sabio: "Mestre João", arquiteta: "Sofia", ... }
--    Chaves ausentes significam "usar nome padrão do mascote".

ALTER TABLE arqvalor.usuarios
  ADD COLUMN IF NOT EXISTS mascote_apelidos JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2) Múltiplas configurações de IA, com uma marcada como ativa.
--    Forma: { "ativa": "<id>" | null,
--             "configs": [{ "id": "...", "provedor": "claude|gpt|gemini|deepseek",
--                           "api_key": "...", "nome": "..." (opcional) }] }
--    Só a config marcada como "ativa" é usada pela edge function chat_mascote.
--    O usuário pode trocar a ativa sem reinserir a chave.

ALTER TABLE arqvalor.usuarios
  ADD COLUMN IF NOT EXISTS ia_configs JSONB NOT NULL DEFAULT '{"ativa": null, "configs": []}'::jsonb;

-- 3) Migração dos dados antigos (ia_provedor + ia_api_key) para o novo
--    formato. Só executa se as colunas antigas têm valor e a coluna nova
--    ainda está no default.

UPDATE arqvalor.usuarios
SET ia_configs = jsonb_build_object(
  'ativa',   'legado',
  'configs', jsonb_build_array(
    jsonb_build_object(
      'id',       'legado',
      'provedor', ia_provedor,
      'api_key',  ia_api_key,
      'nome',     NULL
    )
  )
)
WHERE ia_provedor IS NOT NULL
  AND ia_api_key IS NOT NULL
  AND (ia_configs = '{"ativa": null, "configs": []}'::jsonb OR ia_configs IS NULL);
