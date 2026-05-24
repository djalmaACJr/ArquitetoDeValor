-- ============================================================
-- Persistência dos tutoriais vistos por usuário
-- ============================================================
-- Antes esse controle ficava em `localStorage` (`av-tut-tour-*` e
-- `av-tut-visto-*`), o que causava o tutorial reaparecer sempre que
-- o usuário trocava de navegador/dispositivo ou tinha o cache limpo
-- (ex.: pelo `limparEstadoCliente` em troca de usuário).
--
-- Agora persiste em `arqvalor.usuarios.tutoriais_vistos` como JSONB:
--   { "dashboard-v1": true, "extrato-v1": true,
--     "mascote-dashboard-sabio": true, ... }
-- Chaves abertas — cada componente decide a convenção.
-- ============================================================

ALTER TABLE arqvalor.usuarios
    ADD COLUMN IF NOT EXISTS tutoriais_vistos JSONB NOT NULL DEFAULT '{}'::jsonb;
