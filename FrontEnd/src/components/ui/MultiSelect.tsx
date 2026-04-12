// src/components/ui/MultiSelect.tsx
// Dropdown multi-seleção reutilizável — mesma identidade visual do projeto
import { useState, useEffect, useRef } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

export interface MultiSelectOption {
  value: string
  label: string
  icone?: string
  grupo?: string   // para agrupar opções (ex: nome da categoria pai)
  cor?: string
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  className?: string
}

export function MultiSelect({
  options, values, onChange, placeholder = 'Selecionar...', className = ''
}: MultiSelectProps) {
  const [open, setOpen]   = useState(false)
  const [busca, setBusca] = useState('')
  const ref               = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const toggle = (val: string) => {
    onChange(values.includes(val) ? values.filter(v => v !== val) : [...values, val])
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  // Filtra e agrupa
  const buscaLow = busca.toLowerCase()
  const filtradas = options.filter(o =>
    o.label.toLowerCase().includes(buscaLow) ||
    (o.grupo ?? '').toLowerCase().includes(buscaLow)
  )

  // Agrupa por grupo
  const grupos = filtradas.reduce<Record<string, MultiSelectOption[]>>((acc, o) => {
    const g = o.grupo ?? ''
    if (!acc[g]) acc[g] = []
    acc[g].push(o)
    return acc
  }, {})

  // Label resumido
  const labelResumo = () => {
    if (values.length === 0) return null
    if (values.length === 1) {
      const opt = options.find(o => o.value === values[0])
      return opt ? `${opt.icone ?? ''} ${opt.label}`.trim() : values[0]
    }
    return `${values.length} selecionados`
  }

  const resumo = labelResumo()

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 bg-[#252d42] border border-white/10 rounded-lg
          px-3 py-2 text-[13px] outline-none transition-colors text-left"
        style={{ borderColor: open ? '#00c896' : undefined, color: resumo ? '#e8eaf0' : '#8b92a8' }}
      >
        <span className="flex-1 truncate">{resumo ?? placeholder}</span>
        {values.length > 0 && (
          <span onClick={clear}
            className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center
              hover:bg-white/10 transition-colors"
            style={{ color: '#8b92a8' }}>
            <X size={10} />
          </span>
        )}
        <ChevronDown size={13} style={{ color: '#8b92a8', flexShrink: 0,
          transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-[50] min-w-full w-max max-w-xs
          bg-[#1a1f2e] border border-white/10 rounded-xl shadow-xl overflow-hidden"
          style={{ maxHeight: 280 }}>

          {/* Busca */}
          {options.length > 6 && (
            <div className="p-2 border-b border-white/10">
              <input
                value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar..."
                className="w-full bg-[#252d42] border border-white/10 rounded-lg px-2.5 py-1.5
                  text-[12px] outline-none focus:border-av-green transition-colors
                  placeholder:text-white/30"
                style={{ color: '#e8eaf0' }}
                autoFocus
              />
            </div>
          )}

          {/* Opções */}
          <div className="overflow-y-auto" style={{ maxHeight: options.length > 6 ? 220 : 280, scrollbarWidth: 'thin' }}>
            {Object.entries(grupos).map(([grupo, opts]) => (
              <div key={grupo}>
                {/* Header do grupo */}
                {grupo && (
                  <div className="px-3 py-1.5 sticky top-0 bg-[#1a1f2e]">
                    <span className="text-[10px] font-bold uppercase tracking-wide"
                      style={{ color: '#8b92a8' }}>{grupo}</span>
                  </div>
                )}
                {opts.map(o => {
                  const sel = values.includes(o.value)
                  return (
                    <button key={o.value} onClick={() => toggle(o.value)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left
                        hover:bg-white/5 transition-colors"
                      style={{ paddingLeft: grupo ? 20 : 12 }}>
                      {/* Checkbox visual */}
                      <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all"
                        style={{
                          borderColor: sel ? '#00c896' : 'rgba(255,255,255,0.2)',
                          background: sel ? '#00c896' : 'transparent',
                        }}>
                        {sel && <Check size={10} style={{ color: '#0a0f1a' }} />}
                      </div>
                      {/* Ícone colorido */}
                      {o.icone && (
                        <span className="text-[14px] flex-shrink-0">{o.icone}</span>
                      )}
                      {o.cor && !o.icone && (
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: o.cor }} />
                      )}
                      <span className="text-[12px] truncate"
                        style={{ color: sel ? '#e8eaf0' : '#c5cad8' }}>
                        {o.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
            {filtradas.length === 0 && (
              <p className="text-[12px] text-center py-4" style={{ color: '#8b92a8' }}>
                Nenhum resultado
              </p>
            )}
          </div>

          {/* Rodapé com contagem */}
          {values.length > 0 && (
            <div className="px-3 py-2 border-t border-white/10 flex items-center justify-between">
              <span className="text-[11px]" style={{ color: '#8b92a8' }}>
                {values.length} selecionado{values.length > 1 ? 's' : ''}
              </span>
              <button onClick={() => onChange([])}
                className="text-[11px] hover:text-red-400 transition-colors"
                style={{ color: '#8b92a8' }}>
                Limpar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
