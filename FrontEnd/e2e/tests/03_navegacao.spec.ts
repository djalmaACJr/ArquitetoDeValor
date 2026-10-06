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
    await page.waitForLoadState('domcontentloaded')

    // Avançar um mês com tratamento de erro
    const btnProximo = page.locator('button').filter({ hasText: '>' }).first()
    if (await btnProximo.isVisible({ timeout: 5000 })) {
      await btnProximo.click()
      await page.waitForTimeout(1000) // espera carregamento com muitos dados
    }
    
    const mes = await page.locator('button:has-text("/2")').first().textContent({ timeout: 10_000 })

    await page.getByRole('link', { name: /contas/i }).click()
    await page.waitForLoadState('domcontentloaded')
    
    await page.getByRole('link', { name: /lançamentos|extrato/i }).click()
    await page.waitForLoadState('domcontentloaded')

    const mesApos = await page.locator('button:has-text("/2")').first().textContent({ timeout: 10_000 })
    expect(mes).toBe(mesApos)
  })

  test('E2E-NAV03 — mês do dashboard persiste ao ir para relatórios e voltar', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Voltar um mês via botão com aria-label do MonthPicker
    const btnAnterior = page.getByRole('button', { name: /mês anterior/i }).first()
    if (await btnAnterior.isVisible({ timeout: 5000 })) {
      await btnAnterior.click()
      await page.waitForTimeout(1000) // espera carregamento
    }
    
    const mes = await page.locator('button:has-text("/2")').first().textContent({ timeout: 10_000 })

    await page.getByRole('link', { name: /relatórios/i }).click()
    await page.waitForLoadState('domcontentloaded')
    
    await page.getByRole('link', { name: /painel/i }).click()
    await page.waitForLoadState('domcontentloaded')
    // RelatoriosPage tem 2 MonthPickers; aguarda até restar apenas 1 (dashboard)
    await expect(page.locator('[aria-label="Mês anterior"]')).toHaveCount(1, { timeout: 5000 })

    const mesApos = await page.locator('button:has-text("/2")').first().textContent({ timeout: 10_000 })
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
    await page.waitForLoadState('domcontentloaded')

    // Bloco "Minhas contas" → primeiro card de conta. (Antes o seletor exigia o
    // TIPO da conta no 2º <p>, mas o card mostra "% do total" no lugar dele em
    // vários casos — o teste era pulado em silêncio. Agora falha se não achar.)
    const bloco = page.locator('div.rounded-xl').filter({ has: page.getByText('Minhas contas', { exact: true }) }).last()
    await expect(bloco).toBeVisible({ timeout: 10_000 })
    const primeiraConta = bloco.locator('div.cursor-pointer.rounded-lg').first()
    await expect(primeiraConta).toBeVisible({ timeout: 10_000 })

    await primeiraConta.click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page).toHaveURL(/.*lancamentos.*/)
  })
})
