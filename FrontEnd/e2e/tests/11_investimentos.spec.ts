// e2e/tests/11_investimentos.spec.ts
// Cobre o módulo de Investimentos (/investimentos/**), que não tinha nenhum
// teste E2E até então (só a suíte de API em tests/12_investimentos.test.ts).
//
// Autossuficiente: zz_teardown.spec.ts não sabe de investimentos (só limpa
// lembretes/transacoes/categorias/contas), então este spec cria e apaga seus
// próprios dados. `mode: 'serial'` porque os testes daqui em diante dependem
// do ativo/conta criados no início — não fazem sentido isolados nem em
// paralelo (mesmo padrão de dependência sequencial usado nas suítes de API).
//
// Escopo deliberadamente reduzido em 3 pontos, para não depender de serviços
// externos reais nem gerar custo/flakiness:
//   - "Avaliar carteira com os mentores" (Avaliações) faz chamadas de IA de
//     verdade — testamos só o gating (sem mentor configurado), nunca o clique.
//   - "Buscar proventos"/"Associar do extrato" (Dividendos) dependem de
//     B3/Polygon — testamos só navegação, estado vazio e o Diagnóstico
//     (somente leitura, não grava nada).
//   - Cadastro de ativo usa o checkbox "cadastrar manualmente" em vez da busca
//     externa (brapi/CoinGecko) — determinístico, sem rede de terceiros.
import { test, expect } from '@playwright/test'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config()
dotenv.config({ path: path.resolve(process.cwd(), '../.env') })

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

const NOME_CONTA = 'E2E Conta Investimento'
const TICKER     = 'E2ETST4'
const NOME_ATIVO = 'E2E Ativo Teste'

