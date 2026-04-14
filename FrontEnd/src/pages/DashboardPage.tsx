// src/pages/DashboardPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react'
import { useDashboard } from '../hooks/useDashboard'
import { mesAtual, mesLabel, formatBRL, formatData, GRUPOS_CONTA, CORES_CATEGORIA } from '../lib/utils'
import { MonthPicker } from '../components/ui/MonthPicker'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
} from 'chart.js'
import type { Conta, Transacao, DespesaCategoria } from '../types'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// ── Ícone de conta inline (sem dependência externa) ──────
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

const OCULTO = '••••••'

// ── Card de resultado do mês ─────────────────────────────
function CardResultados({
  resumo, oculto,
}: {
  resumo: { total_entradas: number; total_saidas: number } | null
  oculto: boolean
}) {
  const resultado = (resumo?.total_entradas ?? 0) - (resumo?.total_saidas ?? 0)
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-av-green"/>
        <span className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">Resultados do mês</span>
      </div>
      <div className="grid grid-cols-3 gap-0 divide-x divide-gray-200 dark:divide-gray-700">
        {[
          { label: 'Entradas',  value: resumo?.total_entradas ?? 0, cor: 'text-av-green' },
          { label: 'Saídas',    value: resumo?.total_saidas   ?? 0, cor: 'text-red-400'  },
          { label: 'Resultado', value: resultado,                    cor: resultado >= 0 ? 'text-av-green' : 'text-red-400' },
        ].map(({ label, value, cor }) => (
          <div key={label} className="px-3 first:pl-0 last:pr-0">
            <p className="text-[11px] text-gray-400 mb-1">{label}</p>
            <p className={`text-[16px] font-bold ${cor}`}>
              {oculto ? OCULTO : formatBRL(value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Card de saldo acumulado ──────────────────────────────
function CardSaldo({ contas, oculto }: { contas: Conta[]; oculto: boolean }) {
  const [modo, setModo] = useState<'hoje' | 'fim'>('hoje')
  const total     = contas.reduce((s, c) => s + c.saldo_atual, 0)
  const projetado = total * 1.15

  const progressoMes = (() => {
    const hoje      = new Date()
    const diaAtual  = hoje.getDate()
    const totalDias = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
    return Math.round((diaAtual / totalDias) * 100)
  })()

  return (
    <div className="bg-av-dark rounded-xl p-4 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.07]" style={{
        backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px)'
      }}/>
      <div className="relative flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-white/50">Saldo acumulado</span>
        <select
          value={modo} onChange={e => setModo(e.target.value as 'hoje' | 'fim')}
          className="text-[11px] bg-blue-400/10 border border-blue-400/30 rounded-md text-av-blue px-2 py-1 cursor-pointer"
        >
          <option value="hoje">Até hoje</option>
          <option value="fim">Projetado fim do mês</option>
        </select>
      </div>
      <p className="relative text-[28px] font-bold text-av-green leading-none">
        {oculto ? OCULTO : formatBRL(modo === 'hoje' ? total : projetado)}
      </p>
      <p className="relative text-[11px] text-white/35 mt-1.5">
        {oculto ? '—' : (modo === 'hoje'
          ? `Posição em ${formatData(new Date().toISOString().split('T')[0])}`
          : 'Estimativa até fim do mês')}
      </p>
      <div className="relative mt-3 h-[3px] rounded-full bg-blue-400/15">
        <div className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-av-green to-av-amber"
          style={{ width: oculto ? '0%' : (modo === 'fim' ? '100%' : `${progressoMes}%`) }}/>
      </div>
    </div>
  )
}

// ── Grupo de conta dentro do card de alertas ─────────────
function GrupoConta({
  nomeConta, icone, cor, total, itens, corTotal,
}: {
  nomeConta: string; icone: string | null; cor: string | null
  total: number; itens: Transacao[]; corTotal: string
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      {/* Cabeçalho do grupo — clicável */}
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

      {/* Lançamentos expandidos */}
      {aberto && (
        <div className="bg-gray-50/50 dark:bg-gray-700/30">
          <div className="grid grid-cols-[1fr_56px_72px] px-6 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-700">
            <span>Transação</span><span className="text-center">Data</span><span className="text-right">Valor</span>
          </div>
          {itens.map(tx => (
            <div
              key={tx.id}
              className="grid grid-cols-[1fr_56px_72px] items-center px-6 py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0"
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

// ── Card de alertas agrupado por conta ───────────────────
function CardAlertas({
  titulo, cor, total, itens, contas, onVerTodos,
}: {
  titulo: string; cor: string; total: number
  itens: Transacao[]; contas: Conta[]; onVerTodos: () => void
}) {
  // Agrupar itens por conta_id
  const porConta = itens.reduce<Record<string, Transacao[]>>((acc, tx) => {
    if (!acc[tx.conta_id]) acc[tx.conta_id] = []
    acc[tx.conta_id].push(tx)
    return acc
  }, {})

  const contaMap = Object.fromEntries(contas.map(c => [c.conta_id, c]))

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Cabeçalho do card */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: cor }}/>
          <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">{titulo}</span>
        </div>
        <span className="text-[12px] font-bold" style={{ color: cor }}>{formatBRL(Math.abs(total))}</span>
      </div>

      {/* Grupos por conta */}
      <div className="max-h-[240px] overflow-y-auto">
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
            />
          )
        })}
      </div>

      <button
        onClick={onVerTodos}
        className="w-full text-[11px] text-av-blue py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-t border-gray-100 dark:border-gray-700"
      >
        Ver todos os lançamentos
      </button>
    </div>
  )
}

// ── Gráfico de barras ────────────────────────────────────
function GraficoBarras({ historico }: { historico: { mes: string; total_entradas: number; total_saidas: number }[] }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200 mb-0.5">Evolução mensal</p>
      <p className="text-[11px] text-gray-400 mb-3">Entradas e saídas — últimos 6 meses</p>
      <div className="flex gap-3 mb-2">
        {[['#00c896','Entradas'],['#ff6b4a','Saídas']].map(([cor,label]) => (
          <div key={label} className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span className="w-2 h-2 rounded-sm" style={{ background: cor }}/>{label}
          </div>
        ))}
      </div>
      <div style={{ position: 'relative', height: '300px', width: '100%' }}>
        <Bar
          data={{
            labels: historico.map(h => mesLabel(h.mes)),
            datasets: [
              { label: 'Entradas', data: historico.map(h => h.total_entradas), backgroundColor: '#00c896', borderRadius: 4 },
              { label: 'Saídas',   data: historico.map(h => h.total_saidas),   backgroundColor: '#ff6b4a', borderRadius: 4 },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
              legend: { display: false },
              filler: { propagate: true }
            },
            scales: {
              x: { 
                ticks: { color: '#9ca3af', font: { size: 10 } }, 
                grid: { display: false }, 
                border: { display: false } 
              },
              y: { 
                ticks: { 
                  color: '#9ca3af', 
                  font: { size: 10 }, 
                  callback: v => `R$${(Number(v)/1000).toFixed(0)}k` 
                }, 
                grid: { color: 'rgba(128,128,128,0.1)' }, 
                border: { display: false } 
              },
            },
          }}
        />
      </div>
    </div>
  )
}

// ── Gráfico donut de categoria ───────────────────────────
function GraficoDonut({ titulo, subtitulo, total, dados, corCentro }: {
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

// ── Contas agrupadas ─────────────────────────────────────
function SecaoContas({ contas }: { contas: Conta[] }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200 mb-3">Minhas contas</p>
      {GRUPOS_CONTA.map(grupo => {
        const contasGrupo = contas.filter(c => grupo.tipos.includes(c.tipo) && c.ativa)
        if (contasGrupo.length === 0) return null
        const totalGrupo = contasGrupo.reduce((s, c) => s + c.saldo_atual, 0)
        return (
          <div key={grupo.label} className="mb-4 last:mb-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{grupo.label}</span>
              <span className="text-[12px] font-bold" style={{ color: grupo.cor }}>{formatBRL(totalGrupo)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {contasGrupo.map(conta => (
                <div key={conta.conta_id} className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-3 flex items-center gap-2">
                  <IconeConta icone={conta.icone} cor={conta.cor} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-200 truncate">{conta.nome}</p>
                    <p className="text-[10px] text-gray-400">{conta.tipo}</p>
                  </div>
                  <p className="text-[12px] font-bold whitespace-nowrap"
                    style={{ color: conta.saldo_atual >= 0 ? '#00c896' : '#ff6b4a' }}>
                    {formatBRL(conta.saldo_atual)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Dashboard Page ────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate()
  const [mes, setMes]       = useState(mesAtual())
  const [oculto, setOculto] = useState(false)

  const { contas, pendentes, proximas, resumo, despesasCat, receitasCat, historico, loading, error } = useDashboard(mes)

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
    <div className="p-5 max-w-[1400px]">
      {/* Topbar */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[17px] font-bold text-gray-800 dark:text-gray-100">Dashboard</h1>
        <div className="flex items-center gap-2">
          {/* Botão ocultar valores */}
          <button
            onClick={() => setOculto(o => !o)}
            title={oculto ? 'Mostrar valores' : 'Ocultar valores'}
            className="flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            {oculto ? <EyeOff size={14}/> : <Eye size={14}/>}
            {oculto ? 'Mostrar' : 'Ocultar'}
          </button>

          <MonthPicker value={mes} onChange={setMes} />

          <button
            onClick={() => navigate('/lancamentos?novo=1')}
            className="flex items-center gap-1.5 bg-av-green text-av-dark text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-av-green/90 transition-colors"
          >
            <Plus size={14}/> Novo lançamento
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-[13px]">
          Carregando dados...
        </div>
      ) : (
        <div className="space-y-3">
          {/* Linha 1: resultados + saldo */}
          <div className="grid grid-cols-2 gap-3">
            <CardResultados resumo={resumo} oculto={oculto}/>
            <CardSaldo contas={contas} oculto={oculto}/>
          </div>

          {/* Linha 2: alertas agrupados por conta */}
          <div className="grid grid-cols-2 gap-3">
            <CardAlertas
              titulo="Vencidos não pagos"
              cor="#ff6b4a"
              total={totalPendentes}
              itens={pendentes}
              contas={contas}
              onVerTodos={() => navigate('/lancamentos?status=PENDENTE')}
            />
            <CardAlertas
              titulo="Próximas contas não pagas"
              cor="#f0b429"
              total={totalProximas}
              itens={proximas}
              contas={contas}
              onVerTodos={() => navigate('/lancamentos?status=PENDENTE')}
            />
          </div>

          {/* Linha 3: gráfico de barras */}
          <GraficoBarras historico={historico}/>

          {/* Linha 4: donuts */}
          <div className="grid grid-cols-2 gap-3">
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
          <SecaoContas contas={contas}/>
        </div>
      )}
    </div>
  )
}