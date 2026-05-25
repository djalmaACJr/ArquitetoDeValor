// e2e/tests/data.setup.ts
// Limpa dados E2E e cria dados básicos via API direta (evita flakiness do DOM)
import { test as setup } from '@playwright/test'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Tenta carregar .env do FrontEnd e da raiz do projeto
dotenv.config()
dotenv.config({ path: path.resolve(process.cwd(), '../.env') })

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

// Timeout maior (90s) para tolerar cold start das Edge Functions na 1ª chamada
setup.setTimeout(90_000)

setup('criar dados basicos', async ({ page, request }) => {
  if (!SUPABASE_URL || !ANON_KEY) {
    console.log('⚠️ SUPABASE_URL/ANON_KEY não definidos — pulando setup')
    return
  }

  // 1) Pega JWT do localStorage (já autenticado pelo auth.setup.ts)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  // Persiste o storage state atualizado em auth.json para todos os testes herdarem.
  await page.context().storageState({ path: './fixtures/auth.json' })

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

  if (!token) {
    console.log('⚠️ Token JWT não encontrado no localStorage — pulando limpeza via API')
    return
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'apikey': ANON_KEY,
    'Content-Type': 'application/json',
  }
  const api = (p: string) => `${SUPABASE_URL}/functions/v1${p}`

  // ─────────────────────────────────────────────────────────────────────
  // Marca tutoriais como "já vistos" e força mascote_preferido no banco.
  //
  // Por que no banco? `tutoriais_vistos` e `mascote_preferido` migraram do
  // localStorage para `arqvalor.usuarios`. Se não setarmos:
  //   - TutorialTour mostra overlay `bg-black/70 pointer-events-auto` que
  //     intercepta cliques nos testes (mascara como "element not stable").
  //   - Sem mascote_preferido, ApresentacaoMascotes força fluxo de 1º acesso
  //     antes de o app carregar.
  //
  // PostgREST aceita PATCH direto na tabela do schema `arqvalor` via headers
  // `Accept-Profile` / `Content-Profile`. O JWT do usuário é suficiente — RLS
  // restringe ao próprio registro.
  // ─────────────────────────────────────────────────────────────────────
  const tutoriaisVistos: Record<string, boolean> = {}
  const pageKeys = [
    'dashboard-v1', 'extrato-v1', 'contas-v1', 'categorias-v1',
    'relatorios-v1', 'comparativo-v1', 'assinaturas-v1', 'projecao-v1',
  ]
  for (const k of pageKeys) tutoriaisVistos[`tour-${k}`] = true

  // Decodifica o `sub` do JWT (id do usuário) sem libs externas.
  const userId = ((): string | null => {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf-8')
      )
      return payload.sub ?? null
    } catch { return null }
  })()

  if (userId) {
    const restHeaders = {
      ...headers,
      'Accept-Profile':  'arqvalor',
      'Content-Profile': 'arqvalor',
      'Prefer': 'return=minimal',
    }
    const patchRes = await request.patch(
      `${SUPABASE_URL}/rest/v1/usuarios?id=eq.${userId}`,
      {
        headers: restHeaders,
        data: {
          tutoriais_vistos: tutoriaisVistos,
          mascote_preferido: 'sabio',
        },
      }
    )
    console.log(patchRes.ok()
      ? '  ✅ tutoriais_vistos + mascote_preferido configurados no banco'
      : `  ⚠️ falha ao atualizar usuario: ${patchRes.status()}`
    )
  } else {
    console.log('  ⚠️ não foi possível extrair user_id do JWT')
  }

  // ── Helper: lista, filtra por nome contendo "E2E", deleta cada um ─
  async function limparE2E(
    recurso: string,
    pegarNome: (item: Record<string, unknown>) => string | undefined,
    pegarId:   (item: Record<string, unknown>) => string | undefined,
    queryDelete = '',
  ): Promise<number> {
    const res = await request.get(api(`/${recurso}`), { headers })
    if (!res.ok()) {
      console.log(`  ⚠️ falha ao listar ${recurso}: ${res.status()}`)
      return 0
    }
    const body = await res.json().catch(() => ({}))
    const lista = Array.isArray(body) ? body : (body.dados ?? [])
    const alvos = lista.filter((it: Record<string, unknown>) => (pegarNome(it) ?? '').includes('E2E'))
    let n = 0
    for (const it of alvos) {
      const id = pegarId(it)
      if (!id) continue
      const del = await request.delete(api(`/${recurso}/${id}${queryDelete}`), { headers })
      if (del.ok()) n++
    }
    return n
  }

  console.log('🧹 Limpando dados E2E via API...')

  // ORDEM: lançamentos → categorias → contas (respeita FKs)
  const nLanc = await limparE2E(
    'transacoes',
    (l) => l.descricao,
    (l) => l.id,
    '?escopo=TODOS',
  )
  console.log(`  • ${nLanc} lançamento(s) E2E removido(s)`)

  const nCat = await limparE2E(
    'categorias',
    (c) => c.descricao,
    (c) => c.id,
  )
  console.log(`  • ${nCat} categoria(s) E2E removida(s)`)

  const nCnt = await limparE2E(
    'contas',
    (c) => c.nome,
    (c) => c.conta_id ?? c.id,
  )
  console.log(`  • ${nCnt} conta(s) E2E removida(s)`)

  console.log('✅ Limpeza E2E concluída')

  // 2) Cria dados básicos via API
  console.log('🔧 Criando dados básicos...')

  const cConta = await request.post(api('/contas'), {
    headers,
    data: { nome: 'E2E Conta Corrente', tipo: 'CORRENTE', saldo_inicial: 0, cor: '#00c896', icone: '🏦' },
  })
  console.log(cConta.ok() ? '  ✅ Conta básica criada' : `  ⚠️ Conta: ${cConta.status()}`)

  const cConta2 = await request.post(api('/contas'), {
    headers,
    data: { nome: 'E2E Conta Poupança', tipo: 'CORRENTE', saldo_inicial: 0, cor: '#60a5fa', icone: '💳' },
  })
  console.log(cConta2.ok() ? '  ✅ Conta para transferências criada' : `  ⚠️ Conta 2: ${cConta2.status()}`)

  const cCat = await request.post(api('/categorias'), {
    headers,
    data: { descricao: 'E2E Salário', cor: '#00c896', icone: '💰' },
  })
  console.log(cCat.ok() ? '  ✅ Categoria básica criada' : `  ⚠️ Categoria: ${cCat.status()}`)

  console.log('🎉 Setup concluído')
})
