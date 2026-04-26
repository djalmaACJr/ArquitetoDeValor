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

    // Voltar um mês com tratamento de erro
    const btnAnterior = page.locator('button').filter({ hasText: '<' }).first()
    if (await btnAnterior.isVisible({ timeout: 5000 })) {
      await btnAnterior.click()
      await page.waitForTimeout(1000) // espera carregamento
    }
    
    const mes = await page.locator('button:has-text("/2")').first().textContent({ timeout: 10_000 })

    await page.getByRole('link', { name: /relatórios/i }).click()
    await page.waitForLoadState('domcontentloaded')
    
    await page.getByRole('link', { name: /painel/i }).click()
    await page.waitForLoadState('domcontentloaded')

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

    // Localiza a seção "Minhas contas" — pode não existir se não há conta cadastrada
    const heading = page.getByText('Minhas contas')
    if (!(await heading.isVisible({ timeout: 8000 }).catch(() => false))) {
      test.skip()
      return
    }

    // Pega o primeiro card de conta dentro do bloco "Minhas contas".
    // Cards têm "cursor-pointer", "rounded-lg" e contêm um <p> com tipo (CORRENTE, CARTAO, etc.).
    const primeiraConta = page
      .locator('div.cursor-pointer.rounded-lg')
      .filter({ has: page.locator('p:text-matches("CORRENTE|CARTAO|REMUNERACAO|INVESTIMENTO|CARTEIRA", "i")') })
      .first()

    if (!(await primeiraConta.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip()
      return
    }

    await primeiraConta.click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page).toHaveURL(/.*lancamentos.*/)
  })
})
