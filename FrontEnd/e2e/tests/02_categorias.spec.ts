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
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })

    // Drawer tem dois inputs: descrição (Ex: Alimentação) e busca de ícones.
    // Usar exact match para evitar strict mode violation.
    await drawer.getByPlaceholder('Ex: Alimentação').fill('E2E Categoria Teste')
    await drawer.getByRole('button', { name: /salvar|criar/i }).click()

    await expect(drawer).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('E2E Categoria Teste')).toBeVisible({ timeout: 10_000 })
  })

  test('E2E-CAT03 — categoria Transferências é protegida', async ({ page }) => {
    const catTransfer = page.locator('text=Transferências').first()
    await expect(catTransfer).toBeVisible()

    // Categoria protegida: linha não renderiza botão excluir.
    // Subimos até a linha-pai (rounded-xl) e contamos os botões — count() é instantâneo
    // (isDisabled() esperaria o elemento por 30s antes do timeout).
    const linhaPai = catTransfer.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
    const btnExcluir = linhaPai.locator('button[title*="xcluir"]')
    expect(await btnExcluir.count()).toBe(0)
  })

  test('E2E-CAT04 — excluir categoria de teste', async ({ page }) => {
    const linha = page.locator('text=E2E Categoria Teste').first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    await linha.locator('../..').locator('button[title*="xcluir"]').first().click()
    const modal = page.getByRole('dialog').first()
    await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=E2E Categoria Teste')).not.toBeVisible({ timeout: 10_000 })
  })
})
