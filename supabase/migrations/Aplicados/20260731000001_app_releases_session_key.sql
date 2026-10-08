-- Suporte a bundles OTA criptografados (E2E v2 do @capgo/capacitor-updater):
-- checksum passa a guardar o checksum CIFRADO (saída de `bundle encrypt`,
-- não mais o checksum simples do zip puro) e session_key guarda o
-- ivSessionKey retornado junto — ambos exigidos pelo plugin pra decifrar
-- no dispositivo quando a release foi assinada com a chave privada.
ALTER TABLE arqvalor.app_releases
  ADD COLUMN IF NOT EXISTS session_key TEXT;
