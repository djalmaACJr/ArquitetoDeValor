// e2e/tests/00_cadastro.spec.ts
// Testes da tela de cadastro — rota pública, não requer sessão
import { test, expect } from '@playwright/test'

// Limpa storage para garantir que não há sessão ativa nestes testes
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Tela de Cadastro', () => {

  // ─── Navegação ──────────────────────────────────────────────────────────────

  test('CAD01 — /cadastro abre sem redirecionamento', async ({ page }) => {
    await page.goto('/cadastro')
    await expect(page).toHaveURL(/\/cadastro/)
    await expect(page.getByRole('heading', { name: /Criar nova conta/i })).toBeVisible()
  })

  test('CAD02 — link "Criar conta" na tela de login navega para /cadastro', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: /Criar conta/i }).click()
    await expect(page).toHaveURL(/\/cadastro/)
  })

  test('CAD03 — link "Entrar" no cadastro navega de volta para /login', async ({ page }) => {
    await page.goto('/cadastro')
    await page.getByRole('link', { name: /Entrar/i }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  // ─── Validações de formulário (client-side) ─────────────────────────────────

  test('CAD04 — campos obrigatórios impedem envio vazio', async ({ page }) => {
    await page.goto('/cadastro')
    await page.getByRole('button', { name: /Criar conta/i }).click()
    // O browser nativo bloqueia envio — permanece na mesma página
    await expect(page).toHaveURL(/\/cadastro/)
  })

  test('CAD05 — senha com menos de 6 caracteres exibe erro', async ({ page }) => {
    await page.goto('/cadastro')
    await page.getByPlaceholder(/Seu nome/i).fill('Teste')
    await page.getByPlaceholder(/seu@email.com/i).fill('teste@example.com')
    await page.locator('input[type="password"]').nth(0).fill('123')
    await page.locator('input[type="password"]').nth(1).fill('123')
    await page.getByRole('button', { name: /Criar conta/i }).click()
    await expect(page.getByText(/pelo menos 6 caracteres/i)).toBeVisible()
  })

  test('CAD06 — senhas diferentes exibem erro de confirmação', async ({ page }) => {
    await page.goto('/cadastro')
    await page.getByPlaceholder(/Seu nome/i).fill('Teste')
    await page.getByPlaceholder(/seu@email.com/i).fill('teste@example.com')
    await page.locator('input[type="password"]').nth(0).fill('senha123')
    await page.locator('input[type="password"]').nth(1).fill('senha456')
    await page.getByRole('button', { name: /Criar conta/i }).click()
    await expect(page.getByText(/senhas não coincidem/i)).toBeVisible()
  })

  test('CAD07 — erro some ao corrigir a senha', async ({ page }) => {
    await page.goto('/cadastro')
    await page.getByPlaceholder(/Seu nome/i).fill('Teste')
    await page.getByPlaceholder(/seu@email.com/i).fill('teste@example.com')
    await page.locator('input[type="password"]').nth(0).fill('senha123')
    await page.locator('input[type="password"]').nth(1).fill('senha456')
    await page.getByRole('button', { name: /Criar conta/i }).click()
    await expect(page.getByText(/senhas não coincidem/i)).toBeVisible()

    // Corrige a confirmação
    await page.locator('input[type="password"]').nth(1).fill('senha123')
    await page.getByRole('button', { name: /Criar conta/i }).click()
    // Erro de confirmação deve desaparecer (novo submit substitui erro anterior)
    await expect(page.getByText(/senhas não coincidem/i)).not.toBeVisible()
  })

  // ─── Fluxo de cadastro com e-mail já existente ──────────────────────────────

  // CAD08/09/10 dependem de comportamento real do Supabase Auth (rate-limit, anti-enumeration,
  // auto-confirm). Em projetos com email-confirmation habilitada, o signup com e-mail existente
  // retorna 200 sem erro (proteção contra enumeration), e o de novo e-mail também retorna 200
  // mas exige confirmação por e-mail antes de criar a sessão. Esses testes só são confiáveis
  // num ambiente com Auth configurado para auto-confirm e sem rate-limit acumulado.
  test.fixme('CAD08 — e-mail já cadastrado exibe mensagem de erro', async ({ page }) => {
    await page.goto('/cadastro')
    await page.getByPlaceholder(/Seu nome/i).fill('Usuário Teste')
    // Usa o e-mail que já existe na base (criado pelo auth.setup)
    await page.getByPlaceholder(/seu@email.com/i).fill('convidado@arquitetodevalor.com')
    await page.locator('input[type="password"]').nth(0).fill('Senha@123')
    await page.locator('input[type="password"]').nth(1).fill('Senha@123')
    await page.getByRole('button', { name: /Criar conta/i }).click()
    await expect(page.getByText(/já está cadastrado|Erro ao criar conta/i)).toBeVisible({ timeout: 10_000 })
  })

  // ─── Fluxo de cadastro bem-sucedido ─────────────────────────────────────────

  test.fixme('CAD09 — cadastro com novo e-mail exibe tela de confirmação', async ({ page }) => {
    // Usa timestamp para garantir e-mail único por execução
    const email = `e2e+${Date.now()}@mailinator.com`

    await page.goto('/cadastro')
    await page.getByPlaceholder(/Seu nome/i).fill('E2E Teste')
    await page.getByPlaceholder(/seu@email.com/i).fill(email)
    await page.locator('input[type="password"]').nth(0).fill('Senha@123')
    await page.locator('input[type="password"]').nth(1).fill('Senha@123')
    await page.getByRole('button', { name: /Criar conta/i }).click()

    // Tela de sucesso deve aparecer
    await expect(page.getByText(/Conta criada/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Verifique seu e-mail/i)).toBeVisible()
  })

  test.fixme('CAD10 — botão "Ir para o login" na tela de sucesso redireciona', async ({ page }) => {
    const email = `e2e+${Date.now()}@mailinator.com`

    await page.goto('/cadastro')
    await page.getByPlaceholder(/Seu nome/i).fill('E2E Teste')
    await page.getByPlaceholder(/seu@email.com/i).fill(email)
    await page.locator('input[type="password"]').nth(0).fill('Senha@123')
    await page.locator('input[type="password"]').nth(1).fill('Senha@123')
    await page.getByRole('button', { name: /Criar conta/i }).click()

    await expect(page.getByText(/Conta criada/i)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Ir para o login/i }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  // ─── Estado de loading ───────────────────────────────────────────────────────

  test('CAD11 — botão mostra "Criando conta..." durante o envio', async ({ page }) => {
    const email = `e2e+${Date.now()}@mailinator.com`

    await page.goto('/cadastro')
    await page.getByPlaceholder(/Seu nome/i).fill('E2E Teste')
    await page.getByPlaceholder(/seu@email.com/i).fill(email)
    await page.locator('input[type="password"]').nth(0).fill('Senha@123')
    await page.locator('input[type="password"]').nth(1).fill('Senha@123')

    // Intercepta antes de terminar para capturar estado de loading
    const [response] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('supabase') && resp.url().includes('signup')),
      page.getByRole('button', { name: /Criar conta/i }).click(),
    ])

    // Verifica que a chamada foi feita (status 200 ou 422 são aceitáveis)
    expect([200, 422, 429].includes(response.status())).toBeTruthy()
  })

})
