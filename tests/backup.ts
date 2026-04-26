// tests/backup.ts
// Faz backup COMPLETO dos dados do usuário autenticado antes dos testes
// Salva em tests/backup_data/ como arquivos JSON com timestamp

import * as fs from 'fs'
import * as path from 'path'
import { api } from './setup'

const BACKUP_DIR = path.join(__dirname, 'backup_data')

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function backup() {
  console.log('\n================================================')
  console.log('  BACKUP — Salvando dados antes dos testes')
  console.log('================================================\n')

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const arquivo   = path.join(BACKUP_DIR, `backup_${timestamp}.json`)

  try {
    // 1. Contas
    process.stdout.write('  Salvando contas...')
    const { data: resContas } = await api('/contas') as { data: any }
    const contas = resContas?.dados ?? []
    console.log(` ${contas.length} registros`)

    // 2. Categorias
    process.stdout.write('  Salvando categorias...')
    const { data: resCats } = await api('/categorias') as { data: any }
    const categorias = resCats?.dados ?? []
    console.log(` ${categorias.length} registros`)

    // 3. Transações — 60 meses passados + 24 meses futuros (cobre projeções e parcelas)
    process.stdout.write('  Salvando transacoes...')
    const hoje = new Date()
    const meses: string[] = []
    for (let i = 60; i >= -24; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const todasTx: any[] = []
    for (const mes of meses) {
      const { data: resTx } = await api(`/transacoes?mes=${mes}&per_page=1000`) as { data: any }
      const dados = resTx?.dados ?? []
      todasTx.push(...dados)
      await sleep(50)
    }

    // Deduplica por id
    const txMap = new Map(todasTx.map((t: any) => [t.id, t]))
    const transacoes = [...txMap.values()].filter(
      (t: any) => !t.id_par_transferencia && !t.descricao?.startsWith('[Transf.')
    )
    console.log(` ${transacoes.length} registros`)

    // 4. Transferências — mês a mês (endpoint não suporta busca global)
    process.stdout.write('  Salvando transferencias...')
    const todasTrf: any[] = []
    for (const mes of meses) {
      const { data: resTrf } = await api(`/transferencias?mes=${mes}`) as { data: any }
      const dados = Array.isArray(resTrf) ? resTrf : []
      todasTrf.push(...dados)
      await sleep(50)
    }
    // Deduplica por id_par
    const trfMap = new Map(todasTrf.map((t: any) => [t.id_par, t]))
    const transferencias = [...trfMap.values()]
    console.log(` ${transferencias.length} registros`)

    // Salvar JSON
    const payload = {
      gerado_em:    new Date().toISOString(),
      versao:       '1.0',
      contas,
      categorias,
      transacoes,
      transferencias,
    }
    fs.writeFileSync(arquivo, JSON.stringify(payload, null, 2), 'utf-8')

    console.log(`\n  ✅ Backup salvo em: ${arquivo}`)
    console.log(`     Contas: ${contas.length} | Categorias: ${categorias.length} | Transações: ${transacoes.length} | Transferências: ${transferencias.length}`)

    // Cópia como ultimo_backup.json
    const ultimo = path.join(BACKUP_DIR, 'ultimo_backup.json')
    fs.copyFileSync(arquivo, ultimo)
    console.log(`     Cópia salva como: ultimo_backup.json`)

  } catch (e) {
    console.error('\n  ❌ Erro no backup:', (e as Error).message)
    process.exit(1)
  }

  console.log()
}

backup()
