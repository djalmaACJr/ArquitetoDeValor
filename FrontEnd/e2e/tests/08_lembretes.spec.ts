// e2e/tests/08_lembretes.spec.ts
import { test, expect } from '@playwright/test'
import { abrirNovoLancamento, preencherValor } from './helpers'

const HOJE = new Date().getDate()
const DESCRICAO_TESTE = 'E2E Lembrete Teste'

test.describe('Lembretes', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Resultados do mês')).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-LEM01 ───────────────────────────────────────────────
  test('E2E-LEM01 — calendário do Dashboard é visível', async ({ page }) => {
    // CalendarioDashboard renderiza uma grade de 7 colunas
    const calendario = page.locator('.grid-cols-7').first()
    await expect(calendario).toBeVisible({ timeout: 8_000 })
  })

  // ── E2E-LEM02 ───────────────────────────────────────────────
  test('E2E-LEM02 — clicar no dia de hoje abre painel de detalhes', async ({ page }) => {
    // Localiza o botão do dia de hoje pelo número exato
    const botaoDia = page.locator('button').filter({ hasText: new RegExp(`^${HOJE}$`) }).first()
    await expect(botaoDia).toBeVisible({ timeout: 8_000 })
    await botaoDia.click()

    // Painel de detalhes aparece com a data formatada
    await expect(page.getByText(new RegExp(`${String(HOJE).padStart(2, '0')}`, 'i')).first())
      .toBeVisible({ timeout: 3_000 })
  })

  // ── E2E-LEM03 ───────────────────────────────────────────────
  test('E2E-LEM03 — botão "+" no painel abre ModalLembrete', async ({ page }) => {
    // Abre painel do dia de hoje
    const botaoDia = page.locator('button').filter({ hasText: new RegExp(`^${HOJE}$`) }).first()
    await botaoDia.click()
    await page.waitForTimeout(300)

    // Clica no botão "+" (Novo lembrete)
    const btnNovo = page.locator('button[title="Novo lembrete"]')
    await expect(btnNovo).toBeVisible({ timeout: 3_000 })
    await btnNovo.click()

    // Dialog do modal aparece
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5_000 })
  })

  // ── E2E-LEM04 ───────────────────────────────────────────────
  test('E2E-LEM04 — criar lembrete pelo modal; reabrindo o dia, Bell icon aparece', async ({ page }) => {
    // Abre painel e clica em "+"
    const botaoDia = page.locator('button').filter({ hasText: new RegExp(`^${HOJE}$`) }).first()
    await botaoDia.click()
    await page.waitForTimeout(300)
    await page.locator('button[title="Novo lembrete"]').click()

    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Preenche descrição (a data já está preenchida com hoje)
    const inputDescricao = dialog.getByPlaceholder(/descrição|lembrete/i)
    await inputDescricao.fill(DESCRICAO_TESTE)

    // Salva (botão diz "Criar lembrete" ao criar)
    await dialog.getByRole('button', { name: /criar lembrete/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 8_000 })

    // Fecha e reabre o painel do dia para verificar
    await page.waitForTimeout(500)
    const botaoDiaApos = page.locator('button').filter({ hasText: new RegExp(`^${HOJE}$`) }).first()
    await botaoDiaApos.click()
    await page.waitForTimeout(300)

    // Lembrete deve aparecer listado (Bell icon + descrição)
    await expect(page.getByText(DESCRICAO_TESTE).first()).toBeVisible({ timeout: 5_000 })
  })

  // ── E2E-LEM05 ───────────────────────────────────────────────
  test('E2E-LEM05 — clicar ícone check marca lembrete como concluído', async ({ page }) => {
    // Abre painel do dia
    const botaoDia = page.locator('button').filter({ hasText: new RegExp(`^${HOJE}$`) }).first()
    await botaoDia.click()
    await page.waitForTimeout(300)

    // Localiza o lembrete de teste
    const itemLembrete = page.locator('div').filter({ hasText: DESCRICAO_TESTE }).first()
    await expect(itemLembrete).toBeVisible({ timeout: 5_000 })

    // Clica no botão check (Concluído)
    const btnCheck = itemLembrete.locator('button[title="Concluído"]')
    await expect(btnCheck).toBeVisible({ timeout: 3_000 })
    await btnCheck.click()
    await page.waitForTimeout(500)

    // Descrição deve aparecer riscada (line-through)
    const textoLembrete = page.getByText(DESCRICAO_TESTE).first()
    await expect(textoLembrete).toBeVisible()
    const style = await textoLembrete.getAttribute('style') ?? ''
    const hasLineThrough = style.includes('line-through') ||
      await textoLembrete.evaluate((el) => getComputedStyle(el).textDecoration.includes('line-through'))
    expect(hasLineThrough).toBe(true)
  })

  // ── E2E-LEM06 ───────────────────────────────────────────────
  test('E2E-LEM06 — editar lembrete pelo ícone lápis atualiza descrição', async ({ page }) => {
    // Abre painel do dia
    const botaoDia = page.locator('button').filter({ hasText: new RegExp(`^${HOJE}$`) }).first()
    await botaoDia.click()
    await page.waitForTimeout(300)

    // Navega a partir do span (texto) para o div-item pai — evita pegar o container do painel
    const spanLembrete = page.locator('span').filter({ hasText: DESCRICAO_TESTE }).first()
    const itemLembrete = spanLembrete.locator('..')
    await expect(spanLembrete).toBeVisible({ timeout: 5_000 })

    // Botões no item: 0=check, 1=lápis, 2=lixo
    const btnEditar = itemLembrete.locator('button').nth(1)
    await btnEditar.click()

    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Altera a descrição
    const inputDescricao = dialog.getByPlaceholder(/descrição|lembrete/i)
    await inputDescricao.clear()
    await inputDescricao.fill('E2E Lembrete Editado')

    // Botão diz "Atualizar" ao editar
    await dialog.getByRole('button', { name: /atualizar/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 8_000 })
    await page.waitForTimeout(500)

    // Verifica no painel que a descrição mudou
    const botaoDiaApos = page.locator('button').filter({ hasText: new RegExp(`^${HOJE}$`) }).first()
    await botaoDiaApos.click()
    await expect(page.getByText('E2E Lembrete Editado').first()).toBeVisible({ timeout: 5_000 })
  })

  // ── E2E-LEM07 ───────────────────────────────────────────────
  test('E2E-LEM07 — excluir lembrete; item some da lista do dia', async ({ page }) => {
    // Abre painel do dia
    const botaoDia = page.locator('button').filter({ hasText: new RegExp(`^${HOJE}$`) }).first()
    await botaoDia.click()
    await page.waitForTimeout(300)

    const spanLembrete = page.locator('span').filter({ hasText: 'E2E Lembrete Editado' }).first()
    const itemLembrete = spanLembrete.locator('..')
    await expect(spanLembrete).toBeVisible({ timeout: 5_000 })

    // Último botão no item é o ícone lixeira
    const btnExcluir = itemLembrete.locator('button').last()
    await btnExcluir.click()
    await page.waitForTimeout(500)

    // Lembrete não deve mais aparecer
    await expect(page.getByText('E2E Lembrete Editado')).not.toBeVisible({ timeout: 5_000 })
  })

  // ── E2E-LEM08 ───────────────────────────────────────────────
  test('E2E-LEM08 — botão global "Novo lançamento" → opção "Lembrete" abre ModalLembrete', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /^novo lançamento$/i })
    await trigger.hover()
    await page.waitForTimeout(250)

    // Clica na opção Lembrete no dropdown
    await page.getByRole('button', { name: /^lembrete$/i }).first().click()

    // Modal de lembrete deve abrir
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5_000 })

    // Fecha com Escape
    await page.keyboard.press('Escape')
  })

  // ── E2E-LEM09 ───────────────────────────────────────────────
  test('E2E-LEM09 — DrawerLancamento com data futura exibe checkbox "Criar lembrete"', async ({ page }) => {
    await page.goto('/lancamentos')
    await abrirNovoLancamento(page)

    const drawer = page.getByRole('dialog').first()
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(400)

    // Define data futura no campo de data
    const amanha = new Date()
    amanha.setDate(amanha.getDate() + 1)
    const dataStr = amanha.toISOString().split('T')[0]

    const inputData = drawer.locator('input[type="date"]').first()
    await inputData.fill(dataStr)
    await page.waitForTimeout(300)

    // Checkbox "Criar lembrete" deve aparecer
    const checkboxLabel = drawer.getByText(/criar lembrete/i)
    await expect(checkboxLabel).toBeVisible({ timeout: 3_000 })

    // Checkbox deve ser clicável
    const checkbox = drawer.locator('input[type="checkbox"]').first()
    await expect(checkbox).toBeVisible()
    await checkbox.check()
    await expect(checkbox).toBeChecked()

    await page.keyboard.press('Escape')
  })
})
