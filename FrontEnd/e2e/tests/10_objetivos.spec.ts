// e2e/tests/10_objetivos.spec.ts
// Cobre critérios de aceite: E2E-OBJ01 a E2E-OBJ07
import { test, expect } from '@playwright/test'

test.describe('Objetivos Financeiros', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/objetivos')
    // Aguarda a página terminar de carregar (heading ou empty state)
    await expect(
      page.getByRole('heading', { name: /objetivos financeiros/i })
    ).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-OBJ01 ───────────────────────────────────────────────
  test('E2E-OBJ01 — página /objetivos carrega com os elementos principais', async ({ page }) => {
    // Heading
    await expect(page.getByRole('heading', { name: /objetivos financeiros/i })).toBeVisible()

    // Botão "Novo objetivo"
    await expect(page.getByRole('button', { name: /novo objetivo/i })).toBeVisible()

    // Botão de sincronizar
    await expect(page.getByRole('button', { name: /sincronizar/i })).toBeVisible()

    // Tabs de filtro de tipo
    await expect(page.getByRole('button', { name: /todos/i }).first()).toBeVisible()
  })

  // ── E2E-OBJ02 ───────────────────────────────────────────────
  test('E2E-OBJ02 — sidebar tem link "Objetivos" que navega corretamente', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const link = page.getByRole('link', { name: /objetivos/i })
    await expect(link).toBeVisible({ timeout: 5_000 })
    await link.click()

    await expect(page).toHaveURL(/\/objetivos/)
    await expect(page.getByRole('heading', { name: /objetivos financeiros/i })).toBeVisible()
  })

  // ── E2E-OBJ03 ───────────────────────────────────────────────
  test('E2E-OBJ03 — clicar "Novo objetivo" abre drawer com seletor de tipo', async ({ page }) => {
    await page.getByRole('button', { name: /novo objetivo/i }).click()

    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible({ timeout: 5_000 })

    // Seletor de tipo com os tipos disponíveis (PROJETO está oculto por ora)
    await expect(drawer.getByText(/💰 patrim[ôo]nio/i)).toBeVisible()
    await expect(drawer.getByText(/🎯 renda recorrente/i)).toBeVisible()
    await expect(drawer.getByText(/📈 evolu[çc][ãa]o anual/i)).toBeVisible()

    // Campos obrigatórios visíveis
    await expect(drawer.getByPlaceholder(/fundo de emergência/i)).toBeVisible()

    // Fechar com Escape
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible({ timeout: 3_000 })
  })

  // ── E2E-OBJ04 ───────────────────────────────────────────────
  test('E2E-OBJ04 — selecionar tipo Renda Recorrente no drawer exibe campo de categoria', async ({ page }) => {
    await page.getByRole('button', { name: /novo objetivo/i }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible({ timeout: 5_000 })

    // Clica no tab "Renda Recorrente" (tipo OBJETIVO)
    await drawer.getByText(/🎯 renda recorrente/i).click()
    await page.waitForTimeout(200)

    // Campo "Categorias de receita" aparece
    await expect(drawer.getByText(/categorias? de receita/i)).toBeVisible()

    // Fechar
    await page.keyboard.press('Escape')
  })

  test('E2E-OBJ04b — selecionar tipo Patrimônio no drawer exibe campo de contas', async ({ page }) => {
    await page.getByRole('button', { name: /novo objetivo/i }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible({ timeout: 5_000 })

    // Clica no tab "Patrimônio" (tipo SONHO)
    await drawer.getByText(/💰 patrim[ôo]nio/i).click()
    await page.waitForTimeout(200)

    // Campo "Contas monitoradas" aparece
    await expect(drawer.getByText(/contas monitoradas/i)).toBeVisible()

    await page.keyboard.press('Escape')
  })

  // ── E2E-OBJ05 ───────────────────────────────────────────────
  test('E2E-OBJ05 — tabs de filtro de tipo funcionam (Patrimônio, Renda Recorrente, Evolução Anual, Todos)', async ({ page }) => {
    const tabPatrimonio = page.getByRole('button', { name: /💰 patrim[ôo]nio/i }).first()
    const tabRenda      = page.getByRole('button', { name: /🎯 renda recorrente/i }).first()
    const tabEvolucao   = page.getByRole('button', { name: /📈 evolu[çc][ãa]o anual/i }).first()
    const tabTodos      = page.getByRole('button', { name: /^todos$/i }).first()

    // Tabs existem (PROJETO está oculto por ora)
    await expect(tabPatrimonio).toBeVisible()
    await expect(tabRenda).toBeVisible()
    await expect(tabEvolucao).toBeVisible()
    await expect(tabTodos).toBeVisible()

    // Clicando em cada tab não gera erro (navegação sem crash)
    await tabPatrimonio.click()
    await page.waitForTimeout(300)

    await tabRenda.click()
    await page.waitForTimeout(300)

    await tabEvolucao.click()
    await page.waitForTimeout(300)

    // Volta para "Todos"
    await tabTodos.click()
    await page.waitForTimeout(300)

    // Página ainda está em /objetivos, sem erros visíveis
    await expect(page).toHaveURL(/\/objetivos/)
  })

  // ── E2E-OBJ06 ───────────────────────────────────────────────
  test('E2E-OBJ06 — botão Sincronizar é clicável e não gera crash', async ({ page }) => {
    const btnSync = page.getByRole('button', { name: /sincronizar/i })
    await expect(btnSync).toBeVisible()
    await expect(btnSync).toBeEnabled()

    await btnSync.click()
    await page.waitForTimeout(1500)

    // Página permanece em /objetivos sem crash
    await expect(page).toHaveURL(/\/objetivos/)
    await expect(page.getByRole('heading', { name: /objetivos financeiros/i })).toBeVisible()
  })

  // ── E2E-OBJ07 ───────────────────────────────────────────────
  test('E2E-OBJ07 — estado vazio exibe mensagem e botão de criação', async ({ page }) => {
    // Aguarda o React Query terminar: spinner some e cards ou empty-state aparecem.
    // networkidle espera todas as requisições HTTP (incluindo /objetivos) resolverem.
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(300) // margem para re-render pós-fetch

    const cards     = page.locator('.rounded-xl').first()
    const vazioText = page.getByText(/nenhum objetivo encontrado/i)

    // Aguarda qualquer um dos dois se tornar visível
    await Promise.race([
      cards.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {}),
      vazioText.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {}),
    ])

    const temCards = await cards.isVisible().catch(() => false)
    const temVazio = await vazioText.isVisible().catch(() => false)

    // Ou há cards ou há empty state — nunca nada
    expect(temCards || temVazio).toBe(true)

    // Se empty state, botão "Criar primeiro objetivo" existe
    if (temVazio) {
      await expect(
        page.getByRole('button', { name: /criar primeiro objetivo/i })
      ).toBeVisible()
    }
  })

})