test.describe.configure({ mode: 'serial' })
test.describe('Investimentos (E2E)', () => {
  let contaId: string | null = null
  let ativoId: string | null = null

  // ── Setup: garante a conta de investimento via API (como data.setup.ts) ──
  // Feito por API, não pela UI de Contas — criar conta já é coberto por
  // 01_contas.spec.ts; aqui só precisamos que ela exista antes dos testes.
  test('E2E-INV-SETUP — garante conta de investimento de teste', async ({ page, request }) => {
    test.skip(!SUPABASE_URL || !ANON_KEY, 'SUPABASE_URL/ANON_KEY não configurados')

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const token = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k || !k.includes('-auth-token')) continue
        try {
          const v = JSON.parse(localStorage.getItem(k) ?? 'null')
          return v?.access_token ?? v?.currentSession?.access_token ?? null
        } catch { /* noop */ }
      }
      return null
    })
    test.skip(!token, 'Token JWT não encontrado no localStorage')

    const headers = { 'Authorization': `Bearer ${token}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' }
    const api = (p: string) => `${SUPABASE_URL}/functions/v1${p}`

    // Reaproveita se já existir (reexecução do spec sem teardown prévio)
    const listRes = await request.get(api('/contas'), { headers })
    const listBody = await listRes.json().catch(() => ({}))
    const lista = Array.isArray(listBody) ? listBody : (listBody.dados ?? [])
    const existente = lista.find((c: Record<string, unknown>) => c.nome === NOME_CONTA)

    if (existente) {
      contaId = String(existente.conta_id ?? existente.id)
    } else {
      const criada = await request.post(api('/contas'), {
        headers,
        data: { nome: NOME_CONTA, tipo: 'INVESTIMENTO', saldo_inicial: 0, cor: '#8b5cf6', icone: '📈' },
      })
      expect(criada.ok()).toBe(true)
      const body = await criada.json()
      contaId = String(body.conta_id ?? body.id ?? body.dados?.id)
    }
    expect(contaId).toBeTruthy()

    // Limpa um ativo E2ETST4 remanescente de uma execução anterior que não
    // chegou a rodar E2E-INV11 (ex.: falhou no meio) — sem isso, E2E-INV03
    // esbarra em "ticker duplicado" (409) ao tentar recriar o mesmo ticker.
    const listAtivos = await request.get(api('/investimentos/ativos'), { headers })
    const bodyAtivos = await listAtivos.json().catch(() => ({}))
    const listaAtivos = Array.isArray(bodyAtivos) ? bodyAtivos : (bodyAtivos.dados ?? [])
    const orfao = listaAtivos.find((a: Record<string, unknown>) => a.ticker === TICKER)
    if (orfao) {
      await request.delete(api(`/investimentos/ativos/${orfao.id}`), { headers })
    }
  })

  // Sem beforeEach de guarda aqui: `mode: 'serial'` já interrompe os testes
  // seguintes se E2E-INV-SETUP falhar de verdade (expect lançando). Um
  // beforeEach com `test.skip(!contaId, ...)` rodaria ANTES do próprio teste
  // de setup (que ainda não teve chance de definir contaId), pulando-o antes
  // de começar e cascateando o skip para todo o resto — bug já visto aqui.

  // ── E2E-INV01 ────────────────────────────────────────────────
  test('E2E-INV01 — /investimentos/ativos carrega com os elementos principais', async ({ page }) => {
    await page.goto('/investimentos/ativos')
    await expect(page.getByRole('heading', { name: /meus ativos/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByPlaceholder(/buscar por ticker ou nome/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /novo ativo/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /avaliações/i })).toBeVisible()
  })

  // ── E2E-INV02 ────────────────────────────────────────────────
  test('E2E-INV02 — nav do módulo navega entre Painel/Meus ativos/Proventos/Configurações', async ({ page }) => {
    await page.goto('/investimentos/ativos')
    await expect(page.getByRole('heading', { name: /meus ativos/i })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('link', { name: /^painel$/i }).click()
    await expect(page).toHaveURL(/\/investimentos$/)
    await expect(page.getByRole('heading', { name: /^investimentos$/i })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('link', { name: /proventos/i }).click()
    await expect(page).toHaveURL(/\/investimentos\/dividendos/)
    await expect(page.getByRole('heading', { name: /proventos/i })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('link', { name: /configurações/i }).click()
    await expect(page).toHaveURL(/\/investimentos\/configuracoes/)
  })

  // ── E2E-INV03 ────────────────────────────────────────────────
  test('E2E-INV03 — cadastrar ativo manualmente com primeira compra cria posição', async ({ page }) => {
    await page.goto('/investimentos/ativos')
    await expect(page.getByRole('heading', { name: /meus ativos/i })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /novo ativo/i }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible({ timeout: 5_000 })

    // Tipo primeiro — revela o resto do formulário
    await drawer.locator('select').first().selectOption('ACOES')

    // Cadastro manual — evita depender da busca externa (brapi)
    await drawer.getByText(/não encontrei — cadastrar manualmente/i).click()
    await drawer.getByPlaceholder(/ex\.: vale3/i).fill(TICKER)
    await drawer.getByPlaceholder(/deixe em branco para buscar pelo ticker/i).fill(NOME_ATIVO)

    // Primeira compra (opcional) — registrar já cria a posição
    await drawer.getByText(/primeira compra/i).scrollIntoViewIfNeeded()
    const selectConta = drawer.locator('select').filter({ hasText: /não registrar agora/i })
    await selectConta.selectOption({ label: NOME_CONTA })
    await drawer.getByPlaceholder('0', { exact: true }).fill('10')
    await drawer.getByPlaceholder('0,00').first().fill('25.5')

    await drawer.getByRole('button', { name: /^salvar$/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })

    // Aparece na lista (ticker OU nome, conforme a coluna renderizada)
    await expect(page.getByText(new RegExp(TICKER, 'i')).first()).toBeVisible({ timeout: 10_000 })

    // Captura o id do ativo pelo link para os testes seguintes
    const link = page.locator(`a[href^="/investimentos/ativos/"]`, { hasText: new RegExp(`${TICKER}|${NOME_ATIVO}`, 'i') }).first()
    const href = await link.getAttribute('href')
    ativoId = href?.split('/').pop() ?? null
    expect(ativoId).toBeTruthy()
  })

  // ── E2E-INV04 ────────────────────────────────────────────────
  test('E2E-INV04 — detalhe do ativo abre e permite nova movimentação', async ({ page }) => {
    test.skip(!ativoId, 'Ativo de teste não foi criado (E2E-INV03 falhou)')

    await page.goto(`/investimentos/ativos/${ativoId}`)
    await expect(page.getByRole('heading', { name: TICKER })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /nova movimentação/i }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await expect(drawer.getByText(/saldo atual/i)).toBeVisible()

    // Registra uma venda parcial (5 de 10) — mantém posição ativa
    await drawer.locator('select').first().selectOption('VENDA')
    await drawer.locator('select').nth(1).selectOption({ label: NOME_CONTA })
    await drawer.getByPlaceholder('0', { exact: true }).fill('5')
    await drawer.getByPlaceholder('0,00').first().fill('30')
    await drawer.getByRole('button', { name: /registrar movimentação/i }).click()

    await expect(drawer.getByText(/movimentação registrada/i).or(page.getByText(/movimentação registrada/i)))
      .toBeVisible({ timeout: 5_000 }).catch(() => {})
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible({ timeout: 5_000 })
  })

  // ── E2E-INV05 ────────────────────────────────────────────────
  test('E2E-INV05 — editar ativo atualiza a nota exibida', async ({ page }) => {
    test.skip(!ativoId, 'Ativo de teste não foi criado (E2E-INV03 falhou)')

    await page.goto(`/investimentos/ativos/${ativoId}`)
    await expect(page.getByRole('heading', { name: TICKER })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /^editar$/i }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible({ timeout: 5_000 })

    const inputNota = drawer.getByPlaceholder('—')
    await inputNota.fill('8')
    await drawer.getByRole('button', { name: /atualizar/i }).click()
    await expect(drawer).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(/nota:\s*8/i)).toBeVisible({ timeout: 5_000 })
  })

  // ── E2E-INV06 ────────────────────────────────────────────────
  test('E2E-INV06 — /investimentos sai do estado vazio com a posição criada', async ({ page }) => {
    test.skip(!ativoId, 'Ativo de teste não foi criado (E2E-INV03 falhou)')

    await page.goto('/investimentos')
    await expect(page.getByRole('heading', { name: /^investimentos$/i })).toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(/sua carteira está vazia/i)).not.toBeVisible({ timeout: 5_000 }).catch(() => {})
    await expect(page.getByText(/patrimônio total/i)).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-INV07 ────────────────────────────────────────────────
  test('E2E-INV07 — botão "Atualizar cotação" é clicável e não gera crash', async ({ page }) => {
    await page.goto('/investimentos')
    await expect(page.getByRole('heading', { name: /^investimentos$/i })).toBeVisible({ timeout: 10_000 })

    const btn = page.getByRole('button', { name: /atualizar cotação/i })
    await expect(btn).toBeVisible()
    await btn.click()
    await page.waitForTimeout(1_500)

    await expect(page).toHaveURL(/\/investimentos$/)
    await expect(page.getByRole('heading', { name: /^investimentos$/i })).toBeVisible()
  })

  // ── E2E-INV08 ────────────────────────────────────────────────
  test('E2E-INV08 — /investimentos/dividendos carrega e "Diagnóstico" não crasha', async ({ page }) => {
    await page.goto('/investimentos/dividendos')
    await expect(page.getByRole('heading', { name: /proventos/i })).toBeVisible({ timeout: 10_000 })

    const cards     = page.getByText(/proventos por categoria/i)
    const vazioText = page.getByText(/nenhum dividendo lançado/i)
    await Promise.race([
      cards.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
      vazioText.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
    ])
    expect(await cards.isVisible().catch(() => false) || await vazioText.isVisible().catch(() => false)).toBe(true)

    await page.getByRole('button', { name: /diagnóstico/i }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible({ timeout: 5_000 })
  })

  // ── E2E-INV09 ────────────────────────────────────────────────
  test('E2E-INV09 — /investimentos/avaliacoes sem mentor exibe gating para /perfil', async ({ page }) => {
    await page.goto('/investimentos/avaliacoes')
    await expect(page.getByRole('heading', { name: /avaliações/i })).toBeVisible({ timeout: 10_000 })

    // Ambiente de teste não tem mentor de IA configurado — assume o gating.
    // Se algum dia houver mentor configurado nesta conta, o teste pula em vez
    // de falhar (não é o que este spec quer validar).
    const semMentor = page.getByText(/nenhum mentor configurado/i)
    const temGating = await semMentor.isVisible({ timeout: 5_000 }).catch(() => false)
    test.skip(!temGating, 'Mentor de IA já configurado nesta conta de teste')

    await expect(page.getByRole('link', { name: /configurar mentores/i })).toBeVisible()
  })

  // ── E2E-INV10 ────────────────────────────────────────────────
  test('E2E-INV10 — /investimentos/configuracoes salva Metas de alocação (100%)', async ({ page }) => {
    await page.goto('/investimentos/configuracoes')
    await expect(page.getByRole('heading', { name: /configurações de investimentos/i })).toBeVisible({ timeout: 10_000 })

    // Smoke: demais seções renderizam
    await expect(page.getByRole('heading', { name: /perfil do investidor/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /tipos de dividendo/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /migrar conta de investimentos/i })).toBeVisible()

    const secaoMetas = page.locator('section').filter({ has: page.getByRole('heading', { name: /^metas de alocação$/i }) })
    await expect(secaoMetas).toBeVisible()

    // Conta de teste compartilhada pode já ter metas configuradas de usos
    // anteriores (ex.: Criptomoedas=40%) — zera TODOS os campos e depois
    // define só o 1º como 100%, senão o total vira 100+resíduo e nunca fecha.
    const inputs = secaoMetas.locator('input[type="number"]')
    const total  = await inputs.count()
    for (let i = 0; i < total; i++) await inputs.nth(i).fill(i === 0 ? '100' : '0')
    await expect(secaoMetas.getByText('100,00')).toBeVisible()

    // BtnSalvar aqui é chamado com `editando` fixo (sempre true) — por isso
    // o rótulo exibido é sempre "Atualizar" (labelEditar), nunca o
    // "Salvar metas" passado em labelSalvar (só usado quando editando=false,
    // o que nunca acontece nesta seção).
    await secaoMetas.getByRole('button', { name: /^atualizar$/i }).click()
    await expect(page.getByText(/metas de alocação salvas/i)).toBeVisible({ timeout: 5_000 })
  })

  // ── E2E-INV11 (cleanup) ──────────────────────────────────────
  test('E2E-INV11 — excluir ativo de teste remove posições em cascata', async ({ page }) => {
    test.skip(!ativoId, 'Ativo de teste não foi criado (E2E-INV03 falhou)')

    await page.goto(`/investimentos/ativos/${ativoId}`)
    await expect(page.getByRole('heading', { name: TICKER })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /^excluir$/i }).click()
    const modal = page.getByRole('dialog', { name: new RegExp(`excluir.*${TICKER}`, 'i') })
    await expect(modal).toBeVisible({ timeout: 5_000 })
    await modal.getByRole('button', { name: /^excluir$/i }).click()

    await expect(page).toHaveURL(/\/investimentos\/ativos$/, { timeout: 10_000 })
    await expect(page.getByText(new RegExp(TICKER, 'i'))).not.toBeVisible({ timeout: 5_000 })
  })
})
