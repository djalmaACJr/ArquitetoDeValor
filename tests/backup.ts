// tests/backup.ts
// Faz backup dos dados do usuário autenticado antes dos testes
// Salva em tests/backup_data/ como arquivos JSON com timestamp

import * as fs from 'fs'
import * as path from 'path'
import { api } from './setup'

const BACKUP_DIR = path.join(__dirname, 'backup_data')

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

    // 2. Categorias (com hierarquia)
    process.stdout.write('  Salvando categorias...')
    const { data: resCats } = await api('/categorias') as { data: any }
    const categorias = resCats?.dados ?? []
    console.log(` ${categorias.length} registros`)

    // 3. Transações (últimos 24 meses para cobrir tudo)
    process.stdout.write('  Salvando transacoes...')
    const hoje     = new Date()
    const anoAtual = hoje.getFullYear()
    const mesAtual = hoje.getMonth() + 1
    // Calcula 24 meses atrás
    let anoInicio = anoAtual - 2
    let mesInicio = mesAtual
    const dataInicio = `${anoInicio}-${String(mesInicio).padStart(2, '0')}-01`
    const dataFim    = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-31`

    const { data: resTx } = await api(
      `/transacoes?data_inicio=${dataInicio}&data_fim=${dataFim}&per_page=5000`
    ) as { data: any }
    const transacoes = (resTx?.dados ?? []).filter(
      (t: any) => !t.id_par_transferencia && !t.descricao?.startsWith('[Transf.')
    )
    console.log(` ${transacoes.length} registros (excluindo transferências)`)

    // 4. Transferências
    process.stdout.write('  Salvando transferencias...')
    const { data: resTrf } = await api('/transferencias?per_page=5000') as { data: any }
    const transferencias = resTrf?.dados ?? []
    console.log(` ${transferencias.length} registros`)

    // Salvar JSON
    const payload = {
      gerado_em:    new Date().toISOString(),
      contas,
      categorias,
      transacoes,
      transferencias,
    }
    fs.writeFileSync(arquivo, JSON.stringify(payload, null, 2), 'utf-8')

    console.log(`\n  ✅ Backup salvo em: ${arquivo}`)
    console.log(`     Contas: ${contas.length} | Categorias: ${categorias.length} | Transações: ${transacoes.length} | Transferências: ${transferencias.length}`)

    // Salvar também como "ultimo_backup.json" para o restore encontrar facilmente
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
