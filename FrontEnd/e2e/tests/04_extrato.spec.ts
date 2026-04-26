// e2e/tests/02_extrato.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Extrato (Lançamentos)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/lancamentos')
  })

  test('E2E-EX01 — página carrega com filtros na barra superior', async ({ page }) => {
    await expect(page.getByText(/todas as contas/i)).toBeVisible()
    // Usar seletores mais específicos para evitar strict mode violation
    await expect(page.getByRole('button', { name: /categorias/i }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /todos status/i })).toBeVisible()
  })

  test('E2E-EX02 — navegação de mês com setas funciona', async ({ page }) => {
    const mesInicial = await page.locator('button:has-text("/2")').first().textContent()
    await page.locator('[title*="Próximo"], button:nth-child(3)').first().click()
    const mesDepois = await page.locator('button:has-text("/2")').first().textContent()
    expect(mesInicial).not.toBe(mesDepois)
  })

  test('E2E-EX03 — botão Novo lançamento abre drawer', async ({ page }) => {
    await page.getByRole('button', { name: /novo lançamento/i }).click()
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 })
  })

  test('E2E-EX04 — criar lançamento simples e verificar na lista', async ({ page }) => {
    await page.getByRole('button', { name: /novo lançamento/i }).click()
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible()

    // Preencher formulário
    await drawer.getByPlaceholder(/descrição/i).fill('E2E Teste Lançamento')
    await drawer.getByPlaceholder(/valor/i).fill('99,90')

    // Selecionar tipo DESPESA se não estiver selecionado
    const btnDespesa = drawer.getByRole('button', { name: /despesa/i })
    if (await btnDespesa.isVisible()) await btnDespesa.click()

    // Salvar
    await drawer.getByRole('button', { name: /salvar|criar/i }).click()

    // Aguarda drawer fechar
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })

    // Verificar que aparece na lista
    await expect(page.getByText('E2E Teste Lançamento')).toBeVisible({ timeout: 10_000 })
  })

  test('E2E-EX05 — editar lançamento criado', async ({ page }) => {
    // Localizar o lançamento criado no teste anterior
    const linha = page.locator('text=E2E Teste Lançamento').first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    // Clicar no botão de editar
    const row = linha.locator('../..').first()
    await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()

    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible()

    // Alterar descrição
    const inputDescricao = drawer.getByPlaceholder(/descrição/i)
    await inputDescricao.clear()
    await inputDescricao.fill('E2E Teste Editado')

    await drawer.getByRole('button', { name: /salvar|atualizar/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('E2E Teste Editado')).toBeVisible({ timeout: 10_000 })
  })

  test('E2E-EX06 — excluir lançamento', async ({ page }) => {
    const linha = page.locator('text=E2E Teste Editado').first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    const row = linha.locator('../..').first()
    await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()

    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })

    await drawer.getByRole('button', { name: /excluir/i }).click()

    // Modal de confirmação
    const modal = page.getByRole('dialog').last()
    await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()

    await expect(page.getByText('E2E Teste Editado')).not.toBeVisible({ timeout: 10_000 })
  })

  test('E2E-EX07 — toggle saldo anterior funciona', async ({ page }) => {
    const toggle = page.getByText(/saldo anterior/i)
    await expect(toggle).toBeVisible()
    await toggle.click()
    // Não deve mostrar erro
    await expect(page.locator('text=Erro')).not.toBeVisible()
  })

  test('E2E-EX08 — filtros persistem ao navegar entre páginas', async ({ page }) => {
    // Selecionar mês diferente do atual
    await page.locator('[title*="anterior"]').first().click().catch(() => {})
    const mes = await page.locator('button:has-text("/2")').first().textContent()

    // Ir para contas e voltar
    await page.getByRole('link', { name: /contas/i }).click()
    await page.getByRole('link', { name: /lançamentos|extrato/i }).click()

    const mesAposVoltar = await page.locator('button:has-text("/2")').first().textContent()
    expect(mes).toBe(mesAposVoltar)
  })
})
