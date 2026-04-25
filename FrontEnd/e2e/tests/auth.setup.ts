// e2e/tests/auth.setup.ts
// Faz login uma vez e salva o estado da sessão para todos os testes
import { test as setup, expect } from '@playwright/test'

const AUTH_FILE = './fixtures/auth.json'

setup('autenticar', async ({ page }) => {
  await page.goto('/login')

  // Preenche email
  await page.getByPlaceholder(/seu@email.com/i).fill('convidado@arquitetodevalor.com')
  
  // Preenche senha (campo não tem placeholder útil, usa type="password")
  await page.locator('input[type="password"]').fill('Senha@123')
  
  // Clica no botão Entrar
  await page.getByRole('button', { name: 'Entrar' }).click()

  // Aguarda redirecionar para o dashboard
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })

  // Salva estado (cookies + localStorage com token Supabase)
  await page.context().storageState({ path: AUTH_FILE })
})
