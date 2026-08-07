require('dotenv').config();

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Exclui 99_limpar do run padrão — deve ser executado apenas manualmente via rodar_testes.bat
  testMatch: ['<rootDir>/tests/[0-9][0-9]_*.test.ts'],
  testPathIgnorePatterns: ['99_limpar'],
  setupFiles: ['dotenv/config'],
  // 60s (não 30s): testes de integração batem no Supabase real (e alguns,
  // como os de renda fixa em 12_investimentos, também sincronizam índices
  // reais do BCB/SGS em cadeias de várias chamadas HTTP sequenciais). Em
  // runners de CI mais lentos que a máquina local, isso já flakou por
  // estourar 30s mesmo sem nenhum bug (ex.: CA-INV22/24 no GitHub Actions,
  // ago/2026) — rodando localmente e na suíte inteira, tudo passa em bem
  // menos da metade desse tempo.
  testTimeout: 60000,
  verbose: true,
};
