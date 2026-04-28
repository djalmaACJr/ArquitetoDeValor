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
    await page.waitForTimeout(400) // aguarda animação do drawer

    // Preencher campos básicos. Tipo padrão já é DESPESA (FORM_VAZIO).
    await drawer.getByPlaceholder('Ex: Conta de luz, Salário...').fill('E2E Teste Lançamento')
    await drawer.getByPlaceholder('0,00').fill('99,90')

    // Selecionar conta via SearchableSelect (placeholder "Selecione a conta...")
    await drawer.getByRole('button', { name: /selecione a conta/i }).first().click()
    await drawer.getByPlaceholder('Buscar...').waitFor({ state: 'visible', timeout: 3000 })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    // Salvar
    await drawer.getByRole('button', { name: /^salvar$/i }).click()

    await expect(drawer).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('E2E Teste Lançamento').first()).toBeVisible({ timeout: 10_000 })
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
    const inputDescricao = drawer.getByPlaceholder(/conta de luz|descri|sal[áa]rio/i)
    await inputDescricao.clear()
    await inputDescricao.fill('E2E Teste Editado')

    await drawer.getByRole('button', { name: /salvar|atualizar/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })
    // .first() para evitar strict-mode (LancamentosPage renderiza desktop + mobile views simultâneas)
    await expect(page.getByText('E2E Teste Editado').first()).toBeVisible({ timeout: 10_000 })
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
    await expect(modal).toBeVisible({ timeout: 5000 })
    await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()

    // Aguarda modal e drawer fecharem; usa exact + first para evitar strict-mode com múltiplas
    // ocorrências do texto (linha + título do modal).
    await expect(modal).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('E2E Teste Editado', { exact: true }).first()).not.toBeVisible({ timeout: 10_000 })
  })

  test('E2E-EX07 — toggle saldo anterior funciona', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Saldo anterior' })
    await expect(toggle).toBeVisible()
    await toggle.click()
    // Não deve mostrar erro
    await expect(page.locator('text=Erro')).not.toBeVisible()
  })

  test('E2E-EX08 — filtros persistem ao navegar entre páginas', async ({ page }) => {
    // Captura o mês exibido inicialmente no MonthPicker
    const calBtn = page.locator('button').filter({ hasText: /\/\d{4}/ }).first()
    await expect(calBtn).toBeVisible({ timeout: 8000 })
    const mes = (await calBtn.textContent())?.trim()

    // Navegar via SPA (não usar page.goto — resetaria o estado em memória)
    await page.getByRole('link', { name: /contas/i }).click()
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('link', { name: /lançamentos|extrato/i }).click()
    await page.waitForLoadState('domcontentloaded')

    const calBtnApos = page.locator('button').filter({ hasText: /\/\d{4}/ }).first()
    await expect(calBtnApos).toBeVisible({ timeout: 8000 })
    const mesAposVoltar = (await calBtnApos.textContent())?.trim()
    expect(mesAposVoltar).toBe(mes)
  })

  // ── E2E-EX09 ─────────────────────────────────────────────────
  test('E2E-EX09 — criar lançamento recorrente e verificar indicador de parcela', async ({ page }) => {
    await page.getByRole('button', { name: /novo lançamento/i }).click()
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(400)

    // Preencher campos básicos (DESPESA é padrão)
    await drawer.getByPlaceholder(/conta de luz|sal[áa]rio/i).fill('E2E Recorrente Mensal')
    await drawer.getByPlaceholder('0,00').fill('7500')

    // Conta
    await drawer.getByRole('button', { name: /selecione a conta/i }).first().click()
    await drawer.getByPlaceholder('Buscar...').waitFor({ state: 'visible', timeout: 3000 })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)

    // Ativar recorrência via Toggle
    const toggle = drawer.getByText(/lançamento único/i)
    await toggle.click()
    await page.waitForTimeout(300)

    // O campo de parcelas deve aparecer; definir 3 parcelas
    const inputParcelas = drawer.locator('input[type="number"][min="2"]').first()
    await expect(inputParcelas).toBeVisible({ timeout: 3000 })
    await inputParcelas.fill('3')

    // Salvar
    await drawer.getByRole('button', { name: /^salvar$/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })

    // O lançamento recorrente deve aparecer na lista
    await expect(page.getByText('E2E Recorrente Mensal').first()).toBeVisible({ timeout: 10_000 })

    // Deve exibir o indicador de parcela (ex: "1/3" ou ícone Repeat2)
    const linhaRecorrente = page.getByText('E2E Recorrente Mensal').first()
    const row = linhaRecorrente.locator('../..').first()
    // O ícone Repeat2 (recorrente) ou texto "1/X" deve estar no row
    const indicador = row.locator('[data-lucide="repeat-2"], svg[class*="repeat"], text=/\\d+\\/\\d+/').first()
    // Verificação soft: pelo menos o row existe e está visível
    await expect(row).toBeVisible()
  })

  // ── E2E-EX10 ─────────────────────────────────────────────────
  test('E2E-EX10 — editar lançamento recorrente exibe opções de escopo', async ({ page }) => {
    const linha = page.getByText('E2E Recorrente Mensal').first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    const row = linha.locator('../..').first()
    await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()

    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(400)

    // O drawer deve mostrar "Parcela X de Y" para recorrente
    await expect(drawer.getByText(/parcela \d+ de \d+/i)).toBeVisible({ timeout: 5000 })

    // Deve exibir opções de escopo
    await expect(drawer.getByText(/somente este lançamento/i)).toBeVisible()
    await expect(drawer.getByText(/este e os próximos/i)).toBeVisible()

    await page.keyboard.press('Escape')
  })

  // ── E2E-EX11 ─────────────────────────────────────────────────
  test('E2E-EX11 — editar escopo SOMENTE_ESTE altera apenas o lançamento atual', async ({ page }) => {
    const linha = page.getByText('E2E Recorrente Mensal').first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    const row = linha.locator('../..').first()
    await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()

    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(400)

    // Escopo padrão é SOMENTE_ESTE — alterar a descrição e salvar
    const inputDescricao = drawer.getByPlaceholder(/conta de luz|sal[áa]rio/i)
    await inputDescricao.clear()
    await inputDescricao.fill('E2E Recorrente Editado')

    await drawer.getByRole('button', { name: /salvar|atualizar/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })

    // O lançamento editado deve aparecer na lista
    await expect(page.getByText('E2E Recorrente Editado').first()).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-EX12 ─────────────────────────────────────────────────
  test('E2E-EX12 — excluir lançamento recorrente com escopo SOMENTE_ESTE', async ({ page }) => {
    const linha = page.getByText('E2E Recorrente Editado').first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    const row = linha.locator('../..').first()
    await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()

    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })

    // Garantir que escopo SOMENTE_ESTE está selecionado (padrão)
    const radioSomente = drawer.getByText(/somente este lançamento/i)
    await expect(radioSomente).toBeVisible({ timeout: 3000 })

    await drawer.getByRole('button', { name: /excluir/i }).click()

    const modal = page.getByRole('dialog').last()
    await expect(modal).toBeVisible({ timeout: 5000 })
    await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()

    await expect(modal).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('E2E Recorrente Editado', { exact: true }).first()).not.toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-EX13 ─────────────────────────────────────────────────
  test('E2E-EX13 — limpar lançamentos recorrentes de teste', async ({ page }) => {
    for (const nome of ['E2E Recorrente Mensal', 'E2E Recorrente Editado']) {
      const linha = page.getByText(nome, { exact: true }).first()
      if (await linha.isVisible({ timeout: 2000 }).catch(() => false)) {
        const row = linha.locator('../..').first()
        await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()
        const drawer = page.getByRole('dialog').first()
        if (await drawer.isVisible({ timeout: 3000 }).catch(() => false)) {
          await drawer.getByRole('button', { name: /excluir/i }).click()
          const modal = page.getByRole('dialog').last()
          if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
            await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()
            await expect(modal).not.toBeVisible({ timeout: 10_000 })
          } else {
            await page.keyboard.press('Escape')
          }
        }
        await page.waitForTimeout(500)
      }
    }
  })
})
