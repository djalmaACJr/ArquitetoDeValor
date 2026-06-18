// robo-investidor10/playwright.config.ts
// Config ISOLADO do robô de importação do investidor10. NÃO é parte da
// suíte e2e (que usa e2e/playwright.config.ts) — `npm run test:e2e` não
// roda isto. Rode explicitamente apontando para este arquivo:
//
//   cd FrontEnd
//   npx playwright test --config=robo-investidor10/playwright.config.ts captura
//
import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'
import * as path from 'node:path'

// Credenciais e parâmetros ficam no .env local desta pasta (gitignored).
dotenv.config({ path: path.resolve(__dirname, '.env') })

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  workers: 1,
  // Robô faz login (com possível captcha/2FA manual) + paginação — folga grande.
  timeout: 8 * 60_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Firefox'],
    locale: 'pt-BR',
  },
  projects: [{ name: 'robo' }],
})
