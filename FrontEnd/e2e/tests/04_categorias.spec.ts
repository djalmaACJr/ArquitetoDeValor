// e2e/tests/04_categorias.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Categorias', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/categorias')
  })

  test('E2E-CAT01 — página carrega com lista de categorias', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /categorias/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /nova categoria/i })).toBeVisible()
  })

  test('E2E-CAT02 — criar categoria pai', async ({ page }) => {
    await page.getByRole('button', { name: /nova categoria/i }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()

    await drawer.getByPlaceholder(/nome|descrição/i).fill('E2E Categoria Teste')
    await drawer.getByRole('button', { name: /salvar|criar/i }).click()

    await expect(drawer).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText('E2E Categoria Teste')).toBeVisible()
  })

  test('E2E-CAT03 — categoria Transferências é protegida', async ({ page }) => {
    const catTransfer = page.locator('text=Transferências').first()
    await expect(catTransfer).toBeVisible()

    // Botão excluir deve estar desabilitado ou ausente
    const row = catTransfer.locator('../..')
    const btnExcluir = row.locator('button[title*="xcluir"]')
    const isDisabled = await btnExcluir.isDisabled().catch(() => true)
    const isHidden   = !(await btnExcluir.isVisible().catch(() => false))
    expect(isDisabled || isHidden).toBe(true)
  })

  test('E2E-CAT04 — excluir categoria de teste', async ({ page }) => {
    const linha = page.locator('text=E2E Categoria Teste').first()
    await expect(linha).toBeVisible()

    await linha.locator('../..').locator('button[title*="xcluir"]').first().click()
    const modal = page.getByRole('dialog')
    await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 8000 })
    await expect(page.locator('text=E2E Categoria Teste')).not.toBeVisible()
  })
})
