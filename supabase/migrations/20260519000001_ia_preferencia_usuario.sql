-- Adiciona preferências de IA do usuário (provedor + chave da API).
-- O chat do mascote (edge function `chat_mascote`) lê estes campos e
-- usa a chave do próprio usuário pra chamar o provedor escolhido.
--
-- Valores aceitos para `ia_provedor` (ver FrontEnd/src/lib/iaProvedores.ts):
--   'claude'    Anthropic Claude
--   'gpt'       OpenAI GPT
--   'gemini'    Google Gemini
--   'deepseek'  DeepSeek
--   NULL        Não configurado — chat indisponível
--
-- `ia_api_key` é a chave bruta da API do provedor escolhido. Fica em
-- texto plano no banco; o acesso é protegido por RLS (USING user_id =
-- auth.uid()) — só o próprio usuário lê e escreve.
--
-- IMPORTANTE: o frontend pode ler o valor de volta (via Supabase
-- client autenticado). Para fluxo de "input só de escrita" o app deve
-- ocultar visualmente — mas tecnicamente o usuário tem acesso à
-- própria chave, o que está correto.

ALTER TABLE arqvalor.usuarios
  ADD COLUMN IF NOT EXISTS ia_provedor TEXT,
  ADD COLUMN IF NOT EXISTS ia_api_key  TEXT;
