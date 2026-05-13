import { useState } from 'react'
import { Bell, CreditCard, Check, Trash2, Pencil, X, Plus, AlertTriangle, Flag, List } from 'lucide-react'
import type { Lembrete, Conta } from '../../types'

const DOW_ABR = ['D','S','T','Q','Q','S','S']
const MESES_NOME = [
  'Jan','Fev','Mar','Abr','Mai','Jun',
  'Jul','Ago','Set','Out','Nov','Dez',
]

export interface UltimaParcela {
  descricao: string
  valor:     number
  tipo:      string
}

interface Props {
  mes:             string
  lembretes:       Lembrete[]
  contas:          Conta[]
  /** Map data (YYYY-MM-DD) → lista de contas com saldo negativo nesse dia. */
  diasNegativos?:  Map<string, { nome: string; saldo: number }[]>
  /** Map data (YYYY-MM-DD) → lista de transações recorrentes com última parcela PROJEÇÃO nesse dia. */
  ultimasParcelas?: Map<string, UltimaParcela[]>
  onEditar:        (l: Lembrete) => void
  onExcluir:       (id: string) => void
  onToggle:        (id: string, status: 'PENDENTE' | 'CONCLUIDO') => void
  onNovoNoDia?:    (data: string) => void
  onAbrirTodosLembretes?: () => void
}

