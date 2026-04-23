// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'

dotenv.config()

export default defineConfig({
  testDir: './e2e/tests',
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
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    // Testes principais usando sessão salva
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'e2e/fixtures/auth.json',
      },
      dependencies: ['setup'],
    },
  ],
})
