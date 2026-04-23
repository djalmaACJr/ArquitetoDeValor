// e2e/tests/03_contas.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Contas', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/contas')
  })

  test('E2E-CT01 — página carrega com lista de contas', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /contas/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /nova conta/i })).toBeVisible()
  })

  test('E2E-CT02 — criar conta corrente', async ({ page }) => {
    await page.getByRole('button', { name: /nova conta/i }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()

    await drawer.getByPlaceholder(/nubank|nome/i).fill('E2E Conta Teste')
    await drawer.getByRole('button', { name: /salvar|criar/i }).click()

    await expect(drawer).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText('E2E Conta Teste')).toBeVisible()
  })

  test('E2E-CT03 — campos de cartão aparecem ao selecionar tipo Cartão', async ({ page }) => {
    await page.getByRole('button', { name: /nova conta/i }).click()
    const drawer = page.getByRole('dialog')

    // Selecionar tipo Cartão
    await drawer.getByRole('combobox').selectOption('CARTAO')

    // Campos de dia fechamento/pagamento devem aparecer
    await expect(drawer.getByText(/dia de fechamento/i)).toBeVisible()
    await expect(drawer.getByText(/dia de pagamento/i)).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('E2E-CT04 — criar cartão com dia fechamento e pagamento', async ({ page }) => {
    await page.getByRole('button', { name: /nova conta/i }).click()
    const drawer = page.getByRole('dialog')

    await drawer.getByPlaceholder(/nubank|nome/i).fill('E2E Cartão Teste')
    await drawer.getByRole('combobox').selectOption('CARTAO')

    const inputs = drawer.getByRole('spinbutton')
    await inputs.first().fill('10')
    await inputs.last().fill('15')

    await drawer.getByRole('button', { name: /salvar|criar/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText('E2E Cartão Teste')).toBeVisible()
  })

  test('E2E-CT05 — desativar conta move para seção inativas', async ({ page }) => {
    const linha = page.locator('text=E2E Conta Teste').first()
    await expect(linha).toBeVisible()

    // Clicar em editar
    await linha.locator('../../..').locator('button[title*="ditar"]').first().click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()

    // Toggle ativa/inativa
    const toggle = drawer.getByText(/ativa|inativa/i).locator('..')
    await toggle.click()

    await drawer.getByRole('button', { name: /atualizar|salvar/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 8000 })

    // Deve aparecer na seção inativas
    await expect(page.getByText(/contas inativas/i)).toBeVisible()
  })

  test('E2E-CT06 — limpar contas de teste', async ({ page }) => {
    // Excluir E2E Cartão Teste
    for (const nome of ['E2E Cartão Teste', 'E2E Conta Teste']) {
      const linha = page.locator(`text=${nome}`).first()
      if (await linha.isVisible()) {
        await linha.locator('../../..').locator('button[title*="xcluir"]').first().click()
        const modal = page.getByRole('dialog')
        if (await modal.isVisible()) {
          await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()
          await expect(modal).not.toBeVisible({ timeout: 8000 })
        }
      }
    }
  })
})
