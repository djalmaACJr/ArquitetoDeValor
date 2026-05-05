// src/pages/DashboardPage.tsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ChevronDown, ChevronRight, RefreshCw, History } from 'lucide-react'
import { useDashboard } from '../hooks/useDashboard'
import { mesLabel, formatBRL, formatData, CORES_CATEGORIA } from '../lib/utils'
import { usePageState } from '../context/PageStateContext'
import { MonthPicker } from '../components/ui/MonthPicker'
import { Doughnut, Chart } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend, LineElement, PointElement,
} from 'chart.js'
import type { TooltipItem } from 'chart.js'
import type { Conta, Transacao, DespesaCategoria } from '../types'
import type { Lancamento } from '../hooks/useLancamentos'
import { supabase } from '../lib/supabase'
import DrawerLancamento from '../components/ui/DrawerLancamento'
import BotaoNovoLancamento from '../components/ui/BotaoNovoLancamento'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend, LineElement, PointElement)

// -- Icone de conta inline (sem dependencia externa) ------
function IconeConta({ icone, cor, size = 'md' }: {
  icone?: string | null; cor?: string | null; size?: 'sm' | 'md' | 'lg'
}) {
  const dims  = { sm: 'w-5 h-5', md: 'w-8 h-8', lg: 'w-10 h-10' }[size]
  const texto = { sm: 'text-xs',  md: 'text-sm',  lg: 'text-lg'  }[size]
  const bg    = cor ? `${cor}20` : 'rgba(77,166,255,0.12)'
  const isImg = !!(icone?.startsWith('http') || icone?.startsWith('/') || icone?.startsWith('data:'))
  return (
    <div className={`${dims} rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden`} style={{ background: bg }}>
      {isImg
        ? <img src={icone!} alt="" className="w-full h-full object-contain p-[2px]" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}/>
        : <span className={texto}>{icone || '🏦'}</span>
      }
    </div>
  )
}

const OCULTO = '??????'

