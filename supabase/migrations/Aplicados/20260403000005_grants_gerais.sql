-- 20260403000006_grants_arqvalor.sql
GRANT USAGE ON SCHEMA arqvalor TO anon, authenticated, service_role;

-- Tabelas e views existentes
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA arqvalor TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA arqvalor TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA arqvalor TO service_role;

-- Funções existentes
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA arqvalor TO authenticated, anon, service_role;

-- Objetos FUTUROS criados no schema arqvalor
ALTER DEFAULT PRIVILEGES IN SCHEMA arqvalor
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA arqvalor
    GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA arqvalor
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA arqvalor
    GRANT EXECUTE ON FUNCTIONS TO authenticated, anon, service_role;