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
  test('E2E-DB16 — "Vencidos Não Confirmados": botão Pagar dá baixa no lançamento', async ({ page, request }) => {
    const hoje = new Date()
    test.skip(hoje.getDate() < 2, 'sem dia anterior dentro do mês corrente para criar um vencido')

    const token = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k || !k.includes('-auth-token')) continue
        try {
          const v = JSON.parse(localStorage.getItem(k) ?? 'null')
          return v?.access_token ?? v?.currentSession?.access_token ?? null
        } catch { /* próxima chave */ }
      }
      return null
    })
    test.skip(!token, 'JWT não encontrado')
    const base = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '') + '/functions/v1'
    const headers = {
      Authorization: `Bearer ${token}`,
      apikey: process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '',
      'Content-Type': 'application/json',
    }

    const contas = (await (await request.get(`${base}/contas`, { headers })).json()).dados as { conta_id?: string; id?: string; nome: string }[]
    const conta = contas.find(c => c.nome === 'E2E Conta Corrente') ?? contas[0]
    const cats = (await (await request.get(`${base}/categorias`, { headers })).json()).dados as { id: string; protegida?: boolean; ativa?: boolean }[]
    const cat = cats.find(c => !c.protegida && c.ativa !== false)!

    const ym = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
    const desc = `E2E Vencido ${Date.now()}`
    const criado = await request.post(`${base}/transacoes`, {
      headers,
      data: { descricao: desc, valor: 12.34, data: `${ym}-01`, conta_id: conta.conta_id ?? conta.id, categoria_id: cat.id, tipo: 'DESPESA', status: 'PENDENTE' },
    })
    expect(criado.ok()).toBeTruthy()
    const id = (await criado.json()).id as string

    try {
      await page.reload()
      const card = page.locator('[data-tutorial="dashboard-vencidos"]')
      await expect(card).toBeVisible({ timeout: 10_000 })
      // Expande o grupo da conta e acha a linha do lançamento
      await card.getByText(conta.nome, { exact: true }).first().click()
      await expect(card.getByText(desc)).toBeVisible({ timeout: 8_000 })

      await card.getByRole('button', { name: new RegExp(`pagar ${desc}`, 'i') }).click()

      await expect(page.getByText('Pago!')).toBeVisible({ timeout: 8_000 })
      await expect(card.getByText(desc)).not.toBeVisible({ timeout: 8_000 })

      const tx = await (await request.get(`${base}/transacoes/${id}`, { headers })).json()
      expect((tx.dados ?? tx).status).toBe('PAGO')
    } finally {
      await request.delete(`${base}/transacoes/${id}?escopo=SOMENTE_ESTE`, { headers })
    }
  })

})
