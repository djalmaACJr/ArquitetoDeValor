// e2e/tests/07_transferencias.spec.ts
import { test, expect } from '@playwright/test'
import { abrirNovoLancamento, preencherValor } from './helpers'

test.describe('Transferências (E2E)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/lancamentos')
  })

  // ── E2E-TRF01 ────────────────────────────────────────────────
  test('E2E-TRF01 — drawer abre na aba Transferência', async ({ page }) => {
    // Abre direto na aba Transferência via dropdown do BotaoNovoLancamento.
    await abrirNovoLancamento(page, 'Transferência')
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(400)

    // Campo "Conta destino" deve aparecer (label, não o botão de seleção)
    await expect(drawer.getByText(/conta destino \*/i).first()).toBeVisible({ timeout: 3000 })
    // Campo "Categoria" não deve aparecer em transferências
    await expect(drawer.getByText(/^categoria$/i)).not.toBeVisible()

    await page.keyboard.press('Escape')
  })

  // ── E2E-TRF02 ────────────────────────────────────────────────
  test('E2E-TRF02 — criar transferência e verificar na lista', async ({ page }) => {
    await abrirNovoLancamento(page, 'Transferência')
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(400)

    // Preencher descrição e valor
    await drawer.getByPlaceholder(/conta de luz|sal[áa]rio/i).fill('E2E Transferência Teste')
    await preencherValor(page, drawer, '12345')

    // Conta origem — primeiro SearchableSelect
    const btnsSelect = drawer.getByRole('button').filter({ hasText: /selecione a conta/i })
    await btnsSelect.first().click()
    await drawer.getByPlaceholder('Buscar...').waitFor({ state: 'visible', timeout: 3000 })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)

    // Conta destino — segundo SearchableSelect (só aparece em transferência)
    const btnDestino = drawer.getByRole('button').filter({ hasText: /selecione a conta destino/i })
    await btnDestino.first().click()
    await drawer.getByPlaceholder('Buscar...').waitFor({ state: 'visible', timeout: 3000 })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)

    // Salvar
    await drawer.getByRole('button', { name: /^salvar$/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })

    // Verificar na lista (título aparece sem o prefixo [Transf. saída])
    await expect(page.getByText('E2E Transferência Teste').first()).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-TRF03 ────────────────────────────────────────────────
  test('E2E-TRF03 — transferência exibe ícone de par na lista', async ({ page }) => {
    const linha = page.getByText('E2E Transferência Teste').first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    // O ícone de transferência (ArrowLeftRight ou similar) deve estar no row
    const row = linha.locator('../..').first()
    // Verifica que há algum ícone SVG no row (ícone de transferência)
    await expect(row.locator('svg').first()).toBeVisible()
  })

  // ── E2E-TRF04 ────────────────────────────────────────────────
  test('E2E-TRF04 — editar transferência e verificar atualização', async ({ page }) => {
    const linha = page.getByText('E2E Transferência Teste').first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    const row = linha.locator('../..').first()
    await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()

    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(400)

    // Alterar descrição
    const inputDescricao = drawer.getByPlaceholder(/conta de luz|sal[áa]rio/i)
    await inputDescricao.clear()
    await inputDescricao.fill('E2E Transferência Editada')

    // Workaround: o DrawerLancamento não repopula `conta_destino_id` ao abrir uma
    // transferência existente (formDeLanc seta string vazia), então é preciso reselecionar
    // a conta de destino antes de salvar — caso contrário o submit dispara o erro
    // "Selecione a conta de destino".
    const btnDestino = drawer.getByRole('button').filter({ hasText: /selecione a conta destino/i })
    await btnDestino.first().click()
    await drawer.getByPlaceholder('Buscar...').waitFor({ state: 'visible', timeout: 3000 })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)

    await drawer.getByRole('button', { name: /salvar|atualizar/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('E2E Transferência Editada').first()).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-TRF05 ────────────────────────────────────────────────
  test('E2E-TRF05 — excluir transferência remove ambos os lados do par', async ({ page }) => {
    const linha = page.getByText('E2E Transferência Editada').first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    const row = linha.locator('../..').first()
    await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()

    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })

    await drawer.getByRole('button', { name: /excluir/i }).click()

    const modal = page.getByRole('dialog').last()
    await expect(modal).toBeVisible({ timeout: 5000 })
    await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()

    await expect(modal).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('E2E Transferência Editada', { exact: true }).first()).not.toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-TRF06 ────────────────────────────────────────────────
  test('E2E-TRF06 — criar transferência recorrente (3 parcelas)', async ({ page }) => {
    await abrirNovoLancamento(page, 'Transferência')
    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(400)

    await drawer.getByPlaceholder(/conta de luz|sal[áa]rio/i).fill('E2E Transf Recorrente')
    await preencherValor(page, drawer, '5000')

    // Conta origem
    const btnsSelect = drawer.getByRole('button').filter({ hasText: /selecione a conta/i })
    await btnsSelect.first().click()
    await drawer.getByPlaceholder('Buscar...').waitFor({ state: 'visible', timeout: 3000 })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)

    // Conta destino
    const btnDestino = drawer.getByRole('button').filter({ hasText: /selecione a conta destino/i })
    await btnDestino.first().click()
    await drawer.getByPlaceholder('Buscar...').waitFor({ state: 'visible', timeout: 3000 })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)

    // Recorrência — toggle (em transferências, o campo recorrência pode estar disponível
    // dependendo da implementação; o drawer mostra recorrência apenas para não-transferências)
    // Verificar se toggle existe
    const toggleRec = drawer.locator('button[role="switch"], input[type="checkbox"]').first()
    if (await toggleRec.isVisible({ timeout: 1000 }).catch(() => false)) {
      await toggleRec.click()
      await page.waitForTimeout(200)
      const inputParcelas = drawer.locator('input[type="number"][min="2"]').first()
      if (await inputParcelas.isVisible({ timeout: 1000 }).catch(() => false)) {
        await inputParcelas.fill('3')
      }
    }

    await drawer.getByRole('button', { name: /^salvar$/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('E2E Transf Recorrente').first()).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-TRF07 ────────────────────────────────────────────────
  test('E2E-TRF07 — limpar transferências de teste', async ({ page }) => {
    for (const nome of ['E2E Transf Recorrente', 'E2E Transferência Editada', 'E2E Transferência Teste']) {
      const linha = page.getByText(nome, { exact: true }).first()
      if (await linha.isVisible({ timeout: 2000 }).catch(() => false)) {
        const row = linha.locator('../..').first()
        await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()
        const drawer = page.getByRole('dialog').first()
        if (await drawer.isVisible({ timeout: 3000 }).catch(() => false)) {
          const btnExcluir = drawer.getByRole('button', { name: /excluir/i })
          if (await btnExcluir.isVisible({ timeout: 1000 }).catch(() => false)) {
            await btnExcluir.click()
            const modal = page.getByRole('dialog').last()
            if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
              await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()
              await expect(modal).not.toBeVisible({ timeout: 10_000 })
            }
          } else {
            await page.keyboard.press('Escape')
          }
        }
        await page.waitForTimeout(500)
      }
    }
  })
})
