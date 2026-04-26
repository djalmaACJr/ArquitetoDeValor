// tests/restore.ts
// Restaura os dados do usuário a partir do ultimo_backup.json
// Assume que o banco foi limpo — cria tudo diretamente em paralelo

import * as fs   from 'fs'
import * as path from 'path'
import { api }   from './setup'

const BACKUP_DIR = path.join(__dirname, 'backup_data')
const ULTIMO_BCK = path.join(BACKUP_DIR, 'ultimo_backup.json')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Executa promessas em lotes paralelos
async function emLotes<T>(items: T[], tamanho: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += tamanho) {
    await Promise.all(items.slice(i, i + tamanho).map(fn))
  }
}

function normNome(s: string): string {
  return (s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

async function restore() {
  console.log('\n================================================')
  console.log('  RESTORE — Restaurando dados após os testes')
  console.log('================================================\n')

  if (!fs.existsSync(ULTIMO_BCK)) {
    console.error('  ❌ Arquivo ultimo_backup.json não encontrado.')
    process.exit(1)
  }

  const payload = JSON.parse(fs.readFileSync(ULTIMO_BCK, 'utf-8'))
  const { contas, categorias, transacoes, transferencias } = payload

  console.log(`  Backup: ${contas.length} contas | ${categorias.length} categorias | ${transacoes.length} transações | ${(transferencias ?? []).length} transferências\n`)

  const mapaContas:     Record<string, string> = {}
  const mapaCategorias: Record<string, string> = {}

  // ── Verificar se banco está vazio ou tem dados ─────────────────
  const { data: contasAtual } = await api('/contas') as { data: any }
  const contasBanco: any[] = Array.isArray(contasAtual) ? contasAtual : (contasAtual?.dados ?? [])
  const bancoVazio = contasBanco.length === 0

  if (bancoVazio) {
    console.log('  Banco vazio — criando tudo diretamente (modo rápido)\n')
  } else {
    console.log('  Banco com dados — verificando duplicatas antes de criar\n')
  }

  // ── 1. Contas ─────────────────────────────────────────────────
  process.stdout.write('  [1/4] Contas... ')
  let okContas = 0, jaExistiamContas = 0

  for (const c of contas) {
    // Verificar se já existe no banco atual
    const ex = contasBanco.find((x: any) => normNome(x.nome) === normNome(c.nome) && x.tipo === c.tipo)
    if (ex) {
      mapaContas[c.conta_id] = ex.conta_id
      jaExistiamContas++
      continue
    }
    // Criar
    const { status, data } = await api('/contas', 'POST', {
      nome: c.nome, tipo: c.tipo, saldo_inicial: c.saldo_inicial ?? 0,
      icone: c.icone, cor: c.cor, ativa: c.ativa,
    }) as { status: number; data: any }
    if (status === 201 && data?.conta_id) {
      mapaContas[c.conta_id] = data.conta_id
      okContas++
    } else {
      console.warn(`\n    ⚠️  Conta "${c.nome}": status ${status}`)
    }
    await sleep(50)
  }
  console.log(`${okContas} criadas, ${jaExistiamContas} já existiam`)

  // ── 2. Categorias ─────────────────────────────────────────────
  process.stdout.write('  [2/4] Categorias... ')
  let okCats = 0, jaExistiamCats = 0

  // Buscar categorias atuais do banco
  const { data: catsAtual } = await api('/categorias') as { data: any }
  const catsBanco: any[] = Array.isArray(catsAtual) ? catsAtual : (catsAtual?.dados ?? [])

  // Mapear protegidas (sempre existem)
  for (const c of categorias.filter((x: any) => x.protegida)) {
    const ex = catsBanco.find((x: any) => normNome(x.descricao) === normNome(c.descricao) && x.protegida)
    if (ex) mapaCategorias[c.id] = ex.id
  }

  const pais   = categorias.filter((x: any) => !x.id_pai && !x.protegida)
  const filhos = categorias.filter((x: any) =>  x.id_pai && !x.protegida)

  // Pais — verificar existência e criar se necessário
  for (const c of pais) {
    const ex = catsBanco.find((x: any) => normNome(x.descricao) === normNome(c.descricao) && !x.id_pai)
    if (ex) { mapaCategorias[c.id] = ex.id; jaExistiamCats++; continue }
    const { status, data } = await api('/categorias', 'POST', {
      descricao: c.descricao, tipo: c.tipo, icone: c.icone, cor: c.cor,
    }) as { status: number; data: any }
    if (status === 201 && data?.id) { mapaCategorias[c.id] = data.id; okCats++ }
    else console.warn(`\n    ⚠️  Categoria "${c.descricao}": status ${status}`)
    await sleep(50)
  }

  // Filhos — verificar existência e criar se necessário
  for (const c of filhos) {
    const novoIdPai = mapaCategorias[c.id_pai]
    if (!novoIdPai) { console.warn(`\n    ⚠️  Pai não encontrado para "${c.descricao}"`); continue }
    const ex = catsBanco.find((x: any) => normNome(x.descricao) === normNome(c.descricao) && x.id_pai === novoIdPai)
    if (ex) { mapaCategorias[c.id] = ex.id; jaExistiamCats++; continue }
    const { status, data } = await api('/categorias', 'POST', {
      descricao: c.descricao, tipo: c.tipo, icone: c.icone, cor: c.cor, id_pai: novoIdPai,
    }) as { status: number; data: any }
    if (status === 201 && data?.id) { mapaCategorias[c.id] = data.id; okCats++ }
    else console.warn(`\n    ⚠️  Subcategoria "${c.descricao}": status ${status}`)
    await sleep(50)
  }
  console.log(`${okCats} criadas, ${jaExistiamCats} já existiam`)

  // ── 3. Transações ─────────────────────────────────────────────
  process.stdout.write('  [3/4] Transações... ')
  let okTx = 0, errTx = 0, skipTx = 0

  const txOrdenadas = [...transacoes].sort((a: any, b: any) => a.data.localeCompare(b.data))

  if (false) {
    // placeholder removido
  } else {
    // Buscar transações existentes para checar duplicatas
    const hoje = new Date()
    const meses: string[] = []
    for (let i = 23; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const resArr  = await Promise.all(meses.map(m => api(`/transacoes?mes=${m}&per_page=1000`)))
    const txBanco = resArr.flatMap((r: any) => {
      const d = r.data; return Array.isArray(d) ? d : (d?.dados ?? [])
    })
    // Chave mais específica: data + descricao + valor + conta_id original mapeado
    const chavesBanco = new Set(
      txBanco.map((t: any) => `${t.data}|${normNome(t.descricao)}|${t.valor}|${t.conta_id}`)
    )
    for (const t of txOrdenadas) {
      const conta_id     = mapaContas[t.conta_id]
      const categoria_id = t.categoria_id ? mapaCategorias[t.categoria_id] : undefined
      if (!conta_id) { errTx++; continue }
      const chave = `${t.data}|${normNome(t.descricao)}|${t.valor}|${conta_id}`
      if (chavesBanco.has(chave)) { skipTx++; continue }
      const { status } = await api('/transacoes', 'POST', {
        tipo: t.tipo, data: t.data, descricao: t.descricao,
        valor: t.valor, conta_id, categoria_id,
        status: t.status, observacao: t.observacao,
      }) as { status: number; data: any }
      if (status === 201) okTx++
      else errTx++
      await sleep(50)
    }
  }
  console.log(`${okTx} criadas${skipTx > 0 ? `, ${skipTx} já existiam` : ''}${errTx > 0 ? `, ${errTx} erros` : ''}`)

  // ── 4. Transferências ─────────────────────────────────────────
  if ((transferencias ?? []).length > 0) {
    process.stdout.write('  [4/4] Transferências... ')
    let okTrf = 0, errTrf = 0
    const parsUnicos = new Map<string, any>()
    for (const t of transferencias) {
      const parId = t.id_par ?? t.id_recorrencia
      if (parId && !parsUnicos.has(parId)) parsUnicos.set(parId, t)
    }
    if (bancoVazio) {
      await emLotes([...parsUnicos.values()], 5, async (t: any) => {
        const origem  = mapaContas[t.conta_origem_id ?? t.conta_id]
        const destino = mapaContas[t.conta_destino_id]
        if (!origem || !destino) { errTrf++; return }
        const { status } = await api('/transferencias', 'POST', {
          conta_origem_id: origem, conta_destino_id: destino,
          valor: t.valor, data: t.data, descricao: t.descricao, status: t.status,
        }) as { status: number; data: any }
        if (status === 201) okTrf++; else errTrf++
      })
    }
    console.log(`${okTrf} criadas${errTrf > 0 ? `, ${errTrf} erros` : ''}`)
  }

  console.log('\n  ✅ Restore concluído!\n')
}

restore()
