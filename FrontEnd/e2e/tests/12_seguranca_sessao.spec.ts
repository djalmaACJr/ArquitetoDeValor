// e2e/tests/12_seguranca_sessao.spec.ts
// Cobre o modal "Aba inativa" (useAutoLogout.ts / avisoFecharAba.ts) — feature
// nova (v6.4.0) sem nenhum teste automatizado até então. Ver seção "Sessão +
// biometria" do CLAUDE.md: no desktop a sessão fica em localStorage
// COMPARTILHADO entre abas, então um signOut() decidido por uma aba escondida
// sozinha derrubaria abas ativas em outras janelas — a garantia central desta
// suíte é que isso nunca acontece.
//
// Dashboard é a rota índice ("/"), não "/dashboard" — ver App.tsx.
//
// Não espera os 15 minutos reais do timeout: injeta
// `arqvalor:ultima-atividade` (localStorage) já expirado via
// `addInitScript` — roda ANTES de QUALQUER script da página em cada
// navegação daquele `page`/`context`, então não corre contra o próprio tick
// de 1s do hook (que re-persiste `Date.now()` a cada segundo enquanto a aba
// segue ativa — setar o valor por `evaluate()` e só DEPOIS chamar
// `page.reload()` perde essa corrida: o tick antigo ainda roda entre as duas
// chamadas e sobrescreve o valor injetado antes da navegação começar).
// O hook lê o valor expirado no mount e, já tendo passado do limite, dispara
// a checagem de expiração imediatamente — mesmo mecanismo que cobre o app
// Android sendo reaberto depois do processo morto pelo SO.
//
// IMPORTANTE — por que plantamos `arqv-lc` também: o listener de auth em
// main.tsx (`tentarHidratar`) roda em TODO carregamento e, se não achar um
// cache válido do MESMO usuário em `arqv-lc`, chama `limparEstadoCliente()`
// — que apaga `arqvalor:ultima-atividade` (entre outras chaves) por
// segurança (nunca herdar estado entre usuários). Uma sessão de teste "fria"
// (via storageState, sem esse cache ainda populado) cairia nesse caminho e o
// valor injetado seria apagado antes do useAutoLogout chegar a lê-lo.
// Contornamos plantando um `arqv-lc` válido pro usuário atual — mesma coisa
// que aconteceria organicamente numa sessão real já usada antes.
//
// Autossuficiente: não cria dados de negócio (conta/categoria/lançamento),
// então zz_teardown.spec.ts não precisa saber desta suíte.
import { test, expect, type Page } from '@playwright/test'

const LIMITE_MS = 15 * 60_000 // desktop/web — ver AppLayout.tsx (Capacitor.isNativePlatform() ? 5 : 15)

async function userIdDaSessao(page: Page): Promise<string> {
  const sub = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.includes('-auth-token')) continue
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? 'null')
        const token = v?.access_token ?? v?.currentSession?.access_token
        if (!token) continue
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
        const payload = JSON.parse(atob(b64))
        return payload.sub as string
      } catch { /* tenta a próxima chave */ }
    }
    return null
  })
  if (!sub) throw new Error('Não foi possível extrair o userId da sessão (JWT não encontrado em localStorage)')
  return sub
}

