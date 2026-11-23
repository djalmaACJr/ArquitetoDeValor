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

  // Dispensa os avisos de login de agregados ("Agregado saiu"/"aceitou") que já existiam: eles ficam
  // no canto inferior direito e cobrem os botões de editar/excluir das listas (clique interceptado).
  // Vínculos deixados por suítes anteriores só somem com a chave de administrador (que a CI não tem);
  // dispensar aqui faz o corte ser "agora" — avisos de eventos NOVOS dentro da suíte continuam aparecendo.
  await page.evaluate(() => {
    const agora = new Date().toISOString()
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? ''
      if (!/^sb-.*-auth-token$/.test(k)) continue
      const uid = JSON.parse(localStorage.getItem(k) ?? '{}')?.user?.id
      if (!uid) continue
      localStorage.setItem(`arqvalor:agregado-saiu-visto:${uid}`, agora)
      localStorage.setItem(`arqvalor:agregado-aceito-visto:${uid}`, agora)
    }
  })

  // Salva estado (cookies + localStorage com token Supabase)
  await page.context().storageState({ path: AUTH_FILE })
})