function navMesStr(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// -- Card de resultado do mes -----------------------------
function CardResultados({
  resumo,
}: {
  resumo: { total_entradas: number; total_saidas: number } | null
}) {
  const resultado = (resumo?.total_entradas ?? 0) - (resumo?.total_saidas ?? 0)
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-av-green"/>
        <span className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">Resultados do mês</span>
      </div>
      <div className="grid grid-cols-3 gap-0 divide-x divide-gray-200 dark:divide-gray-700 min-w-0">
        {[
          { label: 'Receitas',  value: resumo?.total_entradas ?? 0, cor: 'text-av-green' },
          { label: 'Despesas',  value: resumo?.total_saidas   ?? 0, cor: 'text-red-400'  },
          { label: 'Resultado', value: resultado,                    cor: resultado >= 0 ? 'text-av-green' : 'text-red-400' },
        ].map(({ label, value, cor }) => (
          <div key={label} className="px-3 first:pl-0 last:pr-0">
            <p className="text-[11px] text-gray-400 mb-1">{label}</p>
            <p className={`text-[16px] font-bold ${cor}`}>
              {formatBRL(value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// -- Card de saldo acumulado ------------------------------
function CardSaldo({ contas, oculto, mes, historico, modo, setModo }: {
  contas: Conta[]
  oculto: boolean
  mes: string
  historico: { mes: string; saldo_mes?: number }[]
  modo: 'hoje' | 'fim'
  setModo: (m: 'hoje' | 'fim') => void
}) {
  const mesAtualStr = new Date().toISOString().slice(0, 7)
  const isMesAtual  = mes === mesAtualStr
  // Saldo ate hoje (soma dos saldos_atual das contas - posicao real agora)
  const saldoHoje = contas.reduce((s, c) => s + c.saldo_atual, 0)

  // Saldo do mes selecionado: ultimo saldo_acumulado do mes no historico
  const entradaMes  = historico.find(h => h.mes === mes)
  const saldoFimMes = entradaMes?.saldo_mes ?? null

  // Logica de exibicao:
  // - Mes atual + "ate hoje"  -> saldo real das contas agora
  // - Mes atual + "ate fim"   -> saldo_acumulado fim do mes (historico)
  // - Qualquer outro mes      -> saldo_acumulado fim do mes (historico) - NUNCA saldoHoje
  const saldoExibido = isMesAtual
    ? (modo === 'hoje' ? saldoHoje : (saldoFimMes ?? saldoHoje))
    : (saldoFimMes ?? 0)

  const progressoMes = (() => {
    if (!isMesAtual) return 100
    const hoje      = new Date()
    const diaAtual  = hoje.getDate()
    const totalDias = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
    return Math.round((diaAtual / totalDias) * 100)
  })()

  // Label do subtitulo
  const labelData = (() => {
    if (!isMesAtual) {
      const [ano, m] = mes.split('-')
      const ultimoDia = new Date(parseInt(ano), parseInt(m), 0).getDate()
      return `Saldo em ${ultimoDia}/${m}/${ano}`
    }
    return modo === 'hoje'
      ? `Posição em ${formatData(new Date().toISOString().split('T')[0])}`
      : 'Projetado até fim do mês'
  })()

  return (
    <div className="bg-av-dark rounded-xl p-4 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.07]" style={{
        backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px)'
      }}/>
      <div className="relative flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-white/50">
          {isMesAtual ? 'Saldo acumulado' : `Saldo em ${mes.split('-')[1]}/${mes.split('-')[0]}`}
        </span>
        {isMesAtual && (
          <select
            value={modo} onChange={e => setModo(e.target.value as 'hoje' | 'fim')}
            className="text-[11px] bg-blue-400/10 border border-blue-400/30 rounded-md text-av-blue px-2 py-1 cursor-pointer"
          >
            <option value="hoje">Até hoje</option>
            <option value="fim">Até fim do mês</option>
          </select>
        )}
        {!isMesAtual && (
          <span className="text-[11px] bg-blue-400/10 border border-blue-400/30 rounded-md text-av-blue px-2 py-1">
            {mes.split('-')[1]}/{mes.split('-')[0]}
          </span>
        )}
      </div>
      <p className="relative text-[28px] font-bold text-av-green leading-none">
        {oculto ? OCULTO : formatBRL(saldoExibido)}
      </p>
      <p className="relative text-[11px] text-white/35 mt-1.5">
        {oculto ? '-' : labelData}
      </p>
      <div className="relative mt-3 h-[3px] rounded-full bg-blue-400/15">
        <div className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-av-green to-av-amber"
          style={{ width: oculto ? '0%' : `${progressoMes}%` }}/>
      </div>
    </div>
  )
}

// -- Grupo de conta dentro do card de alertas -------------
function GrupoConta({
  nomeConta, icone, cor, total, itens, corTotal, onEditar,
}: {
  nomeConta: string; icone: string | null; cor: string | null
  total: number; itens: Transacao[]; corTotal: string
  onEditar: (tx: Transacao) => void
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      {/* Cabecalho do grupo - clicavel */}
      <button
        onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {aberto
            ? <ChevronDown size={13} className="text-gray-400 flex-shrink-0"/>
            : <ChevronRight size={13} className="text-gray-400 flex-shrink-0"/>
          }
          <IconeConta icone={icone} cor={cor} size="sm" />
          <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-200 text-left">
            {nomeConta}
          </span>
          <span className="text-[10px] text-gray-400 ml-1">
            ({itens.length} {itens.length === 1 ? 'item' : 'itens'})
          </span>
        </div>
        <span className="text-[12px] font-bold whitespace-nowrap" style={{ color: corTotal }}>
          {formatBRL(Math.abs(total))}
        </span>
      </button>

      {/* Lancamentos expandidos */}
      {aberto && (
        <div className="bg-gray-50/50 dark:bg-gray-700/30">
          <div className="grid grid-cols-[1fr_56px_72px] px-6 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-700">
            <span>Transação</span><span className="text-center">Data</span><span className="text-right">Valor</span>
          </div>
          {itens.map(tx => (
            <div
              key={tx.id}
              onClick={() => onEditar(tx)}
              className="grid grid-cols-[1fr_56px_72px] items-center px-6 py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 cursor-pointer hover:bg-white/5 transition-colors"
            >
              <span className="text-[12px] text-gray-700 dark:text-gray-200 truncate flex items-center gap-1">
                {tx.id_recorrencia && (
                  <span className="w-3 h-3 rounded-full border border-gray-400 flex items-center justify-center flex-shrink-0 text-[7px] text-gray-400">↻</span>
                )}
                {tx.descricao}
                {tx.nr_parcela && tx.total_parcelas && (
                  <span className="text-gray-400 text-[10px]">({tx.nr_parcela}/{tx.total_parcelas})</span>
                )}
              </span>
              <span className="text-[11px] text-gray-400 text-center">{formatData(tx.data)}</span>
              <span className={`text-[12px] font-semibold text-right ${tx.tipo === 'RECEITA' ? 'text-av-green' : 'text-red-400'}`}>
                {tx.tipo === 'RECEITA' ? '+' : '-'}{formatBRL(tx.valor)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// -- Card de alertas agrupado por conta -------------------
function CardAlertas({
  titulo, cor, total, itens, contas, onVerTodos, onEditar, filtravel, mes,
}: {
  titulo: string; cor: string; total: number
  itens: Transacao[]; contas: Conta[]; onVerTodos: () => void; onEditar: (tx: Transacao) => void
  filtravel?: boolean; mes?: string
}) {
  const [aberto, setAberto] = useState(true)
  const [periodo, setPeriodo] = useState<'mes' | '30dias'>('mes')

  // Filtrar itens pelo periodo selecionado (so quando filtravel=true)
  const itensFiltrados = (() => {
    if (!filtravel) return itens
    if (periodo === 'mes') {
      // Somente do mes selecionado no dashboard
      const anoMes = mes ?? new Date().toISOString().slice(0, 7)
      return itens.filter(t => t.data.startsWith(anoMes))
    }
    // 30 dias: a partir de HOJE ate hoje+30 - independente do mes selecionado
    const hoje = new Date()
    const limite = new Date(hoje)
    limite.setDate(hoje.getDate() + 30)
    const limiteStr = limite.toISOString().slice(0, 10)
    const hojeStr   = hoje.toISOString().slice(0, 10)
    return itens.filter(t => t.data > hojeStr && t.data <= limiteStr)
  })()

  const totalFiltrado = itensFiltrados.reduce((s, t) => s + (t.tipo === 'DESPESA' ? -t.valor : t.valor), 0)

  // Agrupar itens por conta_id
  const porConta = itensFiltrados.reduce<Record<string, Transacao[]>>((acc, tx) => {
    if (!acc[tx.conta_id]) acc[tx.conta_id] = []
    acc[tx.conta_id].push(tx)
    return acc
  }, {})

  const contaMap = Object.fromEntries(contas.map(c => [c.conta_id, c]))

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Cabecalho do card - clicavel */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setAberto(a => !a)}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity"
        >
          <span className="w-2 h-2 rounded-full" style={{ background: cor }}/>
          <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">{titulo}</span>
          <span className="text-[12px] font-bold" style={{ color: cor }}>{formatBRL(Math.abs(filtravel ? totalFiltrado : total))}</span>
          {aberto ? <ChevronDown size={13} className="text-gray-400"/> : <ChevronRight size={13} className="text-gray-400"/>}
        </button>
        {filtravel && aberto && (() => {
          const mesAtualStr = new Date().toISOString().slice(0, 7)
          const isMesAtual  = !mes || mes === mesAtualStr
          if (!isMesAtual) return null
          return (
            <div className="flex rounded-lg overflow-hidden border border-white/10 text-[10px] font-semibold">
              {(['mes', '30dias'] as const).map((p, i) => (
                <button
                  key={p}
                  onClick={() => setPeriodo(p)}
                  className="px-2 py-1 transition-colors"
                  style={{
                    background: periodo === p ? 'rgba(240,180,41,0.15)' : 'transparent',
                    color: periodo === p ? '#f0b429' : '#8b92a8',
                    borderRight: i === 0 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                  }}
                >
                  {p === 'mes' ? 'Este mês' : '30 dias'}
                </button>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Grupos por conta */}
      {aberto && <div className="max-h-[240px] overflow-y-auto">
        {Object.keys(porConta).length === 0 && (
          <p className="text-[12px] text-gray-400 text-center py-6">Nenhum lançamento pendente</p>
        )}
        {Object.entries(porConta).map(([contaId, txs]) => {
          const conta    = contaMap[contaId]
          const totalConta = txs.reduce((s, t) => s + (t.tipo === 'DESPESA' ? -t.valor : t.valor), 0)
          const corTotal   = totalConta >= 0 ? '#00c896' : '#ff6b4a'
          return (
            <GrupoConta
              key={contaId}
              nomeConta={conta?.nome ?? 'Conta desconhecida'}
              icone={conta?.icone ?? null}
              cor={conta?.cor ?? null}
              total={totalConta}
              itens={txs}
              corTotal={corTotal}
              onEditar={onEditar}
            />
          )
        })}
      </div>}

      {aberto && (
        <button
          onClick={onVerTodos}
          className="w-full text-[11px] text-av-blue py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-t border-gray-100 dark:border-gray-700"
        >
          Ver todos os lançamentos
        </button>
      )}
    </div>
  )
}

// -- Grafico barras + linha de saldo ----------------------
function GraficoBarras({ historico, oculto, pagos, pendentes, projecoes }: { 
  historico: { mes: string; total_entradas: number; total_saidas: number; saldo_mes?: number }[]; 
  oculto: boolean;
  pagos: { receitas: number; despesas: number }[];
  pendentes: { receitas: number; despesas: number }[];
  projecoes: { receitas: number; despesas: number }[];
}) {
  const labels = historico.map(h => mesLabel(h.mes))

  const data = {
    labels,
    datasets: [
      // Receitas (stacked)
      {
        type: 'bar' as const,
        label: 'Receitas Pagas',
        data: pagos.map(p => p.receitas),
        backgroundColor: '#10b981',
        borderRadius: 4,
        stack: 'receitas',
        yAxisID: 'y',
        order: 3,
      },
      {
        type: 'bar' as const,
        label: 'Receitas Pendentes',
        data: pendentes.map(p => p.receitas),
        backgroundColor: '#84cc16',
        borderRadius: 4,
        stack: 'receitas',
        yAxisID: 'y',
        order: 3,
      },
      {
        type: 'bar' as const,
        label: 'Receitas Projeções',
        data: projecoes.map(p => p.receitas),
        backgroundColor: '#06b6d4',
        borderRadius: 4,
        stack: 'receitas',
        yAxisID: 'y',
        order: 3,
      },
      // Despesas (stacked)
      {
        type: 'bar' as const,
        label: 'Despesas Pagas',
        data: pagos.map(p => p.despesas),
        backgroundColor: '#dc2626',
        borderRadius: 4,
        stack: 'despesas',
        yAxisID: 'y',
        order: 3,
      },
      {
        type: 'bar' as const,
        label: 'Despesas Pendentes',
        data: pendentes.map(p => p.despesas),
        backgroundColor: '#f59e0b',
        borderRadius: 4,
        stack: 'despesas',
        yAxisID: 'y',
        order: 3,
      },
      {
        type: 'bar' as const,
        label: 'Despesas Projeções',
        data: projecoes.map(p => p.despesas),
        backgroundColor: '#8b5cf6',
        borderRadius: 4,
        stack: 'despesas',
        yAxisID: 'y',
        order: 3,
      },
      {
        type: 'line' as const,
        label: 'Resultado',
        data: oculto ? historico.map(() => null) : historico.map(h => h.total_entradas - h.total_saidas),
        borderColor: '#f97316',
        backgroundColor: 'rgba(249,115,22,0.1)',
        borderWidth: 2,
        borderDash: [4, 3],
        pointRadius: 4,
        pointBackgroundColor: '#f97316',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        tension: 0.35,
        fill: false,
        yAxisID: 'ySaldo',
        order: 2,
      },
      {
        type: 'line' as const,
        label: 'Saldo',
        data: oculto ? historico.map(() => null) : historico.map(h => h.saldo_mes ?? null),
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167,139,250,0.15)',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: '#a78bfa',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        tension: 0.35,
        fill: false,
        yAxisID: 'ySaldo',
        order: 1,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: () => '',
          afterBody: (items: TooltipItem<'bar'>[]) => {
            if (!items.length) return []
            const idx = items[0].dataIndex

            const recPagas = pagos[idx]?.receitas   ?? 0
            const recPend  = pendentes[idx]?.receitas ?? 0
            const recProj  = projecoes[idx]?.receitas ?? 0
            const desPagas = pagos[idx]?.despesas   ?? 0
            const desPend  = pendentes[idx]?.despesas ?? 0
            const desProj  = projecoes[idx]?.despesas ?? 0
            const saldo    = historico[idx]?.saldo_mes ?? null

            const linhas: string[] = []

            const temReceita = recPagas > 0 || recPend > 0 || recProj > 0
            if (temReceita) {
              linhas.push('  Receitas')
              if (recPagas > 0) linhas.push(`    ✅ Pagas:      ${formatBRL(recPagas)}`)
              if (recPend  > 0) linhas.push(`    🟡 Pendentes:  ${formatBRL(recPend)}`)
              if (recProj  > 0) linhas.push(`    🔵 Projeções:  ${formatBRL(recProj)}`)
            }

            const temDespesa = desPagas > 0 || desPend > 0 || desProj > 0
            if (temDespesa) {
              if (temReceita) linhas.push('')
              linhas.push('  Despesas')
              if (desPagas > 0) linhas.push(`    ✅ Pagas:      ${formatBRL(desPagas)}`)
              if (desPend  > 0) linhas.push(`    🟡 Pendentes:  ${formatBRL(desPend)}`)
              if (desProj  > 0) linhas.push(`    🔵 Projeções:  ${formatBRL(desProj)}`)
            }

            if (!oculto) {
              const resultado = (recPagas + recPend + recProj) - (desPagas + desPend + desProj)
              if (temReceita || temDespesa) linhas.push('')
              linhas.push(`  Resultado: ${resultado >= 0 ? '+' : ''}${formatBRL(resultado)}`)
              if (saldo !== null) linhas.push(`  Saldo:     ${formatBRL(saldo)}`)
            }

            return linhas
          },
          title: (items: TooltipItem<'bar'>[]) => {
            if (!items.length) return ''
            const h = historico[items[0].dataIndex]
            return h?.mes ? mesLabel(h.mes) : ''
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#9ca3af', font: { size: 10 } },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        position: 'left' as const,
        ticks: {
          color: '#9ca3af',
          font: { size: 10 },
          callback: (v: number | string) => `R$${(Number(v)/1000).toFixed(0)}k`,
        },
        grid: { color: 'rgba(128,128,128,0.1)' },
        border: { display: false },
      },
      ySaldo: {
        position: 'right' as const,
        display: !oculto,
        ticks: {
          color: '#a78bfa',
          font: { size: 10 },
          callback: (v: number | string) => `R$${(Number(v)/1000).toFixed(0)}k`,
        },
        grid: { display: false },
        border: { display: false },
      },
    },
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200 mb-0.5">Evolução mensal</p>
      <p className="text-[11px] text-gray-400 mb-3">Receitas, despesas e saldo - últimos 6 meses</p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3 text-[10px]">
        <div className="flex items-center gap-2">
          <span className="text-gray-600 font-semibold">Status:</span>
          {pagos.some(p => p.receitas > 0 || p.despesas > 0) && (
            <>
              <span className="w-2 h-2 rounded-sm bg-green-500"/>
              <span className="text-gray-600">Pagas</span>
            </>
          )}
          {pendentes.some(p => p.receitas > 0 || p.despesas > 0) && (
            <>
              <span className="w-2 h-2 rounded-sm bg-yellow-500"/>
              <span className="text-gray-600">Pendentes</span>
            </>
          )}
          {projecoes.some(p => p.receitas > 0 || p.despesas > 0) && (
            <>
              <span className="w-2 h-2 rounded-sm bg-blue-500"/>
              <span className="text-gray-600">Projeções</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 font-semibold">Linhas:</span>
          <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#f97316" strokeWidth="2" strokeDasharray="4 3"/></svg>
          <span className="text-gray-600">Resultado</span>
          <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#a78bfa" strokeWidth="2"/></svg>
          <span className="text-gray-600">Saldo</span>
        </div>
      </div>
            <div style={{ position: 'relative', height: '300px', width: '100%' }}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Chart type="bar" data={data} options={options as any} />
      </div>
    </div>
  )
}

// -- Grafico donut de categoria ---------------------------
function GraficoDonut({ titulo, subtitulo, total, dados }: {
  titulo: string; subtitulo: string; total: number
  dados: DespesaCategoria[]; corCentro: string
}) {
  const labels = dados.map(d => d.categoria_nome)
  const values = dados.map(d => d.total)
  const cores  = dados.map((_, i) => CORES_CATEGORIA[i % CORES_CATEGORIA.length])

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200 mb-0.5">{titulo}</p>
      <p className="text-[11px] text-gray-400 mb-3">{subtitulo} · total {formatBRL(total)}</p>
      <div style={{ position: 'relative', width: '100%', height: '250px', marginBottom: '1rem' }}>
        <Doughnut
          data={{ 
            labels, 
            datasets: [{ 
              data: values, 
              backgroundColor: cores, 
              borderWidth: 0, 
              hoverOffset: 4 
            }] 
          }}
          options={{ 
            responsive: true, 
            maintainAspectRatio: false,
            cutout: '68%', 
            plugins: { 
              legend: { display: false }, 
              tooltip: { 
                callbacks: { 
                  label: ctx => ` ${formatBRL(ctx.parsed)}` 
                } 
              } 
            } 
          }}
        />
      </div>
      <div className="space-y-1.5">
        {dados.map((d, i) => (
          <div key={d.categoria_id} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-[76px] text-gray-400 truncate">{d.categoria_nome}</span>
            <div className="flex-1 h-[3px] rounded-full bg-gray-100 dark:bg-gray-700">
              <div className="h-full rounded-full" style={{ width: `${total > 0 ? (d.total/total)*100 : 0}%`, background: cores[i] }}/>
            </div>
            <span className="w-[50px] text-right font-semibold text-gray-700 dark:text-gray-200">{formatBRL(d.total)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// -- Card de últimas alterações ------------------------------------
interface AlteracaoItem {
  id: string
  descricao: string
  valor: number
  tipo: string
  data: string
  status: string
  conta_id: string
  atualizado_em: string
}

function formatRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min  = Math.floor(diff / 60000)
  if (min < 1)  return 'agora'
  if (min < 60) return `${min}min atrás`
  const h = Math.floor(min / 60)
  if (h < 24)   return `${h}h atrás`
  const d = Math.floor(h / 24)
  if (d < 7)    return `${d}d atrás`
  return formatData(iso.split('T')[0])
}

function CardUltimasAlteracoes({ contas }: { contas: Conta[] }) {
  const [aberto,  setAberto]  = useState(false)
  const [items,   setItems]   = useState<AlteracaoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [stamp,   setStamp]   = useState(0)

  useEffect(() => {
    if (!aberto) return
    setLoading(true)
    supabase
      .schema('arqvalor')
      .from('transacoes')
      .select('id, descricao, valor, tipo, data, status, conta_id, atualizado_em')
      .order('atualizado_em', { ascending: false })
      .limit(50)
      .then(({ data }) => { setItems(data ?? []); setLoading(false) })
  }, [aberto, stamp])

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <button
        onClick={() => setAberto(o => !o)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <History size={14} className="text-blue-400"/>
          <span className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">Últimas alterações</span>
        </div>
        {aberto ? <ChevronDown size={14} className="text-gray-400"/> : <ChevronRight size={14} className="text-gray-400"/>}
      </button>

      {aberto && (
        <div className="mt-3">
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setStamp(Date.now())}
              className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex items-center gap-1"
            >
              <RefreshCw size={10}/> Atualizar
            </button>
          </div>
          {loading ? (
            <p className="text-[12px] text-gray-400 text-center py-4">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="text-[12px] text-gray-400 text-center py-4">Nenhuma alteração encontrada.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {items.map(item => {
                const conta = contas.find(c => c.conta_id === item.conta_id)
                const isRec = item.tipo === 'RECEITA'
                return (
                  <div key={item.id} className="flex items-start gap-2 py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${isRec ? 'bg-green-500' : 'bg-red-400'}`}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-gray-700 dark:text-gray-200 truncate">{item.descricao || '—'}</p>
                      <p className="text-[10px] text-gray-400 truncate">
                        {formatData(item.data)} · {conta?.nome ?? '—'} · {formatRelativo(item.atualizado_em)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-[12px] font-semibold ${isRec ? 'text-green-500' : 'text-red-400'}`}>
                        {formatBRL(item.valor)}
                      </p>
                      <p className="text-[9px] text-gray-400 uppercase">{item.status}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// -- Card de contas com saldo dinâmico ------------------------------
function CardContas({ contas, oculto, mes, modo, setModo }: {
  contas: Conta[];
  oculto: boolean;
  mes: string;
  historico: { mes: string; saldo_mes?: number }[];
  modo: 'hoje' | 'fim';
  setModo: (m: 'hoje' | 'fim') => void;
}) {
  const navigate = useNavigate()
  const mesAtualStr = new Date().toISOString().slice(0, 7)
  const isMesAtual = mes === mesAtualStr

  // Lógica de exibição para contas individuais
  const [saldosPorConta, setSaldosPorConta] = useState<Record<string, number>>({})

  useEffect(() => {
    const mesAtualStr2 = new Date().toISOString().slice(0, 7)
    const hoje = new Date().toISOString().split('T')[0]
    const [anoS, mS] = mes.split('-').map(Number)
    const ultimoDia = new Date(anoS, mS, 0).toISOString().split('T')[0]

    // Data correta conforme mês e modo
    let dataAlvo: string
    if (mes === mesAtualStr2) {
      dataAlvo = modo === 'hoje' ? hoje : ultimoDia
    } else {
      dataAlvo = ultimoDia
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      supabase.rpc('fn_saldos_contas_ate_data', { p_data: dataAlvo })
        .then(({ data, error }) => {
          console.log('[saldos RPC]', { dataAlvo, data, error })
          if (data) {
            const mapa: Record<string, number> = {}
            ;(data as { conta_id: string; saldo: number }[]).forEach(r => {
              mapa[r.conta_id] = r.saldo
            })
            setSaldosPorConta(mapa)
          }
        })
    })
  }, [mes, modo])

  const getSaldoConta = (conta: Conta) =>
    saldosPorConta[conta.conta_id] ?? conta.saldo_atual

  const gruposDash = [
    {
      label: 'Contas bancárias',
      cor: '#00c896',
      tipos: ['CORRENTE', 'REMUNERACAO'],
    },
    {
      label: 'Investimentos',
      cor: '#a78bfa',
      tipos: ['INVESTIMENTO'],
    },
    {
      label: 'Carteira',
      cor: '#f0b429',
      tipos: ['CARTEIRA'],
    },
    {
      label: 'Cartões de crédito',
      cor: '#f87171',
      tipos: ['CARTAO'],
    },
  ]

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200">Minhas contas</p>
        {isMesAtual && (
          <select
            value={modo} onChange={e => setModo(e.target.value as 'hoje' | 'fim')}
            className="text-[11px] bg-blue-400/10 border border-blue-400/30 rounded-md text-av-blue px-2 py-1 cursor-pointer"
          >
            <option value="hoje">Até hoje</option>
            <option value="fim">Até fim do mês</option>
          </select>
        )}
      </div>
      {gruposDash.map(grupo => {
        const contasGrupo = contas.filter(c => grupo.tipos.includes(c.tipo) && c.ativa)
        if (contasGrupo.length === 0) return null
        const totalGrupo = contasGrupo.reduce((s, c) => s + getSaldoConta(c), 0)
        return (
          <div key={grupo.label} className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{grupo.label}</span>
              <span className="text-[11px] font-bold" style={{ color: grupo.cor }}>{oculto ? OCULTO : formatBRL(totalGrupo)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {contasGrupo.map(conta => {
                const saldoConta = getSaldoConta(conta)
                return (
                  <div 
                    key={conta.conta_id} 
                    className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-3 flex items-center gap-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    onClick={() => navigate('/lancamentos', { state: { contaId: conta.conta_id, mes } })}
                  >
                    <IconeConta icone={conta.icone} cor={conta.cor} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-200 truncate">{conta.nome}</p>
                      <p className="text-[10px] text-gray-400">{conta.tipo}</p>
                    </div>
                    <p className="text-[12px] font-bold whitespace-nowrap"
                      style={{ color: saldoConta >= 0 ? '#00c896' : '#ff6b4a' }}>
                      {oculto ? OCULTO : formatBRL(saldoConta)}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// -- Dashboard Page ----------------------------------------
export default function DashboardPage() {
  const navigate = useNavigate()
  const { dashboard: pgState, setDashboard: setPgState } = usePageState()
  const mes          = pgState.mes
  const contasFiltro = pgState.contasFiltro
  const modo         = pgState.modo
  const setMes          = useCallback((v: string)         => setPgState({ mes: v }), [setPgState])
  const setContasFiltro = (v: string[])       => setPgState({ contasFiltro: v })
  const setModo         = (v: 'hoje' | 'fim') => setPgState({ modo: v })
  const [oculto, setOculto] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft')  { e.preventDefault(); setMes(navMesStr(mes, -1)) }
      if (e.key === 'ArrowRight') { e.preventDefault(); setMes(navMesStr(mes, 1))  }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mes, setMes])
  const [lancamentoEditando, setLancamentoEditando] = useState<Transacao | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setTimeout(() => setRefreshing(false), 600)
  }

  const abrirEdicao = (tx: Transacao) => {
    setLancamentoEditando(tx)
  }

  const { contas, pendentes, proximas, resumo, despesasCat, receitasCat, historico, pagos, pendentesStatus, projecoes, loading, error, refetch } = useDashboard(mes, contasFiltro)

  // Debug
  useEffect(() => {
    console.log('🔍 Estado do Dashboard:', {
      contas: contas.length,
      pendentes: pendentes.length,
      proximas: proximas.length,
      resumo,
      despesasCat: despesasCat.length,
      receitasCat: receitasCat.length,
      historico: historico.length,
      loading,
      error
    })
  }, [contas, pendentes, proximas, resumo, despesasCat, receitasCat, historico, loading, error])

  const totalPendentes = pendentes.reduce((s, t) => s + (t.tipo === 'DESPESA' ? -t.valor : t.valor), 0)
  const totalProximas  = proximas.reduce((s, t)  => s + (t.tipo === 'DESPESA' ? -t.valor : t.valor), 0)

  return (
    <div className="p-4 md:p-5 max-w-[1400px] mx-auto">
      {/* Topbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-[17px] font-bold text-gray-800 dark:text-gray-100">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro de contas */}
          <select
            value={contasFiltro[0] || ''}
            onChange={(e) => {
              const value = e.target.value
              setContasFiltro(value ? [value] : [])
            }}
            className="text-[13px] font-normal text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 cursor-pointer"
          >
            <option value="">Todas as contas</option>
            {contas.filter(c => c.ativa).map(conta => (
              <option key={conta.conta_id} value={conta.conta_id}>
                {conta.nome}
              </option>
            ))}
          </select>

          {/* Botao atualizar */}
          <button
            onClick={handleRefresh}
            title="Atualizar dados"
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''}/>
          </button>

          {/* Botao ocultar valores */}
          <button
            onClick={() => setOculto(o => !o)}
            title={oculto ? 'Mostrar valores' : 'Ocultar valores'}
            className="flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            {oculto ? <EyeOff size={14}/> : <Eye size={14}/>}
            {oculto ? 'Mostrar' : 'Ocultar'}
          </button>

          <MonthPicker value={mes} onChange={setMes} />

          <BotaoNovoLancamento
            onSelect={tipo => navigate('/lancamentos', { state: { novoLancamento: true, tipoInicial: tipo } })}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-[13px]">
          Carregando dados...
        </div>
      ) : (
        <div className="space-y-3">
          {/* Linha 1: resultados + saldo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <CardResultados resumo={resumo}/>
            <CardSaldo contas={contas} oculto={oculto} mes={mes} historico={historico} modo={modo} setModo={setModo}/>
          </div>

          {/* Linha 2: alertas + últimas alterações */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <CardAlertas
              titulo="Vencidos não pagos"
              cor="#ff6b4a"
              total={totalPendentes}
              itens={pendentes}
              contas={contas}
              onVerTodos={() => navigate('/lancamentos', { state: { filtroStatus: 'PENDENTE', mes } })}
              onEditar={abrirEdicao}
            />
            <CardAlertas
              titulo="Próximas contas não pagas"
              cor="#f0b429"
              total={totalProximas}
              itens={proximas}
              contas={contas}
              onVerTodos={() => navigate('/lancamentos', { state: { filtroStatus: 'PENDENTE', mes } })}
              onEditar={abrirEdicao}
              filtravel
              mes={mes}
            />
            <CardUltimasAlteracoes contas={contas} />
          </div>

          {/* Linha 3: grafico de barras */}
          <GraficoBarras 
              historico={historico} 
              oculto={oculto}
              pagos={pagos}
              pendentes={pendentesStatus}
              projecoes={projecoes}
            />

          {/* Linha 4: donuts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <GraficoDonut
              titulo="Despesas por categoria"
              subtitulo={mesLabel(mes)}
              total={resumo?.total_saidas ?? 0}
              dados={despesasCat}
              corCentro="#ff6b4a"
            />
            <GraficoDonut
              titulo="Receitas por categoria"
              subtitulo={mesLabel(mes)}
              total={resumo?.total_entradas ?? 0}
              dados={receitasCat}
              corCentro="#00c896"
            />
          </div>

          {/* Linha 5: contas */}
          <CardContas contas={contas} oculto={oculto} mes={mes} historico={historico} modo={modo} setModo={setModo}/>
        </div>
      )}
      {/* Drawer de edicao de lancamento */}
      {lancamentoEditando && (
        <DrawerLancamento
          lancamento={lancamentoEditando}
          todasParcelas={[...(pendentes || []), ...(proximas || [])] as Transacao[] as unknown as Lancamento[]}
          onFechar={() => setLancamentoEditando(null)}
          onSalvo={() => { setLancamentoEditando(null); refetch() }}
          onExcluido={() => { setLancamentoEditando(null); refetch() }}
        />
      )}
    </div>
  )
}