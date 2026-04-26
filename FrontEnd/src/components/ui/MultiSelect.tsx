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
  idPai?: string   // ← NOVO: para identificar filhos de um pai
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

  // Toggle com lógica de seleção de pai/filho
  const toggle = (val: string, idPai?: string) => {
    // Se é um PAI, seleciona/deseleciona todos os filhos também
    if (idPai === undefined) {
      const filhos = options
        .filter(o => o.idPai === val)
        .map(o => o.value)
      
      if (values.includes(val)) {
        // Deselecionar pai e filhos
        onChange(values.filter(v => v !== val && !filhos.includes(v)))
      } else {
        // Selecionar pai e filhos
        onChange([...new Set([...values, val, ...filhos])])
      }
    } else {
      // Se é um FILHO
      const novoValues = values.includes(val) 
        ? values.filter(v => v !== val) 
        : [...values, val]
      
      // Verifica se todos os filhos foram selecionados
      const filhos = options.filter(o => o.idPai === idPai).map(o => o.value)
      const todosFilhosSelected = filhos.every(f => novoValues.includes(f))
      const nenhumFilhoSelected = filhos.every(f => !novoValues.includes(f))
      
      // Se todos filhos selecionados, seleciona o pai também
      if (todosFilhosSelected) {
        novoValues.push(idPai)
      } else if (nenhumFilhoSelected) {
        // Se nenhum filho selecionado, remove o pai
        novoValues.splice(novoValues.indexOf(idPai), 1)
      }
      
      onChange(novoValues)
    }
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  // Filtra opções
  const buscaLow = busca.toLowerCase()
  const filtradas = options.filter(o =>
    o.label.toLowerCase().includes(buscaLow) ||
    (o.grupo ?? '').toLowerCase().includes(buscaLow)
  )

  // Monta a lista ordenada: pai → filhos → próximo pai
  const opcoesordenadas = (() => {
    const pais = filtradas.filter(o => !o.idPai)
    const resultado: MultiSelectOption[] = []

    pais.forEach(pai => {
      resultado.push(pai)
      const filhos = filtradas.filter(o => o.idPai === pai.value)
      resultado.push(...filhos)
    })

    return resultado
  })()

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

      {/* Dropdown — AUMENTADO EM TAMANHO */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-[50] min-w-full w-max max-w-md
          bg-[#1a1f2e] border border-white/10 rounded-xl shadow-xl overflow-hidden"
          style={{ maxHeight: '50vh' }}> {/* ← AUMENTADO DE 280px para 50vh */}

          {/* Busca */}
          {options.length > 6 && (
            <div className="p-2.5 border-b border-white/10 sticky top-0 bg-[#1a1f2e]">
              <input
                value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar..."
                className="w-full bg-[#252d42] border border-white/10 rounded-lg px-2.5 py-2
                  text-[12px] outline-none focus:border-av-green transition-colors
                  placeholder:text-white/30"
                style={{ color: '#e8eaf0' }}
                autoFocus
              />
            </div>
          )}

          {/* Opções — AUMENTADO ESPAÇAMENTO */}
          <div className="overflow-y-auto" style={{ maxHeight: '50vh', scrollbarWidth: 'thin' }}>
            {opcoesordenadas.length === 0 ? (
              <p className="text-[12px] text-center py-6" style={{ color: '#8b92a8' }}>
                Nenhum resultado
              </p>
            ) : (
              opcoesordenadas.map(o => {
                const sel = values.includes(o.value)
                const ehPai = !o.idPai
                const temFilhos = options.some(opt => opt.idPai === o.value)

                return (
                  <button 
                    key={o.value} 
                    onClick={() => toggle(o.value, o.idPai)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left
                      hover:bg-white/5 transition-colors"
                    style={{ paddingLeft: o.idPai ? 32 : 12 }} // ← MAIS INDENTAÇÃO
                  >
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

                    {/* Label — FONTE MAIOR */}
                    <span 
                      className={`flex-1 truncate ${ehPai ? 'font-semibold' : ''}`}
                      style={{ 
                        color: sel ? '#e8eaf0' : '#c5cad8',
                        fontSize: ehPai ? '13px' : '12px' // ← PAIS MAIORES
                      }}>
                      {o.label}
                    </span>

                    {/* Badge para pais com filhos selecionados */}
                    {ehPai && temFilhos && sel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-av-green/20"
                        style={{ color: '#00c896', flexShrink: 0 }}>
                        {options.filter(opt => opt.idPai === o.value && values.includes(opt.value)).length}/{options.filter(opt => opt.idPai === o.value).length}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* Rodapé com contagem */}
          {values.length > 0 && (
            <div className="px-3 py-2.5 border-t border-white/10 flex items-center justify-between sticky bottom-0 bg-[#1a1f2e]">
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