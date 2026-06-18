// robo-investidor10/captura.spec.ts
// ============================================================
// FASE 1 — DESCOBERTA. Não importa nada ainda.
//
// Objetivo: descobrir o formato REAL do JSON que a página de
// movimentações (entries) do investidor10 baixa nos bastidores. A tabela
// renderizada mostra só 2 casas decimais, mas a resposta JSON crua que a
// página busca via fetch/XHR normalmente traz a quantidade/preço com
// precisão cheia. Aqui interceptamos essas respostas (page.on('response'))
// em vez de ler as células da tabela — é assim que preservamos as casas.
//
// LOGIN VIA GOOGLE: o investidor10 autentica por OAuth do Google, que
// costuma bloquear navegador automatizado. Por isso usamos um PERFIL
// PERSISTENTE (launchPersistentContext): você loga com o Google MANUALMENTE
// uma vez na janela aberta e o perfil (pasta perfil/) guarda a sessão para
// as próximas execuções. Não há auto-preenchimento de senha.
//
// Depois, envie ao assistente o arquivo da captura que parecer ser a lista
// de movimentações (o manifest aponta os candidatos) para construir a
// Fase 2 (mapeamento → arquivo de importação).
// ============================================================
import { test, firefox, chromium, type BrowserContext, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const BASE = 'https://investidor10.com.br'
const ENTRIES_URL = process.env.INV10_ENTRIES_URL ?? `${BASE}/wallet/my-wallet/pro/entries`

// Modo CDP: conecta a um Chrome/Edge JÁ ABERTO com --remote-debugging-port
// (reaproveita a sessão logada desse navegador, sem login automatizado).
// Ex.: INV10_CDP_URL=http://localhost:9222
const CDP_URL = process.env.INV10_CDP_URL ?? ''

const PERFIL = path.join(__dirname, 'perfil')   // perfil persistente (cookies/sessão Google)
const OUT = path.join(__dirname, 'capturas')

// Headless só é permitido se já existir um perfil logado — o 1º login pelo
// Google PRECISA de janela (e Google bloqueia browser headless/automatizado).
const perfilExiste = fs.existsSync(PERFIL) && fs.readdirSync(PERFIL).length > 0
const HEADLESS = perfilExiste && process.env.INV10_HEADLESS === 'true'

interface Capturada {
  url: string
  metodo: string
  status: number
  tamanho: number
  body: string
}

// Resumo de uma captura para o manifest (ajuda a achar a tabela de entries).
function resumir(c: Capturada) {
  let formato = 'desconhecido'
  let qtdItens: number | null = null
  let amostraChaves: string[] = []
  try {
    const json = JSON.parse(c.body)
    // DataTables server-side: { data: [...], recordsTotal, recordsFiltered }
    const arr = Array.isArray(json) ? json
      : Array.isArray(json?.data) ? json.data
      : Array.isArray(json?.entries) ? json.entries
      : Array.isArray(json?.items) ? json.items
      : null
    if (arr) {
      formato = 'array'
      qtdItens = arr.length
      if (arr[0] && typeof arr[0] === 'object') amostraChaves = Object.keys(arr[0]).slice(0, 30)
    } else if (json && typeof json === 'object') {
      formato = 'objeto'
      amostraChaves = Object.keys(json).slice(0, 30)
    }
  } catch { /* não-JSON ou inválido */ }
  return {
    url: c.url,
    metodo: c.metodo,
    status: c.status,
    tamanho: c.tamanho,
    formato,
    qtd_itens: qtdItens,
    amostra_chaves: amostraChaves,
  }
}

// Nome de arquivo seguro a partir da URL.
function nomeArquivo(url: string, i: number): string {
  const p = new URL(url).pathname.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80)
  return `${String(i).padStart(2, '0')}_${p || 'resp'}.json`
}

