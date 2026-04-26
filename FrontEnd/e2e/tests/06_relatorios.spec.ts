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
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible({ timeout: 15_000 })

    // Clicar na seção créditos para recolher
    await page.getByText('Créditos', { exact: true }).click()

    // Total créditos deve sumir
    await expect(page.getByText(/total créditos/i)).not.toBeVisible()
  })

  test('E2E-REL04 — seção Débitos pode ser recolhida', async ({ page }) => {
    await page.getByRole('button', { name: /gerar relatório/i }).click()
    await expect(page.getByText('Débitos', { exact: true })).toBeVisible({ timeout: 15_000 })

    await page.getByText('Débitos', { exact: true }).click()

    // Total débitos deve sumir
    await expect(page.getByText(/total débitos/i)).not.toBeVisible()
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
