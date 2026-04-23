// e2e/tests/auth.setup.ts
// Faz login uma vez e salva o estado da sessão para todos os testes
import { test as setup, expect } from '@playwright/test'

const AUTH_FILE = 'e2e/fixtures/auth.json'

setup('autenticar', async ({ page }) => {
  await page.goto('/login')

  await page.getByPlaceholder(/e-mail|email/i).fill('convidado@arquitetodevalor.com')
  await page.getByPlaceholder(/senha|password/i).fill('Senha@123')
  await page.getByRole('button', { name: /entrar|login|acessar/i }).click()

  // Aguarda redirecionar para o dashboard
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })

  // Salva estado (cookies + localStorage com token Supabase)
  await page.context().storageState({ path: AUTH_FILE })
})