test.describe('Sessão — aba inativa multi-tab (E2E)', () => {
  test('E2E-SEC01 — timer expirado em primeiro plano mostra o modal; "Continuar aqui" mantém a sessão', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /novo lançamento/i }).first()).toBeVisible({ timeout: 8_000 })
    const uid = await userIdDaSessao(page)

    await page.addInitScript(({ uid, expirado }) => {
      localStorage.setItem('arqv-lc', JSON.stringify({ data: {}, savedAt: Date.now(), userId: uid }))
      localStorage.setItem('arqvalor:ultima-atividade', String(expirado))
    }, { uid, expirado: Date.now() - LIMITE_MS - 10_000 })
    await page.reload()

    const modal = page.getByRole('alertdialog')
    await expect(modal).toBeVisible({ timeout: 8_000 })
    await expect(modal.getByText(/aba inativa/i)).toBeVisible()
    await expect(modal.getByRole('button', { name: /fechar esta aba/i })).toBeVisible()

    await modal.getByRole('button', { name: /continuar aqui/i }).click()

    await expect(modal).not.toBeVisible({ timeout: 3_000 })
    // Sessão intacta: continua na página protegida, não foi pro /login.
    await expect(page.getByRole('button', { name: /novo lançamento/i }).first()).toBeVisible({ timeout: 8_000 })
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('E2E-SEC02 — sem resposta ao modal, a sessão é encerrada e redireciona pro login', async ({ page }) => {
    test.setTimeout(50_000)
    await page.goto('/')
    await expect(page.getByRole('button', { name: /novo lançamento/i }).first()).toBeVisible({ timeout: 8_000 })
    const uid = await userIdDaSessao(page)

    await page.addInitScript(({ uid, expirado }) => {
      localStorage.setItem('arqv-lc', JSON.stringify({ data: {}, savedAt: Date.now(), userId: uid }))
      localStorage.setItem('arqvalor:ultima-atividade', String(expirado))
    }, { uid, expirado: Date.now() - LIMITE_MS - 10_000 })
    await page.reload()

    const modal = page.getByRole('alertdialog')
    await expect(modal).toBeVisible({ timeout: 8_000 })

    // JANELA_DECISAO_FECHAR_S = 20s sem clicar em nada → signOut global +
    // redirect com o banner de expiração.
    await expect(page).toHaveURL(/\/login\?expirado=1/, { timeout: 30_000 })
  })

  test('E2E-SEC03 — aba secundária inativa e escondida nunca desloga sozinha (não derruba a aba ativa)', async ({ page, context }) => {
    // Aba principal: sessão fresca (sem timestamp expirado), fica em
    // primeiro plano — é o que garante que ela NUNCA deveria ser afetada
    // pelo que acontece na aba secundária. Também planta o `arqv-lc` válido
    // (ver comentário no topo) — a aba secundária herda essa mesma chave via
    // localStorage compartilhado, então também não sofre o wipe.
    await page.goto('/')
    await expect(page.getByRole('button', { name: /novo lançamento/i }).first()).toBeVisible({ timeout: 8_000 })
    const uid = await userIdDaSessao(page)
    await page.evaluate((u) => {
      localStorage.setItem('arqv-lc', JSON.stringify({ data: {}, savedAt: Date.now(), userId: u }))
    }, uid)

    // Todo carregamento NOVO deste contexto (a aba secundária, e o reload
    // dela mais abaixo) nasce com a atividade já expirada — via
    // addInitScript, não via evaluate()+reload solto (ver comentário do
    // topo sobre a corrida com o tick de 1s).
    await context.addInitScript((expirado) => {
      localStorage.setItem('arqvalor:ultima-atividade', String(expirado))
    }, Date.now() - LIMITE_MS - 10_000)

    // Abre a 2ª aba via window.open() de dentro da 1ª — precisa ter
    // window.opener setado (mesmo caso real citado em useAutoLogout.ts: um
    // link "abrir em nova aba" dentro do próprio sistema, ex.: gráfico de
    // Proventos em DividendosPage.tsx).
    const popupPromise = context.waitForEvent('page')
    await page.evaluate(() => { window.open('/', '_blank') })
    const secundaria = await popupPromise
    await secundaria.waitForLoadState('domcontentloaded')
    expect(await secundaria.evaluate(() => !!window.opener)).toBe(true)

    // Garante o foco de volta na principal — a secundária vira "hidden"
    // (document.visibilityState), que é o cenário que o hook nunca pode
    // resolver com um signOut global sozinho. Recarrega a secundária JÁ
    // escondida — o addInitScript do contexto reaplica a atividade expirada
    // nesta navegação, e o mount-check roda com visibilityState='hidden'.
    await page.bringToFront()
    await secundaria.reload()

    // A secundária tenta se fechar sozinha (silenciosamente, sem modal) —
    // nunca desloga ninguém. Timeout generoso: a lógica real tenta por até
    // ~5s (ver tentandoFecharDesdeRef em useAutoLogout.ts).
    await secundaria.waitForEvent('close', { timeout: 10_000 }).catch(() => {
      // Alguns navegadores/automação podem recusar window.close() mesmo com
      // opener — não é o que este teste verifica. O que importa de verdade
      // é a asserção abaixo: a aba principal nunca é afetada.
    })

    // A aba principal nunca viu um modal, nunca foi deslogada — continua
    // exatamente onde estava.
    await expect(page.getByRole('alertdialog')).not.toBeVisible()
    await expect(page.getByRole('button', { name: /novo lançamento/i }).first()).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })
})
