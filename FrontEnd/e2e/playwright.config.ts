// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'

dotenv.config()

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,       // Testes sequenciais — base compartilhada
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/report', open: 'never' }],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'pt-BR',
  },

  projects: [
    // Setup: faz login uma vez e salva sessão
    {
      name: 'auth',
      testMatch: /auth\.setup\.ts/,
    },
    // Setup: cria dados básicos (contas, categorias)
    {
      name: 'data',
      testMatch: /data\.setup\.ts/,
      dependencies: ['auth'],
    },
    // Testes principais usando sessão e dados salvos
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: './fixtures/auth.json',
      },
      dependencies: ['data'],
    },
  ],
})
