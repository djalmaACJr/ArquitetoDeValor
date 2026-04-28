// src/components/ui/MonthPicker.tsx
// Componente de seleção de mês/ano com navegação por botões e grid de meses.
// Uso: <MonthPicker value="2026-04" onChange={setMes} />

import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { mesLabel } from '../../lib/utils'

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                     'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

interface MonthPickerProps {
  value: string                   // formato "YYYY-MM"
  onChange: (ym: string) => void
  /** Menor mês permitido (formato "YYYY-MM"). Padrão: sem limite. */
  min?: string
  /** Maior mês permitido (formato "YYYY-MM"). Padrão: sem limite. */
  max?: string
  className?: string
}

export function MonthPicker({ value, onChange, min, max, className = '' }: MonthPickerProps) {
  const [open, setOpen]       = useState(false)
  const [anoGrid, setAnoGrid] = useState(() => parseInt(value.split('-')[0]))
  const ref                   = useRef<HTMLDivElement>(null)

  const anoAtual = parseInt(value.split('-')[0])
  const mesAtual = parseInt(value.split('-')[1])

  const hoje     = new Date()
  const anoHoje  = hoje.getFullYear()
  const mesHoje  = hoje.getMonth() + 1
  const ymHoje   = `${anoHoje}-${String(mesHoje).padStart(2, '0')}`
  const estaHoje = value === ymHoje

  function irParaHoje() {
    if (!estaHoje) { onChange(ymHoje); setOpen(false) }
  }

  function isHoje(mesIdx: number) {
    return anoGrid === anoHoje && mesIdx + 1 === mesHoje
  }

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  useEffect(() => {
    setAnoGrid(parseInt(value.split('-')[0]))
  }, [value])

  function navMes(delta: number) {
    const [y, m] = value.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const novo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (min && novo < min) return
    if (max && novo > max) return
    onChange(novo)
  }

  function selecionarMes(mesIdx: number) {
    const novo = `${anoGrid}-${String(mesIdx + 1).padStart(2, '0')}`
    if (min && novo < min) return
    if (max && novo > max) return
    onChange(novo)
    setOpen(false)
  }

  function isSelecionado(mesIdx: number) {
    return anoGrid === anoAtual && mesIdx + 1 === mesAtual
  }

  function isDesabilitado(mesIdx: number) {
    const ym = `${anoGrid}-${String(mesIdx + 1).padStart(2, '0')}`
    if (min && ym < min) return true
    if (max && ym > max) return true
    return false
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* ── Controle principal ── */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => navMes(-1)}
          disabled={!!(min && value <= min)}
          className="p-1.5 rounded-md bg-blue-400/10 border border-blue-400/20 text-blue-300
                     hover:bg-blue-400/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={14} />
        </button>

        {/* Usa mesLabel('longo') da utils — formato "Abril/2026" */}
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md min-w-[148px] justify-center
                     bg-blue-400/10 border border-blue-400/20 text-blue-300 text-[13px] font-semibold
                     hover:bg-blue-400/20 transition-colors"
        >
          <Calendar size={13} className="opacity-70" />
          {mesLabel(value, 'longo')}
        </button>

        <button
          onClick={() => navMes(1)}
          disabled={!!(max && value >= max)}
          className="p-1.5 rounded-md bg-blue-400/10 border border-blue-400/20 text-blue-300
                     hover:bg-blue-400/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* ── Dropdown grid ── */}
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 rounded-xl border border-blue-400/20
                        bg-[#1a1f2e] shadow-2xl p-3 w-[220px]">
          {/* Navegação de ano */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setAnoGrid(a => a - 1)}
              className="p-1 rounded-md hover:bg-blue-400/15 text-blue-300 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[13px] font-bold text-white">{anoGrid}</span>
            <button
              onClick={() => setAnoGrid(a => a + 1)}
              className="p-1 rounded-md hover:bg-blue-400/15 text-blue-300 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Grid 4×3 de meses */}
          <div className="grid grid-cols-4 gap-1">
            {MESES_ABREV.map((abrev, idx) => {
              const selecionado  = isSelecionado(idx)
              const desabilitado = isDesabilitado(idx)
              const ehHoje       = isHoje(idx)
              return (
                <button
                  key={abrev}
                  onClick={() => !desabilitado && selecionarMes(idx)}
                  disabled={desabilitado}
                  className={`
                    py-1.5 rounded-lg text-[12px] font-medium transition-colors
                    ${selecionado
                      ? 'bg-blue-500 text-white'
                      : desabilitado
                        ? 'text-white/20 cursor-not-allowed'
                        : ehHoje
                          ? 'text-blue-200 hover:bg-blue-400/20 ring-1 ring-blue-400/60'
                          : 'text-blue-200 hover:bg-blue-400/20'}
                  `}
                >
                  {abrev}
                </button>
              )
            })}
          </div>

          {/* Atalho mês atual */}
          <div className="mt-2 pt-2 border-t border-white/10">
            <button
              onClick={irParaHoje}
              className="w-full py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
              style={estaHoje
                ? { background: 'rgba(0,200,150,0.12)', color: '#00c896', cursor: 'default' }
                : { background: 'rgba(96,165,250,0.1)', color: '#93c5fd' }
              }
            >
              {estaHoje ? '• Mês atual' : '→ Ir para mês atual'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
