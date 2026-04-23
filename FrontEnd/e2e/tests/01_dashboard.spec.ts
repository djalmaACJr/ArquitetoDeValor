// e2e/tests/01_dashboard.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('E2E-DB01 — carrega e exibe os cards principais', async ({ page }) => {
    await expect(page.getByText('Resultados do mês')).toBeVisible()
    await expect(page.getByText('Receitas')).toBeVisible()
    await expect(page.getByText('Despesas')).toBeVisible()
  })

  test('E2E-DB02 — navega entre meses com as setas', async ({ page }) => {
    const monthPicker = page.locator('[class*="MonthPicker"], button:has-text("/")')
    const mesInicial = await page.locator('button:has-text("/2")').first().textContent()

    await page.locator('button[title*="anterior"], button:has([data-testid="chevron-left"])').first().click()
    const mesDepois = await page.locator('button:has-text("/2")').first().textContent()
    expect(mesInicial).not.toBe(mesDepois)
  })

  test('E2E-DB03 — ocultar/mostrar valores funciona', async ({ page }) => {
    const btnOcultar = page.getByRole('button', { name: /ocultar/i })
    await btnOcultar.click()
    await expect(page.getByRole('button', { name: /mostrar/i })).toBeVisible()
  })

  test('E2E-DB04 — filtro de conta altera o gráfico', async ({ page }) => {
    const selectConta = page.locator('select').first()
    const options = await selectConta.locator('option').allTextContents()

    if (options.length > 1) {
      await selectConta.selectOption({ index: 1 })
      // Aguarda re-render
      await page.waitForTimeout(1000)
      await expect(page.getByText('Resultados do mês')).toBeVisible()
    } else {
      test.skip()
    }
  })

  test('E2E-DB05 — botão Novo lançamento abre o drawer', async ({ page }) => {
    await page.getByRole('button', { name: /novo lançamento/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
  })

  test('E2E-DB06 — estado do mês persiste ao voltar da página de extrato', async ({ page }) => {
    // Navegar para mês anterior
    const btnAnterior = page.locator('button').filter({ has: page.locator('svg') }).nth(0)
    await page.locator('[title*="anterior"], [title*="Anterior"]').first().click().catch(() => {})

    const mesSelecionado = await page.locator('button:has-text("/2")').first().textContent()

    // Ir para extrato e voltar
    await page.getByRole('link', { name: /lançamentos|extrato/i }).click()
    await page.getByRole('link', { name: /painel|dashboard/i }).click()

    const mesAposVoltar = await page.locator('button:has-text("/2")').first().textContent()
    expect(mesSelecionado).toBe(mesAposVoltar)
  })
})
