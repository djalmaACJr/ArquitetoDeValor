// e2e/tests/13_seletor_espaco.spec.ts
//
// Testes dedicados ao SELETOR DE ESPAÇO (trocar entre "Meus dados" e "Conta
// de X") — a parte do fluxo de agregados que 12_agregados.spec.ts deixa de
// fora de propósito, por exigir um 2º usuário real logado numa sessão
// separada pra ver a troca de espaço acontecer de verdade (ver comentário no
// topo daquele arquivo).
//
// Aqui montamos esse 2º usuário ("agregado") via API direta — mesma
// estratégia do "User B" dinâmico de tests/setup.ts (Jest): signUp +
// confirmação via Admin API quando o projeto exige — e o autenticamos de
// verdade numa 2ª BrowserContext, pra exercitar o seletor como ele realmente
// aparece na UI: Sidebar → SeletorEspaco.tsx.
//
// Sem SUPABASE_SERVICE_ROLE_KEY no .env (necessário pra confirmar o e-mail
// do agregado dinâmico e depois excluí-lo), o describe inteiro avisa e pula
// graciosamente — mesmo critério de tryGetTokenB() no lado Jest.
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { expandirFiltros } from './helpers'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config()
dotenv.config({ path: path.resolve(process.cwd(), '../.env') })

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const ANON_KEY         = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const api  = (p: string) => `${SUPABASE_URL}/functions/v1${p}`
const rest = (p: string) => `${SUPABASE_URL}/rest/v1${p}`

function decodeJwtSub(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'))
    return payload.sub ?? null
  } catch { return null }
}

// No projeto `mobile` (viewport Pixel 7, ver playwright.config.ts) a Sidebar
// fica fora da tela até abrir o menu hambúrguer ("Abrir menu", AppLayout.tsx)
// — sem isso, qualquer interação com o seletor de espaço ou os links de nav
// trava esperando um elemento invisível. No desktop (projeto `firefox`) o
// botão não existe/não fica visível, então isto é um no-op seguro — chamar
// antes de toda interação com a Sidebar, nos dois projetos.
async function abrirSidebarSeNecessario(page: import('@playwright/test').Page) {
  const btn = page.getByRole('button', { name: /abrir menu/i })
  if (await btn.isVisible().catch(() => false)) await btn.click()
}

// Timeout maior (90s) — mesma razão de data.setup.ts: a 1ª visita a uma rota
// pesada (ex.: /lancamentos) num dev server frio pode levar bem mais que o
// padrão de 30s pra compilar sob demanda, antes mesmo de qualquer asserção.
test.setTimeout(90_000)

