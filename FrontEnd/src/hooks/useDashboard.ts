// FrontEnd/src/hooks/useDashboard.ts

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Conta, Transacao, ResumoMensal, DespesaCategoria } from '../types'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function apiFetch(path: string, session: { access_token: string }) {
  // ← ADICIONA saldo=true automaticamente
  const separator = path.includes('?') ? '&' : '?'
  const fullPath = `${path}${separator}saldo=true`
  
  const res = await fetch(`${BASE}${fullPath}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ erro: res.statusText }))
    console.error(`❌ API ${fullPath}: ${res.status}`, err)
    throw new Error(`API ${fullPath}: ${res.status}`)
  }
  const data = await res.json()
  console.log(`✅ ${fullPath}:`, data.dados?.length ?? 0, 'itens')
  return data
}

function parseData(data: string): { ano: number; mes: number } {
  const [y, m] = data.split('-').slice(0, 2)
  return { ano: parseInt(y), mes: parseInt(m) }
}

export function useDashboard(mes: string) {
  const [contas, setContas]     = useState<Conta[]>([])
  const [pendentes, setPendentes] = useState<Transacao[]>([])
  const [proximas, setProximas]   = useState<Transacao[]>([])
  const [resumo, setResumo]     = useState<ResumoMensal | null>(null)
  const [despesasCat, setDespesasCat] = useState<DespesaCategoria[]>([])
  const [receitasCat, setReceitasCat] = useState<DespesaCategoria[]>([])
  const [historico, setHistorico] = useState<ResumoMensal[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setError('Não autenticado')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [anoStr, mesStr] = mes.split('-')
      const ano = parseInt(anoStr)
      const m   = parseInt(mesStr)
      const hoje = new Date().toISOString().split('T')[0]

      console.log(`\n========== DASHBOARD ${mes} ==========`)

      const [contasRes, pendentesRes, resumoMensalRes] = await Promise.all([
        apiFetch('/contas', session),
        apiFetch(`/transacoes?status=PENDENTE&mes=${mes}`, session),
        apiFetch('/transacoes', session),
      ])

      setContas(contasRes.dados ?? [])

      const todasPend: Transacao[] = pendentesRes.dados ?? []
      console.log(`📌 Pendentes: ${todasPend.length}`)
      setPendentes(todasPend.filter((t: Transacao) => t.data <= hoje))
      setProximas(todasPend.filter((t: Transacao) => t.data > hoje))

      let todas: Transacao[] = resumoMensalRes.dados ?? []
      
      // Se ano_tx/mes_tx são NULL, calcular a partir de data
      todas = todas.map(t => ({
        ...t,
        ano_tx: t.ano_tx ?? parseData(t.data).ano,
        mes_tx: t.mes_tx ?? parseData(t.data).mes,
      }))

      console.log(`✅ Total de transações: ${todas.length}`)

      // Verificar meses únicos
      const mesesUnicos = new Set<string>()
      todas.forEach(t => {
        mesesUnicos.add(`${t.ano_tx}-${String(t.mes_tx).padStart(2, '0')}`)
      })
      console.log(`📊 Meses no banco: ${Array.from(mesesUnicos).sort().reverse().join(', ')}`)

      const doMes = todas.filter((t: Transacao) => t.ano_tx === ano && t.mes_tx === m)
      console.log(`📅 Transações de ${ano}-${String(m).padStart(2, '0')}: ${doMes.length}`)

      if (doMes.length > 0) {
        console.log('   Exemplo:', doMes[0])
      }

      const entradas = doMes.filter((t: Transacao) => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
      const saidas   = doMes.filter((t: Transacao) => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)
      console.log(`💰 Resumo: E=${entradas} | S=${saidas}`)
      setResumo({ user_id: session.user.id, mes, total_entradas: entradas, total_saidas: saidas })

      // ─ DESPESAS ─
      console.log('\n🔍 DEBUG DESPESAS:')
      const totalDespesas = doMes.filter(t => t.tipo === 'DESPESA').length
      const despesasComId = doMes.filter(t => t.tipo === 'DESPESA' && t.categoria_id)
      const despesasComNome = doMes.filter(t => t.tipo === 'DESPESA' && t.categoria_nome)
      const despesasComCat = doMes.filter(
        (t: Transacao) => t.tipo === 'DESPESA' && t.categoria_id && t.categoria_nome
      )

      console.log(`   Total despesas: ${totalDespesas}`)
      console.log(`   Com categoria_id: ${despesasComId.length}`)
      console.log(`   Com categoria_nome: ${despesasComNome.length}`)
      console.log(`   Com AMBOS: ${despesasComCat.length}`)
      
      if (doMes.find(t => t.tipo === 'DESPESA')) {
        console.log('   Exemplo despesa:', doMes.find(t => t.tipo === 'DESPESA'))
      }
      if (despesasComCat.length > 0) {
        console.log('   Exemplo despesa COM categoria:', despesasComCat[0])
      }

      const mapDesp = new Map<string, DespesaCategoria>()
      despesasComCat.forEach((t: Transacao) => {
        const key = t.categoria_id || t.categoria_nome
        const ex  = mapDesp.get(key!)
        if (ex) {
          ex.total += t.valor
        } else {
          mapDesp.set(key!, {
            user_id: session.user.id,
            mes,
            categoria_id: t.categoria_id ?? '',
            categoria_nome: t.categoria_nome!,
            categoria_icone: t.categoria_icone ?? '',
            total: t.valor
          })
        }
      })
      const despesas = [...mapDesp.values()].sort((a, b) => b.total - a.total).slice(0, 5)
      console.log(`   ✅ Despesas agrupadas: ${despesas.length}`)
      setDespesasCat(despesas)

      // ─ RECEITAS ─
      console.log('\n🔍 DEBUG RECEITAS:')
      const totalReceitas = doMes.filter(t => t.tipo === 'RECEITA').length
      const receitasComId = doMes.filter(t => t.tipo === 'RECEITA' && t.categoria_id)
      const receitasComNome = doMes.filter(t => t.tipo === 'RECEITA' && t.categoria_nome)
      const receitasComCat = doMes.filter(
        (t: Transacao) => t.tipo === 'RECEITA' && t.categoria_id && t.categoria_nome
      )

      console.log(`   Total receitas: ${totalReceitas}`)
      console.log(`   Com categoria_id: ${receitasComId.length}`)
      console.log(`   Com categoria_nome: ${receitasComNome.length}`)
      console.log(`   Com AMBOS: ${receitasComCat.length}`)
      
      if (doMes.find(t => t.tipo === 'RECEITA')) {
        console.log('   Exemplo receita:', doMes.find(t => t.tipo === 'RECEITA'))
      }
      if (receitasComCat.length > 0) {
        console.log('   Exemplo receita COM categoria:', receitasComCat[0])
      }

      const mapRec = new Map<string, DespesaCategoria>()
      receitasComCat.forEach((t: Transacao) => {
        const key = t.categoria_id || t.categoria_nome
        const ex  = mapRec.get(key!)
        if (ex) {
          ex.total += t.valor
        } else {
          mapRec.set(key!, {
            user_id: session.user.id,
            mes,
            categoria_id: t.categoria_id ?? '',
            categoria_nome: t.categoria_nome!,
            categoria_icone: t.categoria_icone ?? '',
            total: t.valor
          })
        }
      })
      const receitas = [...mapRec.values()].sort((a, b) => b.total - a.total).slice(0, 4)
      console.log(`   ✅ Receitas agrupadas: ${receitas.length}`)
      setReceitasCat(receitas)

      // ─ HISTÓRICO 12 MESES ─
      console.log('\n📈 DEBUG HISTÓRICO:')
      const hist: ResumoMensal[] = []
      
      for (let i = 11; i >= 0; i--) {
        const d = new Date(ano, m - 1 - i, 1)
        const a = d.getFullYear()
        const mm = d.getMonth() + 1
        
        const fatia = todas.filter((t: Transacao) => t.ano_tx === a && t.mes_tx === mm)
        const totalEnt = fatia.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
        const totalSai = fatia.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)
        
        console.log(`   ${a}-${String(mm).padStart(2, '0')}: ${fatia.length} tx | E=${totalEnt} | S=${totalSai}`)
        
        hist.push({
          user_id: session.user.id,
          mes: `${a}-${String(mm).padStart(2, '0')}`,
          total_entradas: totalEnt,
          total_saidas: totalSai,
        })
      }
      console.log(`   ✅ Histórico carregado com 12 meses`)
      setHistorico(hist)

      console.log(`\n========== FIM DASHBOARD ==========\n`)
    } catch (e) {
      console.error('❌ Erro:', e)
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [mes])

  useEffect(() => { carregar() }, [carregar])

  return { contas, pendentes, proximas, resumo, despesasCat, receitasCat, historico, loading, error, refetch: carregar }
}