export default function CalendarioDashboard({
  mes, lembretes, contas, diasNegativos, ultimasParcelas,
  onEditar, onExcluir, onToggle, onNovoNoDia, onAbrirTodosLembretes,
}: Props) {
  const [diaAberto, setDiaAberto] = useState<string | null>(null)

  const [ano, m] = mes.split('-').map(Number)
  const totalDias   = new Date(ano, m, 0).getDate()
  const primeiroDow = new Date(ano, m - 1, 1).getDay()
  const hoje        = new Date().toISOString().split('T')[0]

  const lembretesPorDia = new Map<string, Lembrete[]>()
  for (const l of lembretes) {
    const lista = lembretesPorDia.get(l.data) ?? []
    lista.push(l)
    lembretesPorDia.set(l.data, lista)
  }

  const cartoes = contas.filter(c => c.tipo === 'CARTAO' && c.ativa)

  function eventosDia(dia: number) {
    const evs: { tipo: 'fechamento' | 'pagamento'; conta: Conta }[] = []
    for (const c of cartoes) {
      if (c.dia_fechamento === dia) evs.push({ tipo: 'fechamento', conta: c })
      if (c.dia_pagamento  === dia) evs.push({ tipo: 'pagamento',  conta: c })
    }
    return evs
  }

  const celulas: (number | null)[] = [
    ...Array.from({ length: primeiroDow }, () => null),
    ...Array.from({ length: totalDias },  (_, i) => i + 1),
  ]

  function dataStr(dia: number) {
    return `${ano}-${String(m).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
  }

  const lembrsDiaAberto    = diaAberto ? (lembretesPorDia.get(diaAberto) ?? []) : []
  const evsDiaAberto       = diaAberto ? eventosDia(parseInt(diaAberto.split('-')[2])) : []
  const temUltimasParcelas = (ultimasParcelas?.size ?? 0) > 0

  return (
    <div
      className="rounded-xl border border-white/8 p-3 flex flex-col"
      style={{ background: '#141929', width: 252 }}
    >
      {/* Cabeçalho compacto */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold" style={{ color: '#e8eaf0' }}>
          {MESES_NOME[m - 1]} {ano}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#f0b429' }} title="Lembrete" />
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#4da6ff' }} title="Fechamento" />
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#f87171' }} title="Pagamento" />
          {diasNegativos && diasNegativos.size > 0 && (
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#fb923c' }} title="Saldo negativo em alguma conta" />
          )}
          {temUltimasParcelas && (
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#c084fc' }} title="Última parcela (projeção)" />
          )}
          {onAbrirTodosLembretes && (
            <button
              onClick={onAbrirTodosLembretes}
              className="w-5 h-5 flex items-center justify-center rounded transition-all hover:opacity-80 ml-0.5"
              title="Todos os lembretes"
              style={{ background: 'rgba(240,180,41,0.1)', border: '1px solid rgba(240,180,41,0.2)' }}
            >
              <List size={10} style={{ color: '#f0b429' }} />
            </button>
          )}
        </div>
      </div>

      {/* Cabeçalho dias da semana */}
      <div className="grid grid-cols-7 mb-0.5">
        {DOW_ABR.map((d, i) => (
          <div key={i}
            className="text-center text-[9px] font-semibold py-0.5"
            style={{ color: i === 0 || i === 6 ? 'rgba(248,113,113,0.6)' : '#4a5168' }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Grade */}
      <div className="grid grid-cols-7" style={{ gap: 1 }}>
        {celulas.map((dia, idx) => {
          if (!dia) return <div key={`b${idx}`} style={{ height: 28 }} />

          const ds              = dataStr(dia)
          const ehHoje          = ds === hoje
          const dow             = new Date(`${ds}T12:00:00`).getDay()
          const fimSem          = dow === 0 || dow === 6
          const lembs           = lembretesPorDia.get(ds) ?? []
          const evs             = eventosDia(dia)
          const aberto          = diaAberto === ds
          const negativo        = (diasNegativos?.get(ds)?.length ?? 0) > 0
          const ultimaParc      = (ultimasParcelas?.get(ds)?.length ?? 0) > 0
          const temEv           = lembs.length > 0 || evs.length > 0 || negativo || ultimaParc
          const concl           = lembs.length > 0 && lembs.every(l => l.status === 'CONCLUIDO')

          return (
            <button
              key={ds}
              onClick={() => setDiaAberto(aberto ? null : ds)}
              className="flex flex-col items-center justify-center rounded transition-all"
              style={{
                height: 28,
                background: aberto
                  ? 'rgba(240,180,41,0.15)'
                  : ultimaParc && !ehHoje
                  ? 'rgba(192,132,252,0.08)'
                  : negativo && !ehHoje
                  ? 'rgba(251,146,60,0.08)'
                  : 'transparent',
                border: aberto
                  ? '1px solid rgba(240,180,41,0.35)'
                  : ultimaParc && !ehHoje
                  ? '1px solid rgba(192,132,252,0.3)'
                  : negativo && !ehHoje
                  ? '1px solid rgba(251,146,60,0.3)'
                  : '1px solid transparent',
              }}
            >
              {ehHoje ? (
                <span
                  style={{
                    fontSize: 10,
                    lineHeight: 1,
                    fontWeight: 700,
                    color: '#0a0f1a',
                    background: '#00c896',
                    borderRadius: '50%',
                    width: 18,
                    height: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {dia}
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 10,
                    lineHeight: 1,
                    fontWeight: temEv ? 600 : 400,
                    color: fimSem
                      ? 'rgba(248,113,113,0.7)'
                      : temEv ? '#e8eaf0' : '#4a5168',
                    opacity: concl ? 0.4 : 1,
                  }}
                >
                  {dia}
                </span>
              )}

              {/* Dots indicadores */}
              {temEv && (
                <div className="flex gap-px mt-0.5">
                  {lembs.length > 0 && (
                    <span className="w-1 h-1 rounded-full"
                      style={{ background: concl ? '#4a5168' : '#f0b429' }} />
                  )}
                  {evs.some(e => e.tipo === 'fechamento') && (
                    <span className="w-1 h-1 rounded-full" style={{ background: '#4da6ff' }} />
                  )}
                  {evs.some(e => e.tipo === 'pagamento') && (
                    <span className="w-1 h-1 rounded-full" style={{ background: '#f87171' }} />
                  )}
                  {negativo && (
                    <span className="w-1 h-1 rounded-full" style={{ background: '#fb923c' }} />
                  )}
                  {ultimaParc && (
                    <span className="w-1 h-1 rounded-full" style={{ background: '#c084fc' }} />
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Painel de detalhes */}
      {diaAberto && (
        <div className="mt-2 rounded-lg border border-white/10 p-2 space-y-1.5"
          style={{ background: '#1a1f2e' }}>

          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold" style={{ color: '#e8eaf0' }}>
              {new Date(`${diaAberto}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
            </span>
            <div className="flex items-center gap-1">
              {onNovoNoDia && (
                <button
                  onClick={() => { onNovoNoDia(diaAberto); setDiaAberto(null) }}
                  className="w-4 h-4 flex items-center justify-center rounded transition-all hover:opacity-80"
                  title="Novo lembrete"
                  style={{ background: 'rgba(240,180,41,0.15)', border: '1px solid rgba(240,180,41,0.3)' }}
                >
                  <Plus size={8} style={{ color: '#f0b429' }} />
                </button>
              )}
              <button onClick={() => setDiaAberto(null)}
                className="w-4 h-4 flex items-center justify-center rounded"
                style={{ color: '#8b92a8' }}>
                <X size={10} />
              </button>
            </div>
          </div>

          {/* Lembretes */}
          {lembrsDiaAberto.map(l => (
            <div key={l.id}
              className="flex items-center gap-1.5 py-1 px-1.5 rounded"
              style={{ background: 'rgba(240,180,41,0.06)', border: '1px solid rgba(240,180,41,0.1)' }}>
              <Bell size={9} style={{ color: '#f0b429', flexShrink: 0 }} />
              <span
                className="flex-1 text-[10px] truncate"
                style={{
                  color: l.status === 'CONCLUIDO' ? '#4a5168' : '#e8eaf0',
                  textDecoration: l.status === 'CONCLUIDO' ? 'line-through' : 'none',
                }}
              >
                {l.descricao}
              </span>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => onToggle(l.id, l.status === 'CONCLUIDO' ? 'PENDENTE' : 'CONCLUIDO')}
                  className="w-4 h-4 flex items-center justify-center rounded"
                  title={l.status === 'CONCLUIDO' ? 'Pendente' : 'Concluído'}
                  style={{
                    background: l.status === 'CONCLUIDO' ? 'rgba(0,200,150,0.15)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${l.status === 'CONCLUIDO' ? 'rgba(0,200,150,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  }}
                >
                  <Check size={8} style={{ color: l.status === 'CONCLUIDO' ? '#00c896' : '#4a5168' }} />
                </button>
                <button
                  onClick={() => onEditar(l)}
                  className="w-4 h-4 flex items-center justify-center rounded"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <Pencil size={8} style={{ color: '#8b92a8' }} />
                </button>
                <button
                  onClick={() => onExcluir(l.id)}
                  className="w-4 h-4 flex items-center justify-center rounded"
                  style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.15)' }}
                >
                  <Trash2 size={8} style={{ color: '#f87171' }} />
                </button>
              </div>
            </div>
          ))}

          {/* Eventos de cartão */}
          {evsDiaAberto.map((ev, i) => (
            <div key={i}
              className="flex items-center gap-1.5 py-1 px-1.5 rounded"
              style={{
                background: ev.tipo === 'fechamento' ? 'rgba(77,166,255,0.06)' : 'rgba(248,113,113,0.06)',
                border:     ev.tipo === 'fechamento' ? '1px solid rgba(77,166,255,0.12)' : '1px solid rgba(248,113,113,0.12)',
              }}>
              <CreditCard size={9} style={{ color: ev.tipo === 'fechamento' ? '#4da6ff' : '#f87171', flexShrink: 0 }} />
              <span className="text-[10px] truncate" style={{ color: '#e8eaf0' }}>
                {ev.tipo === 'fechamento' ? 'Fech.' : 'Pgto.'} {ev.conta.nome}
              </span>
            </div>
          ))}

          {/* Alerta saldo negativo */}
          {diaAberto && (diasNegativos?.get(diaAberto) ?? []).map((info, i) => (
            <div key={`neg-${i}`}
              className="flex items-center gap-1.5 py-1 px-1.5 rounded"
              style={{ background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)' }}>
              <AlertTriangle size={9} style={{ color: '#fb923c', flexShrink: 0 }} />
              <span className="flex-1 text-[10px] truncate" style={{ color: '#fb923c' }}>
                {info.nome}: {info.saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>
          ))}

          {/* Últimas parcelas PROJEÇÃO */}
          {diaAberto && (ultimasParcelas?.get(diaAberto) ?? []).map((up, i) => (
            <div key={`up-${i}`}
              className="flex items-center gap-1.5 py-1 px-1.5 rounded"
              style={{ background: 'rgba(192,132,252,0.08)', border: '1px solid rgba(192,132,252,0.2)' }}>
              <Flag size={9} style={{ color: '#c084fc', flexShrink: 0 }} />
              <span className="flex-1 text-[10px] truncate" style={{ color: '#c084fc' }}>
                Últ. parcela: {up.descricao}
              </span>
              <span
                className="text-[9px] font-semibold flex-shrink-0"
                style={{ color: up.tipo === 'RECEITA' ? '#00c896' : '#f87171' }}
              >
                {up.tipo === 'RECEITA' ? '+' : '-'}
                {up.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>
          ))}

          {lembrsDiaAberto.length === 0 && evsDiaAberto.length === 0
            && (diasNegativos?.get(diaAberto ?? '')?.length ?? 0) === 0
            && (ultimasParcelas?.get(diaAberto ?? '')?.length ?? 0) === 0 && (
            <span className="text-[10px]" style={{ color: '#4a5168' }}>Sem eventos neste dia.</span>
          )}
        </div>
      )}
    </div>
  )
}
