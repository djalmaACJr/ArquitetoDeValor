// e2e/tests/zz_teardown.spec.ts
// Limpeza FINAL — roda depois de todos os outros testes (ordem alfabética).
//
// Por que existir: cada suite tem seu próprio "limpar de teste" (CT06, EX13,
// TRF07 etc.), mas se a suite falhou no meio o cleanup local não roda. Este
// spec é idempotente e garante que ao término do E2E nenhum dado com
// prefixo "E2E" sobra na base do usuário de teste.
//
// Não testa nada — só apaga. Sempre passa.
import { test } from '@playwright/test'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config()
dotenv.config({ path: path.resolve(process.cwd(), '../.env') })

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

test.setTimeout(60_000)

test('ZZ-TEARDOWN — apaga todos os dados E2E remanescentes', async ({ page, request }) => {
  if (!SUPABASE_URL || !ANON_KEY) {
    console.log('⚠️ SUPABASE_URL/ANON_KEY não definidos — pulando teardown')
    return
  }

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

  if (!token) {
    console.log('⚠️ Token JWT não encontrado — pulando teardown')
    return
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'apikey': ANON_KEY,
    'Content-Type': 'application/json',
  }
  const api = (p: string) => `${SUPABASE_URL}/functions/v1${p}`

  async function limparE2E(
    recurso: string,
    pegarNome: (item: Record<string, unknown>) => string | undefined,
    pegarId:   (item: Record<string, unknown>) => string | undefined,
    queryDelete = '',
  ): Promise<number> {
    const res = await request.get(api(`/${recurso}`), { headers })
    if (!res.ok()) return 0
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

  console.log('🧹 Teardown final — limpando dados E2E…')

  // ORDEM: lembretes → lançamentos → categorias → contas (respeita FKs)
  // Lembretes via filtro de mês não é necessário; o endpoint /lembretes sem
  // mes retorna tudo.
  const nLem = await limparE2E('lembretes', (l) => l.descricao as string, (l) => l.id as string)
  console.log(`  • ${nLem} lembrete(s) E2E removido(s)`)

  const nLanc = await limparE2E('transacoes',  (l) => l.descricao as string, (l) => l.id as string, '?escopo=TODOS')
  console.log(`  • ${nLanc} lançamento(s) E2E removido(s)`)

  const nCat = await limparE2E('categorias',  (c) => c.descricao as string, (c) => c.id as string)
  console.log(`  • ${nCat} categoria(s) E2E removida(s)`)

  const nCnt = await limparE2E('contas',      (c) => c.nome as string,
    (c) => (c.conta_id ?? c.id) as string)
  console.log(`  • ${nCnt} conta(s) E2E removida(s)`)

  console.log('✅ Teardown concluído')
})
