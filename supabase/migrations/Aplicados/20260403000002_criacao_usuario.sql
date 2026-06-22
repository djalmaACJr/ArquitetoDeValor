-- Cria usuário para a API (somente leitura e escrita, sem admin)
CREATE USER arqvalor_api WITH PASSWORD 'minaSenha';

-- Dá acesso ao schema
GRANT USAGE ON SCHEMA arqvalor TO arqvalor_api;

-- Dá permissão de SELECT, INSERT, UPDATE, DELETE nas tabelas
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA arqvalor TO arqvalor_api;

-- Garante permissão nas tabelas futuras também
ALTER DEFAULT PRIVILEGES IN SCHEMA arqvalor
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO arqvalor_api;

-- Dá permissão para executar as funções
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA arqvalor TO arqvalor_api;