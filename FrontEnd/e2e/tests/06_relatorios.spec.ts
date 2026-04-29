// e2e/tests/05_relatorios.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Relatórios', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/relatorios')
  })

  test('E2E-REL01 — página carrega com filtros', async ({ page }) => {
    await expect(page.getByRole('button', { name: /gerar relatório/i })).toBeVisible()
    await expect(page.getByText(/período/i)).toBeVisible()
  })

  test('E2E-REL02 — gerar relatório exibe tabela', async ({ page }) => {
    await page.getByRole('button', { name: /gerar relatório/i }).click()

    // Aguarda resultado - usa seletores mais específicos
    await expect(page.getByText('Total Receitas')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible()
    await expect(page.getByText('Débitos', { exact: true })).toBeVisible()
  })

  test('E2E-REL03 — seção Créditos pode ser recolhida', async ({ page }) => {
    await page.getByRole('button', { name: /gerar relatório/i }).click()
    // Nível 2 (Categorias) garante que o cabeçalho com chevron expandido seja renderizado
    await page.getByRole('button', { name: /^categorias$/i }).click()

    // O cabeçalho da seção Créditos é a 1ª ocorrência do texto (a 2ª é o totalizador).
    const headerCred = page.getByText('Créditos', { exact: true }).first()
    await expect(headerCred).toBeVisible({ timeout: 15_000 })

    // Lucide React renderiza os ícones com classe "lucide lucide-<nome>".
    // Quando expandida a seção mostra chevron-down; ao recolher passa a chevron-right.
    const chevronDown = headerCred.locator('..').locator('svg.lucide-chevron-down').first()
    const chevronRight = headerCred.locator('..').locator('svg.lucide-chevron-right').first()
    await expect(chevronDown).toBeVisible({ timeout: 5_000 })

    await headerCred.click()
    await expect(chevronRight).toBeVisible({ timeout: 5_000 })
  })

  test('E2E-REL04 — seção Débitos pode ser recolhida', async ({ page }) => {
    await page.getByRole('button', { name: /gerar relatório/i }).click()
    await page.getByRole('button', { name: /^categorias$/i }).click()

    const headerDeb = page.getByText('Débitos', { exact: true }).first()
    await expect(headerDeb).toBeVisible({ timeout: 15_000 })

    const chevronDown = headerDeb.locator('..').locator('svg.lucide-chevron-down').first()
    const chevronRight = headerDeb.locator('..').locator('svg.lucide-chevron-right').first()
    await expect(chevronDown).toBeVisible({ timeout: 5_000 })

    await headerDeb.click()
    await expect(chevronRight).toBeVisible({ timeout: 5_000 })
  })

  test('E2E-REL05 — botão Exportar aparece após gerar relatório', async ({ page }) => {
    // Antes de gerar — não deve aparecer
    await expect(page.getByRole('button', { name: /exportar/i })).not.toBeVisible()

    await page.getByRole('button', { name: /gerar relatório/i }).click()
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible()

    // Após gerar — deve aparecer
    await expect(page.getByRole('button', { name: /exportar/i })).toBeVisible()
  })

  test('E2E-REL06 — filtros persistem ao navegar entre páginas', async ({ page }) => {
    await page.getByRole('button', { name: /gerar relatório/i }).click()
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible()

    // Navegar via links da SPA (page.goto remonta o app e reseta o PageStateContext em memória)
    await page.getByRole('link', { name: /painel/i }).click()
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('link', { name: /relatórios/i }).click()
    await page.waitForLoadState('domcontentloaded')

    // Relatório deve estar gerado ainda
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible({ timeout: 10_000 })
  })
})