test('captura entries investidor10', async () => {
  fs.mkdirSync(OUT, { recursive: true })

  // Abre o navegador. Dois modos:
  //  - CDP: conecta num Chrome/Edge já aberto e logado (INV10_CDP_URL) →
  //    reusa a sessão existente, sem login automatizado.
  //  - Padrão: perfil persistente (Firefox) com login manual via Google no 1º run.
  let context: BrowserContext
  let page: Page
  let encerrar: () => Promise<void>

  if (CDP_URL) {
    console.log(`[robo] Conectando ao navegador aberto via CDP em ${CDP_URL} ...`)
    const browser = await chromium.connectOverCDP(CDP_URL)
    context = browser.contexts()[0] ?? await browser.newContext()
    page = await context.newPage()
    // browser.close() em conexão CDP só desconecta o Playwright — NÃO fecha o seu navegador.
    encerrar = async () => { await page.close().catch(() => {}); await browser.close().catch(() => {}) }
  } else {
    context = await firefox.launchPersistentContext(PERFIL, {
      headless: HEADLESS,
      locale: 'pt-BR',
      viewport: { width: 1366, height: 900 },
    })
    page = context.pages()[0] ?? await context.newPage()
    encerrar = async () => { await context.close() }
  }

  // Coletor de TODAS as respostas JSON do domínio investidor10.
  const capturadas: Capturada[] = []
  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] ?? ''
      const url = resp.url()
      if (!ct.includes('json') || !url.includes('investidor10')) return
      const body = await resp.text()
      capturadas.push({
        url, metodo: resp.request().method(), status: resp.status(),
        tamanho: body.length, body,
      })
    } catch { /* corpo já consumido / redirecionamento — ignora */ }
  })

  // ── Abre a página de movimentações; se cair no login, faz login manual ──
  console.log(`[robo] Abrindo ${ENTRIES_URL} ...`)
  await page.goto(ENTRIES_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(2000)

  const precisaLogar = /\/login|\/auth|accounts\.google\.com/i.test(page.url())
    || (await page.getByRole('button', { name: /google|entrar|login/i }).count().catch(() => 0)) > 0

  if (precisaLogar) {
    if (!CDP_URL && HEADLESS) throw new Error('Sessão expirada e INV10_HEADLESS=true. Rode sem headless para refazer o login pelo Google.')
    if (CDP_URL) console.log('\n[robo] O navegador conectado não está logado. Faça login com o Google nele.')
    console.log('\n[robo] >>> FAÇA O LOGIN COM O GOOGLE na janela aberta (incluindo 2FA, se pedir).')
    console.log('[robo] >>> Aguardando você chegar na carteira (até 4 min)...\n')
    await page.waitForURL(/\/(wallet|carteira|dashboard)/i, { timeout: 240_000 }).catch(() => {})
    // Garante que estamos na página de entries após logar.
    if (!/entries/i.test(page.url())) {
      capturadas.length = 0
      await page.goto(ENTRIES_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
    }
  }

  // Espera o datatable disparar o fetch dos dados.
  capturadas.length = 0 // descarta ruído de login/navegação
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(4000)

  // Best-effort: se houver um seletor "itens por página" (DataTables),
  // tenta o maior valor para puxar tudo de uma vez. Falha silenciosa.
  try {
    const lengthSel = page.locator('select[name$="_length"], select.dataTable-selector, select').first()
    if (await lengthSel.count()) {
      const opcoes = await lengthSel.locator('option').allTextContents()
      const maior = opcoes.map((o) => parseInt(o, 10)).filter((n) => Number.isFinite(n)).sort((a, b) => b - a)[0]
      if (maior) { await lengthSel.selectOption({ label: String(maior) }).catch(() => {}); await page.waitForTimeout(3000) }
    }
  } catch { /* sem seletor — ok */ }

  await page.waitForTimeout(1500)

  // ── Grava capturas + manifest ───────────────────────────────────
  // Limpa capturas antigas para não confundir.
  for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { force: true })

  const manifest = capturadas.map((c, i) => {
    const nome = nomeArquivo(c.url, i)
    fs.writeFileSync(path.join(OUT, nome), c.body, 'utf8')
    return { arquivo: nome, ...resumir(c) }
  })
  // Ranqueia: prováveis tabelas de movimentações (array com mais itens) no topo.
  manifest.sort((a, b) => (b.qtd_itens ?? -1) - (a.qtd_itens ?? -1))
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`\n[robo] ${manifest.length} resposta(s) JSON capturada(s) em capturas/`)
  console.log('[robo] Candidatos a tabela de movimentações (mais itens primeiro):')
  for (const m of manifest.slice(0, 8)) {
    console.log(`  - ${m.arquivo}  [${m.formato} ${m.qtd_itens ?? '-'} itens]  ${m.metodo} ${m.url}`)
    if (m.amostra_chaves.length) console.log(`      chaves: ${m.amostra_chaves.join(', ')}`)
  }
  console.log('\n[robo] Envie ao assistente o arquivo capturas/ que tiver as movimentações (e o manifest.json).')

  await encerrar()
})
