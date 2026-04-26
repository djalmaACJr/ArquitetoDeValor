// tests/restore.ts
// Restaura os dados do usuário a partir do ultimo_backup.json
// Executa após os testes para repor o estado original do banco

import * as fs from 'fs'
import * as path from 'path'
import { api } from './setup'

const BACKUP_DIR  = path.join(__dirname, 'backup_data')
const ULTIMO_BCK  = path.join(BACKUP_DIR, 'ultimo_backup.json')

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function restore() {
  console.log('\n================================================')
  console.log('  RESTORE — Restaurando dados após os testes')
  console.log('================================================\n')

  if (!fs.existsSync(ULTIMO_BCK)) {
    console.error('  ❌ Arquivo ultimo_backup.json não encontrado.')
    console.error(`     Esperado em: ${ULTIMO_BCK}`)
    process.exit(1)
  }

  const payload = JSON.parse(fs.readFileSync(ULTIMO_BCK, 'utf-8'))
  const { contas, categorias, transacoes, transferencias } = payload

  console.log(`  Backup gerado em: ${payload.gerado_em}`)
  console.log(`  Contas: ${contas.length} | Categorias: ${categorias.length} | Transações: ${transacoes.length} | Transferências: ${transferencias.length}\n`)

  // ── Mapas de IDs antigos → novos (necessário para recriar vínculos) ──
  const mapaContas:     Record<string, string> = {}
  const mapaCategorias: Record<string, string> = {}

  // ── 1. Recriar Contas ─────────────────────────────────────────────
  console.log('  [1/4] Recriando contas...')
  let okContas = 0
  for (const c of contas) {
    const { status, data } = await api('/contas', 'POST', {
      nome:          c.nome,
      tipo:          c.tipo,
      saldo_inicial: c.saldo_inicial ?? 0,
      icone:         c.icone,
      cor:           c.cor,
      ativa:         c.ativa,
    }) as { status: number; data: any }

    if (status === 201 && data?.conta_id) {
      mapaContas[c.conta_id] = data.conta_id
      okContas++
    } else if (status === 409) {
      // Já existe — buscar o ID atual pelo nome+tipo
      const { data: lista } = await api('/contas') as { data: any }
      const existente = (lista?.dados ?? []).find(
        (x: any) => x.nome === c.nome && x.tipo === c.tipo
      )
      if (existente) mapaContas[c.conta_id] = existente.conta_id
    } else {
      console.warn(`    ⚠️  Conta "${c.nome}": status ${status}`)
    }
    await sleep(100)
  }
  console.log(`    ✅ ${okContas}/${contas.length} contas criadas`)

  // ── 2. Recriar Categorias (pais primeiro, depois filhos) ──────────
  console.log('  [2/4] Recriando categorias...')
  let okCats = 0
  const pais   = categorias.filter((c: any) => !c.id_pai && !c.protegida)
  const filhos = categorias.filter((c: any) =>  c.id_pai && !c.protegida)

  // Categorias protegidas já existem no banco, só mapear
  const protegidas = categorias.filter((c: any) => c.protegida)
  for (const p of protegidas) {
    const { data: lista } = await api('/categorias') as { data: any }
    const existente = (lista?.dados ?? []).find((x: any) => x.descricao === p.descricao && x.protegida)
    if (existente) mapaCategorias[p.id] = existente.id
  }

  // Pais
  for (const c of pais) {
    const { status, data } = await api('/categorias', 'POST', {
      descricao: c.descricao,
      tipo:      c.tipo,
      icone:     c.icone,
      cor:       c.cor,
    }) as { status: number; data: any }

    if (status === 201 && data?.id) {
      mapaCategorias[c.id] = data.id
      okCats++
    } else if (status === 409) {
      const { data: lista } = await api('/categorias') as { data: any }
      const existente = (lista?.dados ?? []).find((x: any) => x.descricao === c.descricao && !x.id_pai)
      if (existente) mapaCategorias[c.id] = existente.id
    } else {
      console.warn(`    ⚠️  Categoria "${c.descricao}": status ${status}`)
    }
    await sleep(100)
  }

  // Filhos
  for (const c of filhos) {
    const novoIdPai = mapaCategorias[c.id_pai]
    if (!novoIdPai) { console.warn(`    ⚠️  Pai não encontrado para subcategoria "${c.descricao}"`); continue }

    const { status, data } = await api('/categorias', 'POST', {
      descricao: c.descricao,
      tipo:      c.tipo,
      icone:     c.icone,
      cor:       c.cor,
      id_pai:    novoIdPai,
    }) as { status: number; data: any }

    if (status === 201 && data?.id) {
      mapaCategorias[c.id] = data.id
      okCats++
    } else if (status === 409) {
      const { data: lista } = await api('/categorias') as { data: any }
      const existente = (lista?.dados ?? []).find(
        (x: any) => x.descricao === c.descricao && x.id_pai === novoIdPai
      )
      if (existente) mapaCategorias[c.id] = existente.id
    } else {
      console.warn(`    ⚠️  Subcategoria "${c.descricao}": status ${status}`)
    }
    await sleep(100)
  }
  console.log(`    ✅ ${okCats}/${pais.length + filhos.length} categorias criadas`)

  // ── 3. Recriar Transações ─────────────────────────────────────────
  console.log('  [3/4] Recriando transacoes...')
  let okTx = 0, errTx = 0
  // Ordenar por data para manter ordem cronológica
  const txOrdenadas = [...transacoes].sort((a: any, b: any) => a.data.localeCompare(b.data))

  for (const t of txOrdenadas) {
    const novaContaId    = mapaContas[t.conta_id]
    const novaCategoriaId = t.categoria_id ? mapaCategorias[t.categoria_id] : undefined

    if (!novaContaId) {
      console.warn(`    ⚠️  Transação "${t.descricao}" ignorada: conta não mapeada`)
      errTx++
      continue
    }

    const { status } = await api('/transacoes', 'POST', {
      tipo:        t.tipo,
      data:        t.data,
      descricao:   t.descricao,
      valor:       t.valor,
      conta_id:    novaContaId,
      categoria_id: novaCategoriaId,
      status:      t.status,
      observacao:  t.observacao,
    }) as { status: number; data: any }

    if (status === 201) okTx++
    else { console.warn(`    ⚠️  Transação "${t.descricao}" (${t.data}): status ${status}`); errTx++ }
    await sleep(80)
  }
  console.log(`    ✅ ${okTx}/${transacoes.length} transações criadas${errTx > 0 ? ` (${errTx} erros)` : ''}`)

  // ── 4. Recriar Transferências ─────────────────────────────────────
  console.log('  [4/4] Recriando transferencias...')
  let okTrf = 0, errTrf = 0

  // Deduplica por id_par para não criar em duplicata
  const parsUnicos = new Map<string, any>()
  for (const t of transferencias) {
    const parId = t.id_par ?? t.id_recorrencia
    if (parId && !parsUnicos.has(parId)) parsUnicos.set(parId, t)
  }

  for (const t of parsUnicos.values()) {
    const novaOrigem  = mapaContas[t.conta_origem_id ?? t.conta_id]
    const novaDestino = mapaContas[t.conta_destino_id]

    if (!novaOrigem || !novaDestino) {
      console.warn(`    ⚠️  Transferência "${t.descricao ?? ''}" ignorada: contas não mapeadas`)
      errTrf++
      continue
    }

    const { status } = await api('/transferencias', 'POST', {
      conta_origem_id:  novaOrigem,
      conta_destino_id: novaDestino,
      valor:            t.valor,
      data:             t.data,
      descricao:        t.descricao,
      status:           t.status,
    }) as { status: number; data: any }

    if (status === 201) okTrf++
    else { console.warn(`    ⚠️  Transferência "${t.descricao}" (${t.data}): status ${status}`); errTrf++ }
    await sleep(100)
  }
  console.log(`    ✅ ${okTrf}/${parsUnicos.size} transferências criadas${errTrf > 0 ? ` (${errTrf} erros)` : ''}`)

  console.log('\n  ✅ Restore concluído!\n')
}

restore()
