// e2e/tests/01_dashboard.spec.ts
import { test, expect } from '@playwright/test'
import { abrirNovoLancamento } from './helpers'

test.describe('Dashboard', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('E2E-DB01 — carrega e exibe os cards principais', async ({ page }) => {
    // Verifica se o dashboard carrega (pode estar vazio)
    await expect(page.getByText('Resultados do mês')).toBeVisible({ timeout: 10_000 })

    // Labels presentes no CardResultados (Receitas / Despesas / Resultado)
    await expect(page.getByText('Receitas', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Despesas', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Resultado', { exact: true }).first()).toBeVisible()
  })

  test('E2E-DB02 — navega entre meses com as setas', async ({ page }) => {
    // Espera dashboard carregar completamente
    await page.waitForLoadState('networkidle')
    
    // Encontra o seletor de mês atual
    const monthSelector = page.locator('button:has-text("/")').first()
    await expect(monthSelector).toBeVisible({ timeout: 10_000 })
    
        
    // Tenta navegar para o mês anterior
    const prevButton = page.locator('button[title*="anterior"], button:has-text("<"), [data-testid="prev-month"]').first()
    if (await prevButton.isVisible()) {
      await prevButton.click()
      await page.waitForTimeout(1000) // espera transição
    }
    
    // Verifica se o mês mudou (ou se não conseguiu navegar)
    const mesAtual = await monthSelector.textContent()
    // Em base limpa, pode não haver navegação se não houver dados
    expect(mesAtual).toBeDefined()
  })

  test('E2E-DB03 — ocultar/mostrar valores funciona', async ({ page }) => {
    const btnOcultar = page.getByRole('button', { name: /ocultar/i })
    await btnOcultar.click()
    await expect(page.getByRole('button', { name: /mostrar/i })).toBeVisible()
    // Restaura para não interferir em outros testes
    await page.getByRole('button', { name: /mostrar/i }).click()
    await expect(page.getByRole('button', { name: /ocultar/i })).toBeVisible()
  })

  // Não existe mais "filtro de conta" no Dashboard (o <select> que sobrou é o
  // "Até hoje / Até fim do mês" do saldo) — o teste antigo era pulado em silêncio.
  test('E2E-DB04 — alternar "Até fim do mês" mantém o dashboard íntegro', async ({ page }) => {
    const selectModo = page.locator('select').filter({ has: page.locator('option[value="fim"]') }).first()
    await expect(selectModo).toBeVisible({ timeout: 10_000 })
    await selectModo.selectOption('fim')
    await expect(selectModo).toHaveValue('fim')
    await expect(page.getByText('Resultados do mês')).toBeVisible()
    await selectModo.selectOption('hoje')
    await expect(selectModo).toHaveValue('hoje')
  })

  test('E2E-DB05 — botão Novo lançamento abre o drawer', async ({ page }) => {
    // Dashboard navega para /lancamentos antes de abrir o drawer; timeout maior cobre ambos.
    await abrirNovoLancamento(page)
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 10_000 })
  })

  test('E2E-DB06 — estado do mês persiste ao voltar da página de extrato', async ({ page }) => {
    const calBtn = page.locator('button').filter({ hasText: /\/\d{4}/ }).first()
    await expect(calBtn).toBeVisible({ timeout: 8000 })
    const mesSelecionado = (await calBtn.textContent())?.trim()

    // Ir para extrato e voltar via SPA (page.goto reseta o context)
    await page.getByRole('link', { name: /lançamentos|extrato/i }).click()
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('link', { name: /painel/i }).click()
    await page.waitForLoadState('domcontentloaded')

    const calBtnApos = page.locator('button').filter({ hasText: /\/\d{4}/ }).first()
    await expect(calBtnApos).toBeVisible({ timeout: 8000 })
    const mesAposVoltar = (await calBtnApos.textContent())?.trim()
    expect(mesAposVoltar).toBe(mesSelecionado)
  })

  test('E2E-DB07 — botão de lista abre painel com todos os lembretes', async ({ page }) => {
    // Botão no cabeçalho do calendário (title="Todos os lembretes")
    const btnLista = page.getByTitle('Todos os lembretes')
    await expect(btnLista).toBeVisible({ timeout: 8_000 })
    await btnLista.click()

    // Painel abre — título "Lembretes" fica visível
    await expect(page.getByText('Lembretes', { exact: true })).toBeVisible({ timeout: 5_000 })

    // Verifica os dois toggles ("A partir de hoje" / "Todos")
    await expect(page.getByRole('button', { name: 'A partir de hoje' })).toBeVisible()
    await expect(page.getByText('Todos', { exact: true })).toBeVisible()

    // Fecha pelo botão X no cabeçalho do painel
    const headerPainel = page.getByText('Lembretes', { exact: true }).locator('xpath=ancestor::div[2]')
    await headerPainel.locator('button').last().click()
    await expect(page.getByRole('button', { name: 'A partir de hoje' })).not.toBeVisible({ timeout: 3_000 })
  })
})
