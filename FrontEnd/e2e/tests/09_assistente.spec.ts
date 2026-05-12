// e2e/tests/09_assistente.spec.ts
import { test, expect } from '@playwright/test'
import { abrirNovoLancamento, preencherValor } from './helpers'

const DESCRICAO_TESTE = 'E2E Assistente Mercado'

test.describe('Assistente de Lançamentos', () => {

  // Garante que há pelo menos uma sugestão salva antes dos testes de busca
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/lancamentos')
    await abrirNovoLancamento(page)
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(400)

    // Preenche descrição + valor + seleciona conta para gerar sugestão ao salvar
    await drawer.getByPlaceholder(/Ex: Conta de luz|descri|sal[áa]rio/i).fill(DESCRICAO_TESTE)
    await preencherValor(page, drawer, '100')

    // Seleciona conta
    await drawer.getByRole('button', { name: /selecione a conta/i }).first().click()
    await page.waitForTimeout(300)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    // Seleciona categoria
    const btnCat = drawer.getByRole('button', { name: /selecione/i }).first()
    if (await btnCat.isVisible()) {
      await btnCat.click()
      await page.waitForTimeout(300)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
    }

    // Salva o lançamento (isso dispara salvarSugestao no DrawerLancamento)
    await drawer.getByRole('button', { name: /^salvar$/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })
    await page.close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/lancamentos')
  })

  // ── E2E-ASS01 ───────────────────────────────────────────────
  test('E2E-ASS01 — digitar 2+ caracteres abre dropdown de sugestões', async ({ page }) => {
    await abrirNovoLancamento(page)
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(400)

    // Digita o início da descrição cadastrada
    const inputDesc = drawer.getByPlaceholder(/Ex: Conta de luz|descri|sal[áa]rio/i)
    await inputDesc.fill('E2E Assi')
    await page.waitForTimeout(600) // debounce de 300ms + latência de rede

    // Dropdown "Sugestões do assistente" deve aparecer
    await expect(page.getByText(/sugestões do assistente/i).first()).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })

  // ── E2E-ASS02 ───────────────────────────────────────────────
  test('E2E-ASS02 — clicar em sugestão preenche os campos do drawer', async ({ page }) => {
    await abrirNovoLancamento(page)
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(400)

    const inputDesc = drawer.getByPlaceholder(/Ex: Conta de luz|descri|sal[áa]rio/i)
    await inputDesc.fill('E2E Assi')
    await page.waitForTimeout(600)

    // Clica no botão da sugestão — force:true porque o drawer intercepta pointer events
    const primeiraSugestao = drawer.locator('button').filter({ hasText: DESCRICAO_TESTE }).first()
    await expect(primeiraSugestao).toBeVisible({ timeout: 5_000 })
    await primeiraSugestao.click({ force: true })
    await page.waitForTimeout(300)

    // Campo descrição deve estar preenchido com a sugestão
    await expect(inputDesc).toHaveValue(DESCRICAO_TESTE, { timeout: 3_000 })

    // Ícone Sparkles aparece indicando preenchimento pelo assistente
    await expect(drawer.locator('[aria-label="Preenchido pelo assistente"]')).toBeVisible({ timeout: 3_000 })

    await page.keyboard.press('Escape')
  })

  // ── E2E-ASS03 ───────────────────────────────────────────────
  test('E2E-ASS03 — tecla Escape fecha o dropdown sem aplicar sugestão', async ({ page }) => {
    await abrirNovoLancamento(page)
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(400)

    const inputDesc = drawer.getByPlaceholder(/Ex: Conta de luz|descri|sal[áa]rio/i)
    await inputDesc.fill('E2E Assi')
    await page.waitForTimeout(600)

    await expect(page.getByText(/sugestões do assistente/i).first()).toBeVisible({ timeout: 5_000 })

    // Pressiona Escape — dropdown deve fechar, campo mantém o que foi digitado
    await page.keyboard.press('Escape')
    await expect(page.getByText(/sugestões do assistente/i)).not.toBeVisible({ timeout: 3_000 })
    await expect(inputDesc).toHaveValue('E2E Assi')

    await page.keyboard.press('Escape')
  })

  // ── E2E-ASS04 ───────────────────────────────────────────────
  test('E2E-ASS04 — teclas ↑↓ navegam na lista e Enter aplica sugestão', async ({ page }) => {
    await abrirNovoLancamento(page)
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(400)

    const inputDesc = drawer.getByPlaceholder(/Ex: Conta de luz|descri|sal[áa]rio/i)
    await inputDesc.fill('E2E Assi')
    await page.waitForTimeout(600)

    await expect(page.getByText(/sugestões do assistente/i).first()).toBeVisible({ timeout: 5_000 })

    // Navega com seta para baixo e aplica com Enter
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    // Campo deve estar preenchido com a sugestão
    await expect(inputDesc).toHaveValue(DESCRICAO_TESTE, { timeout: 3_000 })

    await page.keyboard.press('Escape')
  })
})