test.describe('Seletor de espaço (Agregados)', () => {
  let PRONTO = false
  let headersA: Record<string, string> = {}
  let contaAId = ''
  let contaNomeA = ''
  let nomeA = ''
  let userIdA = ''
  let vinculoId = ''
  let emailB = ''
  let passwordB = ''
  let userIdB = ''

  test.beforeAll(async ({ browser }) => {
    if (!SUPABASE_URL || !ANON_KEY) {
      console.warn('⚠️ [13_seletor_espaco] VITE_SUPABASE_URL/ANON_KEY não configurados — setup pulado.')
      return
    }

    // 1) Token de A a partir da sessão já salva pelo auth.setup.ts (mesmo
    // truque de extração usado em data.setup.ts).
    const ctxA = await browser.newContext({ storageState: './fixtures/auth.json' })
    const pageA = await ctxA.newPage()
    await pageA.goto('/')
    await pageA.waitForLoadState('domcontentloaded')
    const tokenA: string | null = await pageA.evaluate(() => {
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
    await ctxA.close()
    if (!tokenA) {
      console.warn('⚠️ [13_seletor_espaco] token de A indisponível — setup pulado.')
      return
    }
    headersA = { Authorization: `Bearer ${tokenA}`, apikey: ANON_KEY, 'Content-Type': 'application/json' }

    userIdA = decodeJwtSub(tokenA) ?? ''
    if (userIdA) {
      const nomeRes = await fetch(rest(`/usuarios?id=eq.${userIdA}&select=nome`), {
        headers: { ...headersA, 'Accept-Profile': 'arqvalor' },
      })
      const nomeJson = await nomeRes.json().catch(() => [])
      nomeA = nomeJson?.[0]?.nome ?? ''
    }

    // 2) Conta de teste do dono (A), que será liberada ao agregado.
    contaNomeA = `E2E-Seletor-${Date.now()}`
    const contaRes = await fetch(api('/contas'), {
      method: 'POST', headers: headersA,
      body: JSON.stringify({ nome: contaNomeA, tipo: 'CORRENTE', saldo_inicial: 777, icone: '🏦', cor: '#00c896' }),
    })
    const contaJson = await contaRes.json().catch(() => ({}))
    contaAId = contaJson?.id ?? contaJson?.conta_id ?? ''
    if (!contaAId) {
      console.warn('⚠️ [13_seletor_espaco] falha ao criar conta de teste do dono — setup pulado.')
      return
    }

    // 3) Convite A → e-mail descartável.
    emailB = `e2e-seletor-${Date.now()}@example.com`
    const convRes = await fetch(api('/agregados'), {
      method: 'POST', headers: headersA, body: JSON.stringify({ email: emailB }),
    })
    const convJson = await convRes.json().catch(() => ({}))
    vinculoId = convJson?.dados?.id ?? ''
    if (!vinculoId) {
      console.warn('⚠️ [13_seletor_espaco] falha ao criar convite — setup pulado.')
      return
    }

    // 4) Token do convite — a API pública nunca devolve essa coluna (por
    // design, ver CA-AGR14), então lê direto via PostgREST: A é dono do
    // vínculo, RLS libera a própria linha (inclusive a coluna token).
    const tokenConviteRes = await fetch(rest(`/agregados?id=eq.${vinculoId}&select=token`), {
      headers: { ...headersA, 'Accept-Profile': 'arqvalor' },
    })
    const tokenConviteJson = await tokenConviteRes.json().catch(() => [])
    const tokenConvite = tokenConviteJson?.[0]?.token
    if (!tokenConvite) {
      console.warn('⚠️ [13_seletor_espaco] falha ao ler o token do convite — setup pulado.')
      return
    }

    // 5) Cria o 2º usuário (agregado) de forma descartável — mesma
    // estratégia de tests/setup.ts::getTokenB(): signUp e, se o projeto
    // exigir confirmação por e-mail, confirma via Admin API.
    passwordB = 'E2eSeletor!' + Math.random().toString(36).slice(2, 10)
    const anon = createClient(SUPABASE_URL, ANON_KEY)
    const { data: signUpData, error: signUpErr } = await anon.auth.signUp({ email: emailB, password: passwordB })
    if (signUpErr || !signUpData.user) {
      console.warn(`⚠️ [13_seletor_espaco] signUp do agregado de teste falhou (${signUpErr?.message}) — setup pulado.`)
      return
    }
    userIdB = signUpData.user.id
    if (!signUpData.session) {
      if (!SERVICE_ROLE_KEY) {
        console.warn('⚠️ [13_seletor_espaco] projeto exige confirmação de e-mail e SUPABASE_SERVICE_ROLE_KEY não está configurado — setup pulado.')
        return
      }
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
      const { error: confirmErr } = await admin.auth.admin.updateUserById(userIdB, { email_confirm: true })
      if (confirmErr) {
        console.warn(`⚠️ [13_seletor_espaco] falha ao confirmar e-mail do agregado de teste (${confirmErr.message}) — setup pulado.`)
        return
      }
    }
    const { data: loginB, error: loginErr } = await anon.auth.signInWithPassword({ email: emailB, password: passwordB })
    if (loginErr || !loginB.session) {
      console.warn(`⚠️ [13_seletor_espaco] login do agregado de teste falhou (${loginErr?.message}) — setup pulado.`)
      return
    }
    const headersB = {
      Authorization: `Bearer ${loginB.session.access_token}`, apikey: ANON_KEY, 'Content-Type': 'application/json',
    }

    // 6) B aceita o convite via RPC direta (equivalente ao clique no link do
    // e-mail — a UI real usa POST /agregados/:id/aceitar, testado em
    // 12_agregados.spec.ts; aqui só precisamos do vínculo ACEITO).
    await fetch(rest('/rpc/fn_aceitar_convite_agregado'), {
      method: 'POST', headers: { ...headersB, 'Content-Profile': 'arqvalor' },
      body: JSON.stringify({ p_token: tokenConvite }),
    })

    // 7) A libera a conta de teste e o módulo Extrato (só leitura) pro agregado.
    const rContas = await fetch(api(`/agregados/${vinculoId}/contas`), {
      method: 'PUT', headers: headersA, body: JSON.stringify({ conta_ids: [contaAId] }),
    })
    const rPerm = await fetch(api(`/agregados/${vinculoId}/permissoes`), {
      method: 'PUT', headers: headersA,
      body: JSON.stringify({ modulo: 'EXTRATO', liberado: true, pode_escrever: false }),
    })
    if (!rContas.ok || !rPerm.ok) {
      console.warn('⚠️ [13_seletor_espaco] falha ao liberar conta/módulo pro agregado de teste — setup pulado.')
      return
    }

    // 8) Marca onboarding e tutoriais de B como concluídos — sem isso,
    // ApresentacaoMascotes (1º acesso) bloqueia o app inteiro, e o
    // TutorialTour de cada página mostra um overlay
    // `bg-black/70 pointer-events-auto` que intercepta cliques (mesmo achado
    // documentado em data.setup.ts).
    const pageKeys = [
      'dashboard-v1', 'extrato-v1', 'contas-v1', 'categorias-v1',
      'relatorios-v1', 'comparativo-v1', 'assinaturas-v1', 'projecao-v1',
      'objetivos-v1', 'investimentos-v1', 'investimentos-ativos-v1',
      'investimentos-detalhe-v1', 'investimentos-proventos-v1',
      'investimentos-avaliacoes-v1', 'investimentos-config-v1',
    ]
    const tutoriaisVistos: Record<string, boolean> = {}
    for (const k of pageKeys) tutoriaisVistos[`tour-${k}`] = true
    await fetch(rest(`/usuarios?id=eq.${userIdB}`), {
      method: 'PATCH',
      headers: { ...headersB, 'Accept-Profile': 'arqvalor', 'Content-Profile': 'arqvalor', Prefer: 'return=minimal' },
      body: JSON.stringify({ mascote_preferido: 'raposa', layout: 'escuro', tutoriais_vistos: tutoriaisVistos }),
    })

    PRONTO = true
  })

  test.afterAll(async () => {
    // Best-effort — nunca falha o teardown, só avisa (mesmo critério do
    // afterAll de 13_agregados.test.ts no lado Jest).
    if (contaAId) {
      await fetch(api(`/contas/${contaAId}`), { method: 'DELETE', headers: headersA }).catch(() => {})
    }
    if (userIdB && SERVICE_ROLE_KEY) {
      // fn_excluir_dados_usuario já apaga a linha de `agregados` (dono_id OU
      // agregado_id = p_user_id) — não precisa revogar o vínculo à parte.
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { db: { schema: 'arqvalor' } })
      const { error: errDados } = await admin.rpc('fn_excluir_dados_usuario', { p_user_id: userIdB })
      if (errDados) {
        console.warn(`⚠️ [13_seletor_espaco] falha ao limpar dados do agregado de teste (${errDados.message}).`)
      } else {
        const { error } = await admin.auth.admin.deleteUser(userIdB)
        if (error) console.warn(`⚠️ [13_seletor_espaco] falha ao excluir agregado de teste (${error.message}).`)
      }
    } else if (userIdB) {
      console.warn(`⚠️ [13_seletor_espaco] agregado de teste (${emailB}) não foi excluído — SUPABASE_SERVICE_ROLE_KEY ausente.`)
    }
  })

  // ── E2E-SEL01 ─────────────────────────────────────────────────
  test('E2E-SEL01 — agregado logado vê o seletor com "Meus dados" e "Conta de <dono>"', async ({ browser }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL01 pulado.'); return }

    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await pageB.goto('/login')
    await pageB.getByPlaceholder(/seu@email.com/i).fill(emailB)
    await pageB.locator('input[type="password"]').fill(passwordB)
    await pageB.getByRole('button', { name: 'Entrar' }).click()
    await expect(pageB).toHaveURL(/\/$/, { timeout: 15_000 })

    // Default: nenhum vínculo escolhido ainda → mostra "Meus dados".
    await abrirSidebarSeNecessario(pageB)
    const seletor = pageB.getByRole('button', { name: /meus dados/i })
    await expect(seletor).toBeVisible({ timeout: 10_000 })

    // Abre o dropdown e confirma que "Conta de <A>" aparece como opção.
    await seletor.click()
    await expect(pageB.getByText(/^conta de /i)).toBeVisible()
    if (nomeA) {
      await expect(pageB.getByText(new RegExp(`conta de ${nomeA}`, 'i'))).toBeVisible()
    }

    await ctxB.close()
  })

  // ── E2E-SEL02 ─────────────────────────────────────────────────
  test('E2E-SEL02 — trocar para "Conta de <dono>" mostra a conta liberada no Extrato', async ({ browser }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL02 pulado.'); return }

    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await pageB.goto('/login')
    await pageB.getByPlaceholder(/seu@email.com/i).fill(emailB)
    await pageB.locator('input[type="password"]').fill(passwordB)
    await pageB.getByRole('button', { name: 'Entrar' }).click()
    await expect(pageB).toHaveURL(/\/$/, { timeout: 15_000 })

    // Antes de trocar: o Extrato de B não mostra a conta de A. Navegação via
    // Sidebar (SPA) em todo o teste, não page.goto() — um reload de página
    // inteira reinicializaria o app do zero, e um usuário real navega pelo
    // menu, não dá F5 a cada troca de espaço.
    await abrirSidebarSeNecessario(pageB)
    await pageB.getByRole('link', { name: /^extratos$/i }).click()
    await pageB.waitForLoadState('networkidle')
    await expandirFiltros(pageB)
    await pageB.getByRole('button', { name: /todas as contas/i }).click()
    await expect(pageB.getByText(contaNomeA)).not.toBeVisible()
    // Fecha o dropdown (fecha só no mousedown fora dele, não no Escape) antes
    // de interagir com o seletor de espaço na Sidebar.
    await pageB.locator('h1').first().click()

    // Troca pra "Conta de <A>".
    await abrirSidebarSeNecessario(pageB)
    await pageB.getByRole('button', { name: /meus dados/i }).click()
    await pageB.getByText(/^conta de /i).click()
    await expect(pageB).toHaveURL(/\/$/, { timeout: 10_000 })
    await expect(pageB.getByRole('button', { name: /^conta de /i })).toBeVisible()

    // Agora o filtro de contas do Extrato mostra a conta liberada pelo dono.
    await abrirSidebarSeNecessario(pageB)
    await pageB.getByRole('link', { name: /^extratos$/i }).click()
    await pageB.waitForLoadState('networkidle')
    // Pequena folga pra deixar o remount assentar — achado real: navegar
    // Extrato → "/" (troca de espaço) → Extrato de novo, tão rápido quanto
    // um teste consegue clicar, ocasionalmente pega o React no meio da
    // troca de instância da página (lazy + Suspense), com DOIS botões
    // "Filtros" (o antigo ainda desmontando + o novo) coexistindo por um
    // instante — mesma classe de flake documentada em abrirEdicaoLancamento
    // (helpers.ts).
    await pageB.waitForTimeout(300)
    await expandirFiltros(pageB)
    await pageB.getByRole('button', { name: /todas as contas/i }).click()
    await expect(pageB.getByText(contaNomeA)).toBeVisible({ timeout: 10_000 })

    await ctxB.close()
  })

  // ── E2E-SEL03 ─────────────────────────────────────────────────
  test('E2E-SEL03 — no espaço do dono, /contas mostra aviso de indisponibilidade (gestão é sempre pessoal)', async ({ browser }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL03 pulado.'); return }

    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await pageB.goto('/login')
    await pageB.getByPlaceholder(/seu@email.com/i).fill(emailB)
    await pageB.locator('input[type="password"]').fill(passwordB)
    await pageB.getByRole('button', { name: 'Entrar' }).click()
    await expect(pageB).toHaveURL(/\/$/, { timeout: 15_000 })

    await pageB.getByRole('button', { name: /meus dados/i }).click()
    await pageB.getByText(/^conta de /i).click()
    await expect(pageB).toHaveURL(/\/$/, { timeout: 10_000 })

    await pageB.getByRole('link', { name: /^contas$/i }).click()
    await expect(pageB.getByText(/não disponível neste espaço/i)).toBeVisible({ timeout: 10_000 })
    await expect(pageB.getByRole('button', { name: /nova conta/i })).not.toBeVisible()

    await ctxB.close()
  })

  // ── E2E-SEL04 ─────────────────────────────────────────────────
  test('E2E-SEL04 — voltar para "Meus dados" restaura a visão isolada do próprio agregado', async ({ browser }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL04 pulado.'); return }

    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await pageB.goto('/login')
    await pageB.getByPlaceholder(/seu@email.com/i).fill(emailB)
    await pageB.locator('input[type="password"]').fill(passwordB)
    await pageB.getByRole('button', { name: 'Entrar' }).click()
    await expect(pageB).toHaveURL(/\/$/, { timeout: 15_000 })

    // Troca pra "Conta de <A>" e depois volta.
    await pageB.getByRole('button', { name: /meus dados/i }).click()
    await pageB.getByText(/^conta de /i).click()
    await expect(pageB.getByRole('button', { name: /^conta de /i })).toBeVisible({ timeout: 10_000 })

    await pageB.getByRole('button', { name: /^conta de /i }).click()
    await pageB.getByText(/^meus dados$/i).click()
    await expect(pageB).toHaveURL(/\/$/, { timeout: 10_000 })
    await expect(pageB.getByRole('button', { name: /meus dados/i })).toBeVisible()

    // /contas volta ao normal (gestão pessoal de B, sem aviso de indisponibilidade).
    await pageB.getByRole('link', { name: /^contas$/i }).click()
    await expect(pageB.getByText(/não disponível neste espaço/i)).not.toBeVisible()
    await expect(pageB.getByRole('button', { name: /nova conta/i })).toBeVisible({ timeout: 10_000 })

    // O Extrato de B não mostra mais a conta do dono.
    await pageB.getByRole('link', { name: /^extratos$/i }).click()
    await pageB.waitForLoadState('networkidle')
    await expandirFiltros(pageB)
    await pageB.getByRole('button', { name: /todas as contas/i }).click()
    await expect(pageB.getByText(contaNomeA)).not.toBeVisible()

    await ctxB.close()
  })

  // ── helpers dos testes SEL05+ ─────────────────────────────────
  async function entrarComoB(browser: import('@playwright/test').Browser) {
    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await pageB.goto('/login')
    await pageB.getByPlaceholder(/seu@email.com/i).fill(emailB)
    await pageB.locator('input[type="password"]').fill(passwordB)
    await pageB.getByRole('button', { name: 'Entrar' }).click()
    await expect(pageB).toHaveURL(/[/]$/, { timeout: 15_000 })
    return { ctxB, pageB }
  }
  async function irParaContaDoDono(pageB: import('@playwright/test').Page) {
    await abrirSidebarSeNecessario(pageB)
    await pageB.getByRole('button', { name: /meus dados/i }).click()
    await pageB.getByText(/^conta de /i).click()
    await expect(pageB.getByRole('button', { name: /^conta de /i })).toBeVisible({ timeout: 10_000 })
  }

  // ── E2E-SEL05 ─────────────────────────────────────────────────
  // O dono liberou só EXTRATO: Objetivos/Investimentos somem do menu do
  // agregado em "Conta de <dono>" (e continuam em "Meus dados").
  test('E2E-SEL05 — menu oculta módulos não liberados no espaço do dono', async ({ browser }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL05 pulado.'); return }
    const { ctxB, pageB } = await entrarComoB(browser)

    await abrirSidebarSeNecessario(pageB)
    await expect(pageB.getByRole('link', { name: /^objetivos$/i })).toBeVisible({ timeout: 10_000 })
    await expect(pageB.getByRole('link', { name: /^investimentos$/i })).toBeVisible()

    await irParaContaDoDono(pageB)
    await abrirSidebarSeNecessario(pageB)
    await expect(pageB.getByRole('link', { name: /^extratos$/i })).toBeVisible()
    await expect(pageB.getByRole('link', { name: /^objetivos$/i })).toHaveCount(0)
    await expect(pageB.getByRole('link', { name: /^investimentos$/i })).toHaveCount(0)

    await ctxB.close()
  })

  // ── E2E-SEL06 ─────────────────────────────────────────────────
  test('E2E-SEL06 — faixa avisa que há contas não compartilhadas (só no espaço do dono)', async ({ browser }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL06 pulado.'); return }
    const { ctxB, pageB } = await entrarComoB(browser)

    await expect(pageB.getByText(/não foram compartilhadas/i)).toHaveCount(0)
    await irParaContaDoDono(pageB)
    await expect(pageB.getByText(/não foram compartilhadas/i)).toBeVisible({ timeout: 10_000 })

    await ctxB.close()
  })

  // ── E2E-SEL07 ─────────────────────────────────────────────────
  test('E2E-SEL07 — abrir direto a URL de um módulo não liberado mostra "Acesso não liberado"', async ({ browser }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL07 pulado.'); return }
    const { ctxB, pageB } = await entrarComoB(browser)
    await irParaContaDoDono(pageB)

    // Recarga completa: o espaço ativo persiste (localStorage) e o guarda age.
    await pageB.goto('/objetivos')
    await expect(pageB.getByRole('heading', { name: /acesso não liberado/i })).toBeVisible({ timeout: 15_000 })

    await ctxB.close()
  })

  // ── E2E-SEL08 ─────────────────────────────────────────────────
  // Revogação com o agregado dentro do espaço do dono: ele volta sozinho pra
  // "Meus dados" (antes ficava preso numa conta zerada, sem o seletor).
  test('E2E-SEL08 — dono revoga com o agregado no espaço dele: volta sozinho para "Meus dados"', async ({ browser }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL08 pulado.'); return }
    const { ctxB, pageB } = await entrarComoB(browser)
    await irParaContaDoDono(pageB)

    const r = await fetch(api('/agregados/' + vinculoId + '/revogar'), { method: 'POST', headers: headersA })
    expect(r.ok).toBe(true)

    await pageB.reload()
    await expect(pageB.getByRole('button', { name: /^conta de /i })).toHaveCount(0, { timeout: 15_000 })
    await abrirSidebarSeNecessario(pageB)
    await expect(pageB.getByRole('link', { name: /^objetivos$/i })).toBeVisible({ timeout: 10_000 })
    await expect(pageB.getByText(/revogou seu acesso/i)).toBeVisible({ timeout: 10_000 })

    await ctxB.close()
  })

  // ── E2E-SEL09 ─────────────────────────────────────────────────
  // Convite novo pra quem JÁ tem conta: aparece no login do convidado com
  // Aceitar/Recusar; ao aceitar, o dono vê o aviso "Convite aceito".
  test('E2E-SEL09 — convite pendente aparece no login do convidado e o dono é avisado do aceite', async ({ browser, page }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL09 pulado.'); return }

    const rConvite = await fetch(api('/agregados'), {
      method: 'POST', headers: headersA, body: JSON.stringify({ email: emailB }),
    })
    expect(rConvite.status).toBe(201)

    const { ctxB, pageB } = await entrarComoB(browser)
    await expect(pageB.getByText(/convite para ser agregado/i)).toBeVisible({ timeout: 15_000 })
    await pageB.getByRole('button', { name: /^aceitar$/i }).first().click()
    await expect(pageB.getByText(/convite para ser agregado/i)).toHaveCount(0, { timeout: 10_000 })
    await abrirSidebarSeNecessario(pageB)
    await expect(pageB.getByRole('button', { name: /meus dados/i })).toBeVisible({ timeout: 10_000 })
    await ctxB.close()

    // Dono (sessão padrão do Playwright = conta A): aviso de aceite com o e-mail do agregado.
    await page.goto('/')
    await expect(page.getByText('Convite aceito')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(emailB).first()).toBeVisible()
    await page.getByRole('button', { name: /^entendi$/i }).first().click()
    await expect(page.getByText('Convite aceito')).toHaveCount(0)
  })

  // ── E2E-SEL10 ─────────────────────────────────────────────────
  // O agregado deixa de acessar por conta própria (SEL09 deixou o vínculo
  // ACEITO): sai do espaço, o dono é avisado e pode convidar de novo.
  test('E2E-SEL10 — agregado deixa de acessar por conta própria; dono é avisado e pode convidar de novo', async ({ browser, page }) => {
    if (!PRONTO) { console.warn('[13_seletor_espaco] setup indisponível — E2E-SEL10 pulado.'); return }
    const { ctxB, pageB } = await entrarComoB(browser)
    // Dispensa o aviso de revogação do SEL08 (revogação REAL do dono, ainda não vista por B):
    // o que este teste checa é que a SAÍDA voluntária não gera um aviso novo.
    const avisoAntigo = pageB.getByText(/revogou seu acesso/i)
    await expect(avisoAntigo).toBeVisible({ timeout: 15_000 })   // SEL08 deixou uma revogação real não vista
    {
      // "Entendi" DO CARD de revogação (há outros avisos empilhados com o mesmo botão)
      // Espera o PATCH que grava "visto até" terminar — o goto abaixo recarregaria a página no meio dele.
      const gravou = pageB.waitForResponse(r => r.request().method() === 'PATCH' && (r.request().postData() ?? '').includes('agregados_avisos_vistos_em'))
      await avisoAntigo.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').getByRole('button', { name: /^entendi$/i }).click()
      await gravou
      await expect(avisoAntigo).toHaveCount(0)
    }
    await irParaContaDoDono(pageB)

    pageB.once('dialog', d => d.accept())
    await pageB.goto('/compartilhamento')
    await pageB.getByRole('button', { name: /deixar de acessar/i }).click()

    // Saiu do espaço: volta pra "Meus dados" e sem nenhum aviso de "acesso revogado".
    await expect(pageB.getByRole('button', { name: /^conta de /i })).toHaveCount(0, { timeout: 15_000 })
    await expect(pageB.getByRole('button', { name: /deixar de acessar/i })).toHaveCount(0)
    await expect(pageB.getByText(/revogou seu acesso/i)).toHaveCount(0)
    await ctxB.close()

    // Dono: aviso "Agregado saiu" e o vínculo aparece como "Saiu" em Compartilhamento.
    await page.goto('/')
    await expect(page.getByText('Agregado saiu')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /^entendi$/i }).first().click()
    await page.goto('/compartilhamento')
    await page.getByRole('button', { name: /^revogados/i }).click()
    await expect(page.getByText('Saiu', { exact: true }).first()).toBeVisible()

    // Pode convidar o mesmo usuário de novo.
    await page.getByPlaceholder('email@exemplo.com').fill(emailB)
    await page.getByRole('button', { name: /^convidar$/i }).click()
    await expect(page.getByText(new RegExp('Convite enviado para ' + emailB, 'i'))).toBeVisible({ timeout: 10_000 })
  })
})
