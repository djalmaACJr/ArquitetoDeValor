// e2e/tests/06_navegacao.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Navegação e Persistência de Estado', () => {

  test('E2E-NAV01 — menu lateral navega para todas as páginas', async ({ page }) => {
    await page.goto('/')

    const rotas = [
      { link: /lançamentos|extrato/i, url: '/lancamentos' },
      { link: /contas/i,              url: '/contas'      },
      { link: /categorias/i,          url: '/categorias'  },
      { link: /relatórios/i,          url: '/relatorios'  },
      { link: /ferramentas/i,         url: '/importexport'},
      { link: /painel/i,              url: '/'            },
    ]

    for (const rota of rotas) {
      await page.getByRole('link', { name: rota.link }).click()
      await expect(page).toHaveURL(new RegExp(rota.url.replace('/', '\\/')))
      await page.waitForTimeout(300)
    }
  })

  test('E2E-NAV02 — mês do extrato persiste ao ir para contas e voltar', async ({ page }) => {
    await page.goto('/lancamentos')

    // Avançar um mês
    await page.locator('button').filter({ hasText: '>' }).first().click().catch(() => {})
    const mes = await page.locator('button:has-text("/2")').first().textContent()

    await page.getByRole('link', { name: /contas/i }).click()
    await page.getByRole('link', { name: /lançamentos|extrato/i }).click()

    const mesApos = await page.locator('button:has-text("/2")').first().textContent()
    expect(mes).toBe(mesApos)
  })

  test('E2E-NAV03 — mês do dashboard persiste ao ir para relatórios e voltar', async ({ page }) => {
    await page.goto('/')

    await page.locator('button').filter({ hasText: '<' }).first().click().catch(() => {})
    const mes = await page.locator('button:has-text("/2")').first().textContent()

    await page.getByRole('link', { name: /relatórios/i }).click()
    await page.getByRole('link', { name: /painel/i }).click()

    const mesApos = await page.locator('button:has-text("/2")').first().textContent()
    expect(mes).toBe(mesApos)
  })

  test('E2E-NAV04 — sidebar recolhe e expande', async ({ page }) => {
    await page.goto('/')

    const btnRecolher = page.locator('button[title*="ecolher"], button[title*="Recolher"]')
    if (await btnRecolher.isVisible()) {
      await btnRecolher.click()
      // Menu recolhido — labels de texto não devem estar visíveis
      await expect(page.getByText('Painel principal')).not.toBeVisible()

      // Expandir novamente
      const btnExpandir = page.locator('button[title*="xpandir"], button[title*="Expandir"]')
      await btnExpandir.click()
      await expect(page.getByText('Painel principal')).toBeVisible()
    } else {
      test.skip()
    }
  })

  test('E2E-NAV05 — clicar em conta no dashboard vai para extrato filtrado', async ({ page }) => {
    await page.goto('/')

    // Aguarda cards de contas carregarem
    await page.waitForSelector('text=Minhas contas', { timeout: 10000 })

    // Clicar na primeira conta da lista
    const primeiraConta = page.locator('text=Minhas contas').locator('../..').locator('[class*="cursor-pointer"]').first()
    if (await primeiraConta.isVisible()) {
      await primeiraConta.click()
      await expect(page).toHaveURL(/lancamentos/)
      // Filtro de conta deve estar ativo (não "Todas as contas")
      await expect(page.locator('text=Todas as contas')).not.toBeVisible()
    } else {
      test.skip()
    }
  })
})
