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

  // Em CI, o Playwright sobe o servidor Vite automaticamente.
  // Localmente, o usuário deve rodar `npm run dev:e2e` (que injeta
  // VITE_E2E=true) antes de `npm run test:e2e`. Sem esse env, o supabase
  // usa sessionStorage e o `storageState` do Playwright não consegue
  // persistir a sessão entre specs.
  webServer: process.env.CI ? {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    timeout: 60_000,
    reuseExistingServer: false,
    env: { VITE_E2E: 'true' },
  } : undefined,

  projects: [
    // Setup: faz login uma vez e salva sessão
    {
      name: 'auth',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    // Setup: cria dados básicos (contas, categorias)
    {
      name: 'data',
      testMatch: /data\.setup\.ts/,
      use: {
        ...devices['Desktop Firefox'],
        storageState: './fixtures/auth.json',
      },
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
