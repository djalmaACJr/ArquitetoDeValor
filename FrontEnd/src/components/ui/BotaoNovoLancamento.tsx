// src/components/ui/BotaoNovoLancamento.tsx
import { Plus, TrendingDown, TrendingUp, ArrowLeftRight, type LucideIcon } from 'lucide-react'

type TipoTx = 'DESPESA' | 'RECEITA' | 'TRANSFERENCIA'

interface Props {
  onSelect: (tipo: TipoTx) => void
  className?: string
}

const OPCOES: { tipo: TipoTx; label: string; cor: string; Icon: LucideIcon }[] = [
  { tipo: 'DESPESA',       label: 'Despesa',      cor: '#f87171', Icon: TrendingDown   },
  { tipo: 'RECEITA',       label: 'Receita',       cor: '#4ade80', Icon: TrendingUp     },
  { tipo: 'TRANSFERENCIA', label: 'Transferência', cor: '#60a5fa', Icon: ArrowLeftRight },
]

export default function BotaoNovoLancamento({ onSelect, className }: Props) {
  return (
    <div className={`relative group${className ? ` ${className}` : ''}`}>
      <button
        className="flex items-center gap-1.5 bg-av-green text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-av-green/90 transition-colors"
        style={{ color: '#0a0f1a' }}
      >
        <Plus size={14} /> Novo lançamento
      </button>

      {/* Dropdown — fade + slide ao passar o mouse */}
      <div
        className="absolute right-0 top-full pt-1 z-50
          opacity-0 -translate-y-1 pointer-events-none
          group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto
          transition-all duration-200 ease-out"
      >
        <div
          className="rounded-xl border border-white/10 shadow-xl overflow-hidden"
          style={{ background: '#1a2235', minWidth: '170px' }}
        >
          {OPCOES.map(({ tipo, label, cor, Icon }) => (
            <button
              key={tipo}
              onClick={() => onSelect(tipo)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-white/5"
              style={{ color: '#e8eaf0' }}
            >
              <Icon size={14} style={{ color: cor, flexShrink: 0 }} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
