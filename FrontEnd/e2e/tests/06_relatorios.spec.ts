// e2e/tests/05_relatorios.spec.ts
import { test, expect } from '@playwright/test'
import { vigiarErrosDeRender } from './helpers'

test.describe('Relatórios', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/relatorios')
  })

  test('E2E-REL01 — página carrega com filtros', async ({ page }) => {
    await expect(page.getByRole('button', { name: /gerar relatório/i })).toBeVisible()
    // Escopa pra `<main>` — o sidebar passou a ter o link "Comparativo Períodos"
    // que casaria com /período/i e causaria strict-mode violation.
    await expect(page.locator('main').getByText(/período/i).first()).toBeVisible()
  })

  test('E2E-REL02 — gerar relatório exibe tabela', async ({ page }) => {
    await page.getByRole('button', { name: /gerar relatório/i }).click()

    // Aguarda resultado - usa seletores mais específicos
    await expect(page.getByText('Total Receitas')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible()
    await expect(page.getByText('Débitos', { exact: true })).toBeVisible()
  })

  // Regressão: com /categorias e /contas falhando (ex.: 403 num espaço de agregado
  // sem permissão), o padrão `data = []` dos hooks virava um array novo a cada
  // render e a página entrava em loop ("Maximum update depth exceeded").
  test('E2E-REL08 — APIs de categorias/contas/transações falhando não causam loop de render', async ({ page }) => {
    const erros = vigiarErrosDeRender(page)
    for (const rota of ['categorias', 'contas', 'transacoes']) {
      await page.route(`**/functions/v1/${rota}*`, r =>
        r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ erro: 'Sem permissão' }) }))
    }
    await page.goto('/relatorios')
    await expect(page.getByRole('button', { name: /gerar relatório/i })).toBeVisible()
    await page.getByRole('button', { name: /gerar relatório/i }).click()
    await page.waitForTimeout(2_000)
    // A página segue responsiva e sem erro de render
    await expect(page.getByRole('button', { name: /gerar relatório/i })).toBeVisible()
    expect(erros()).toEqual([])
  })

  // Regressão de layout (visto no celular): o seletor "Até" estourava a borda do cartão
  // e os 3 selects de filtro (larguras fixas) se sobrepunham. Vale p/ os dois projetos.
  test('E2E-REL09 — filtros não estouram o cartão nem se sobrepõem', async ({ page }) => {
    await expect(page.getByRole('button', { name: /gerar relatório/i })).toBeVisible()
    const largura = page.viewportSize()!.width
    const periodo = await page.locator('[data-tutorial="relatorios-periodo"]').boundingBox()
    expect(periodo!.x + periodo!.width).toBeLessThanOrEqual(largura)

    const caixas = await page.locator('[data-tutorial="relatorios-filtros"] button').evaluateAll(els =>
      els.map(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width } })
         .filter(c => c.w > 0))
    for (const c of caixas) expect(c.r).toBeLessThanOrEqual(largura)
    for (let i = 0; i < caixas.length; i++) {
      for (let j = i + 1; j < caixas.length; j++) {
        const A = caixas[i], B = caixas[j]
        const sobrepoe = A.x < B.r - 1 && B.x < A.r - 1 && A.y < B.b - 1 && B.y < A.b - 1
        expect(sobrepoe, `controles ${i} e ${j} se sobrepõem`).toBe(false)
      }
    }
  })

  test('E2E-REL03 — seção Créditos pode ser recolhida', async ({ page }) => {
    await page.getByRole('button', { name: /gerar relatório/i }).click()

    // O card de filtros é "sticky top-0 z-20" e cobre parte da tabela ao rolar.
    // Recolhê-lo evita que ele intercepte o clique nas linhas Créditos/Débitos
    // (a página já tem um observer que faz isso sozinho ao rolar de verdade,
    // mas depender de scroll+IntersectionObserver no teste é a fonte da flakiness
    // original — recolher explicitamente é determinístico).
    await page.getByRole('button', { name: /recolher filtros/i }).click()

    // Nível 2 (Categorias) garante que o cabeçalho com chevron expandido seja renderizado.
    // Escopado ao bloco "Detalhamento" — o filtro de categorias (FiltrosLancamentos) também
    // tem um botão chamado "Categorias" (placeholder do MultiSelect), e getByRole sem escopo
    // pode resolver para o elemento errado se o bloco de Detalhamento ainda não renderizou.
    await page.locator('[data-tutorial="relatorios-detalhamento"]')
      .getByRole('button', { name: /^categorias$/i }).click()

    // O cabeçalho da seção Créditos é a 1ª ocorrência do texto (a 2ª é o totalizador).
    const headerCred = page.getByText('Créditos', { exact: true }).first()
    await expect(headerCred).toBeVisible({ timeout: 15_000 })

    // Lucide React renderiza os ícones com classe "lucide lucide-<nome>".
    // Quando expandida a seção mostra chevron-down; ao recolher passa a chevron-right.
    const chevronDown = headerCred.locator('..').locator('svg.lucide-chevron-down').first()
    const chevronRight = headerCred.locator('..').locator('svg.lucide-chevron-right').first()
    await expect(chevronDown).toBeVisible({ timeout: 5_000 })

    await headerCred.click()
    await expect(chevronRight).toBeVisible({ timeout: 5_000 })
  })

  test('E2E-REL04 — seção Débitos pode ser recolhida', async ({ page }) => {
    await page.getByRole('button', { name: /gerar relatório/i }).click()
    // Ver comentário em E2E-REL03 sobre por que recolhe os filtros antes.
    await page.getByRole('button', { name: /recolher filtros/i }).click()
    // Ver comentário em E2E-REL03 sobre por que o botão precisa ser escopado.
    await page.locator('[data-tutorial="relatorios-detalhamento"]')
      .getByRole('button', { name: /^categorias$/i }).click()

    const headerDeb = page.getByText('Débitos', { exact: true }).first()
    await expect(headerDeb).toBeVisible({ timeout: 15_000 })

    const chevronDown = headerDeb.locator('..').locator('svg.lucide-chevron-down').first()
    const chevronRight = headerDeb.locator('..').locator('svg.lucide-chevron-right').first()
    await expect(chevronDown).toBeVisible({ timeout: 5_000 })

    await headerDeb.click()
    await expect(chevronRight).toBeVisible({ timeout: 5_000 })
  })

  test('E2E-REL05 — botão Exportar aparece após gerar relatório', async ({ page }) => {
    // Antes de gerar — não deve aparecer
    await expect(page.getByRole('button', { name: /exportar/i })).not.toBeVisible()

    await page.getByRole('button', { name: /gerar relatório/i }).click()
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible()

    // Após gerar — deve aparecer
    await expect(page.getByRole('button', { name: /exportar/i })).toBeVisible()
  })

  test('E2E-REL07 — ocultar/mostrar valores no relatório', async ({ page }) => {
    // Usa .first() pra evitar strict-mode caso outro botão com texto similar
    // apareça na página (ex.: tooltip de outro componente).
    const btnOcultar = page.getByRole('button', { name: /ocultar/i }).first()
    await expect(btnOcultar).toBeVisible({ timeout: 8_000 })
    await btnOcultar.click()
    const btnMostrar = page.getByRole('button', { name: /mostrar/i }).first()
    await expect(btnMostrar).toBeVisible({ timeout: 6_000 })
    // Restaura
    await btnMostrar.click()
    await expect(page.getByRole('button', { name: /ocultar/i }).first()).toBeVisible({ timeout: 6_000 })
  })

  test('E2E-REL06 — filtros persistem ao navegar entre páginas', async ({ page }) => {
    await page.getByRole('button', { name: /gerar relatório/i }).click()
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible()

    // Navegar via links da SPA (page.goto remonta o app e reseta o PageStateContext em memória)
    await page.getByRole('link', { name: /painel/i }).click()
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('link', { name: /relatórios/i }).click()
    await page.waitForLoadState('domcontentloaded')

    // Relatório deve estar gerado ainda
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible({ timeout: 10_000 })
  })
})
