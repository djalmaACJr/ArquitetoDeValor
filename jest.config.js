require('dotenv').config();

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Exclui 99_limpar do run padrão — deve ser executado apenas manualmente via rodar_testes.bat
  testMatch: ['<rootDir>/tests/[0-9][0-9]_*.test.ts'],
  testPathIgnorePatterns: ['99_limpar'],
  setupFiles: ['dotenv/config'],
  testTimeout: 30000,
  verbose: true,
};
