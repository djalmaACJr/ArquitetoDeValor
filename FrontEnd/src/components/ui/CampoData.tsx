// src/components/ui/CampoData.tsx
// Campo de data com calendário próprio (grid dia a dia), substituindo o
// popup nativo do <input type="date"> — necessário porque não dá pra
// injetar um botão "Hoje" dentro do calendário nativo do navegador.
// Uso: <CampoData value="2026-08-25" onChange={setData} />
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { hojeLocal } from '../../lib/utils'

const DIAS_ABR    = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.']
const MESES_LONGO = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

interface Props {
  value: string                 // "YYYY-MM-DD" (ou "" vazio)
  onChange: (v: string) => void
  className?: string
  id?: string
}

/** Handle imperativo — `.focus()` foca o campo e já abre o calendário
 *  (substitui o `el.focus() + el.showPicker()` usado com o input nativo). */
export interface CampoDataHandle {
  focus: () => void
}

export const CampoData = forwardRef<CampoDataHandle, Props>(function CampoData(
  { value, onChange, className = '', id }, refHandle,
) {
  const [open, setOpen] = useState(false)
  const ref              = useRef<HTMLDivElement>(null)
  const btnRef            = useRef<HTMLButtonElement>(null)

  useImperativeHandle(refHandle, () => ({
    focus: () => { btnRef.current?.focus(); setOpen(true) },
  }))
  const hoje                        = hojeLocal()
  const [anoHoje, mesHoje, diaHoje] = hoje.split('-').map(Number)

  const valido = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const [vAno, vMes, vDia] = valido ? value.split('-').map(Number) : [anoHoje, mesHoje, null]

  // Mês/ano exibidos na grade — parte do valor atual (ou de hoje, sem valor).
  // Ajustada durante a renderização (padrão React p/ "resetar estado quando
  // uma prop muda"), não em efeito — evita o cascading render de um
  // setState síncrono dentro de useEffect.
  const [gridAno, setGridAno] = useState(vAno)
  const [gridMes, setGridMes] = useState(vMes) // 1-12
  const [valorAnterior, setValorAnterior] = useState(value)
  if (value !== valorAnterior) {
    setValorAnterior(value)
    if (valido) { setGridAno(vAno); setGridMes(vMes) }
  }

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function navMes(delta: number) {
    let m = gridMes + delta
    let y = gridAno
    if (m < 1)  { m = 12; y-- }
    if (m > 12) { m = 1;  y++ }
    setGridMes(m)
    setGridAno(y)
  }

  function selecionar(d: number) {
    onChange(`${gridAno}-${String(gridMes).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    setOpen(false)
  }

  function irParaHoje() {
    setGridAno(anoHoje)
    setGridMes(mesHoje)
    onChange(hoje)
    setOpen(false)
  }

  const totalDias    = new Date(gridAno, gridMes, 0).getDate()
  const primeiroDow  = new Date(gridAno, gridMes - 1, 1).getDay()
  const celulas: (number | null)[] = [
    ...Array.from({ length: primeiroDow }, () => null),
    ...Array.from({ length: totalDias },  (_, i) => i + 1),
  ]

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      onKeyDown={e => {
        // O Drawer que contém este campo também escuta Escape no document
        // pra se fechar. Bloqueia o evento nativo pra Escape fechar só o
        // calendário enquanto ele estiver aberto (mesmo padrão do dropdown
        // de sugestões da Descrição, acima).
        if (e.key === 'Escape' && open) {
          e.nativeEvent.stopImmediatePropagation()
          setOpen(false)
        }
      }}
    >
      {/* ── Campo ── */}
      <button
        ref={btnRef}
        type="button"
        id={id}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 bg-[#252d42] border border-white/10 rounded-lg px-3 py-2
                   text-[17px] text-left outline-none focus:border-av-green transition-colors"
      >
        <Calendar size={16} style={{ color: '#00c896' }} className="flex-shrink-0" />
        {valido ? (
          <span style={{ color: '#e8eaf0' }}>
            {String(vDia).padStart(2, '0')}/{String(vMes).padStart(2, '0')}/{vAno}
          </span>
        ) : (
          <span style={{ color: 'rgba(232,234,240,0.35)' }}>dd/mm/aaaa</span>
        )}
      </button>

      {/* ── Dropdown do calendário ── */}
      {open && (
        <div
          className="absolute z-50 mt-2 left-0 rounded-xl border border-white/10 shadow-2xl p-3 w-[280px]"
          style={{ background: '#1a1f2e' }}
        >
          {/* Botão "Hoje" — sempre visível no topo do calendário */}
          <button
            type="button"
            onClick={irParaHoje}
            className="w-full mb-3 py-1.5 rounded-lg text-[15px] font-semibold transition-colors hover:opacity-80"
            style={{ background: 'rgba(0,200,150,0.12)', color: '#00c896', border: '1px solid rgba(0,200,150,0.3)' }}
          >
            Hoje — {String(diaHoje).padStart(2, '0')}/{String(mesHoje).padStart(2, '0')}/{anoHoje}
          </button>

          {/* Navegação de mês */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => navMes(-1)}
              className="p-1 rounded-md hover:bg-white/10 text-white/60 transition-colors"
              aria-label="Mês anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-[15px] font-medium" style={{ color: '#e8eaf0' }}>
              {MESES_LONGO[gridMes - 1]} de {gridAno}
            </span>
            <button
              type="button"
              onClick={() => navMes(1)}
              className="p-1 rounded-md hover:bg-white/10 text-white/60 transition-colors"
              aria-label="Próximo mês"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Cabeçalho dias da semana */}
          <div className="grid grid-cols-7 mb-1">
            {DIAS_ABR.map((d, i) => (
              <div
                key={d}
                className="text-center text-[12px] font-medium"
                style={{ color: i === 0 || i === 6 ? 'rgba(248,113,113,0.7)' : '#6b7280' }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Grade de dias */}
          <div className="grid grid-cols-7 gap-0.5">
            {celulas.map((d, idx) => {
              if (!d) return <div key={`b${idx}`} />
              const dow         = new Date(gridAno, gridMes - 1, d).getDay()
              const fimSemana   = dow === 0 || dow === 6
              const selecionado = valido && d === vDia && gridMes === vMes && gridAno === vAno
              const ehHoje      = gridAno === anoHoje && gridMes === mesHoje && d === diaHoje

              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => selecionar(d)}
                  className="h-8 rounded-md text-[15px] font-medium transition-colors hover:bg-white/10"
                  style={{
                    color: selecionado
                      ? '#00c896'
                      : fimSemana ? 'rgba(248,113,113,0.75)' : '#e8eaf0',
                    background: selecionado ? 'rgba(0,200,150,0.12)' : 'transparent',
                    border: selecionado
                      ? '1px solid #00c896'
                      : ehHoje ? '1px solid rgba(232,234,240,0.25)' : '1px solid transparent',
                  }}
                >
                  {d}
                </button>
              )
            })}
          </div>

          {/* Limpar */}
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false) }}
            className="mt-3 px-3 py-1.5 rounded-lg text-[14px] font-medium transition-colors hover:bg-white/10"
            style={{ color: '#8b92a8', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Limpar
          </button>
        </div>
      )}
    </div>
  )
})
