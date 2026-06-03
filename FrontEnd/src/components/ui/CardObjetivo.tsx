import { Pencil, Trash2, BarChart2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatBRL, formatData } from '../../lib/utils'
import type { Objetivo } from '../../types'

const TIPO_LABEL: Record<string, string> = {
  SONHO:        'Sonho',
  OBJETIVO:     'Objetivo',
  PROJETO:      'Projeto',
  CRESCIMENTO:  'Crescimento',
}
const TIPO_COR: Record<string, string> = {
  SONHO:        '#7F77DD',
  OBJETIVO:     '#4da6ff',
  PROJETO:      '#f0b429',
  CRESCIMENTO:  '#00c896',
}
const STATUS_LABEL: Record<string, string> = {
  EM_PROGRESSO: 'Em progresso',
  ATINGIDO:     'Atingido',
  CANCELADO:    'Cancelado',
}
const STATUS_COR: Record<string, string> = {
  EM_PROGRESSO: '#4da6ff',
  ATINGIDO:     '#00c896',
  CANCELADO:    '#636e72',
}

function DiasRestantes({ dias }: { dias: number }) {
  if (dias <= 0) return <span style={{ color: '#f87171' }}>Vencido</span>
  if (dias <= 7)  return <span style={{ color: '#f87171' }}>{dias}d restantes</span>
  if (dias <= 30) return <span style={{ color: '#f0b429' }}>{dias}d restantes</span>
  return <span style={{ color: '#8b92a8' }}>{dias}d restantes</span>
}

export function CardObjetivo({
  objetivo,
  onEditar,
  onExcluir,
}: {
  objetivo: Objetivo
  onEditar:  (o: Objetivo) => void
  onExcluir: (o: Objetivo) => void
}) {
  const tipoCor  = TIPO_COR[objetivo.tipo]  ?? '#4da6ff'
  const baraCor  = objetivo.status === 'ATINGIDO'  ? '#00c896'
                 : objetivo.status === 'CANCELADO' ? '#636e72'
                 : tipoCor
  const nCats = objetivo.categorias_objetivo?.length ?? 0
  const ref   = objetivo.conta_nome
    ?? (nCats > 1 ? `${nCats} categorias` : objetivo.categoria_descricao)
    ?? null
  const opacity  = objetivo.status === 'CANCELADO' ? 'opacity-50' : ''

  return (
    <div className={`bg-[#1a1f2e] rounded-xl p-4 flex flex-col gap-3 border border-white/5
      hover:border-white/10 transition-colors ${opacity}`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[20px] flex-shrink-0"
            style={{ background: `${objetivo.cor}22`, border: `1.5px solid ${objetivo.cor}55` }}>
            {objetivo.icone}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-white/90 truncate">{objetivo.nome}</p>
            {ref && <p className="text-[13px] truncate" style={{ color: '#8b92a8' }}>{ref}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Link to={`/objetivos/${objetivo.id}`}
            className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center
              hover:border-av-blue/50 hover:text-av-blue transition-colors"
            style={{ color: '#8b92a8' }}
            title="Ver detalhes">
            <BarChart2 size={12} />
          </Link>
          <button onClick={() => onEditar(objetivo)}
            className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center
              hover:border-white/30 hover:text-white transition-colors"
            style={{ color: '#8b92a8' }}>
            <Pencil size={12} />
          </button>
          <button onClick={() => onExcluir(objetivo)}
            className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center
              hover:border-red-400/50 hover:text-red-400 transition-colors"
            style={{ color: '#8b92a8' }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: `${tipoCor}22`, color: tipoCor }}>
          {TIPO_LABEL[objetivo.tipo]}
        </span>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: `${STATUS_COR[objetivo.status]}22`, color: STATUS_COR[objetivo.status] }}>
          {STATUS_LABEL[objetivo.status]}
        </span>
      </div>

      {/* Barra de progresso */}
      <div>
        <div className="flex justify-between items-center mb-1.5">
          {objetivo.tipo === 'CRESCIMENTO' ? (
            <span className="text-[13px]" style={{ color: '#8b92a8' }}>
              {objetivo.valor_atingido >= 0 ? '+' : ''}{objetivo.valor_atingido.toFixed(1)}%
              {' '}de meta {objetivo.valor_meta.toFixed(1)}%
            </span>
          ) : (
            <span className="text-[13px]" style={{ color: '#8b92a8' }}>
              {formatBRL(objetivo.valor_atingido)} de {formatBRL(objetivo.valor_meta)}
            </span>
          )}
          <span className="text-[14px] font-bold" style={{ color: baraCor }}>
            {objetivo.percentual}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-white/8">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${objetivo.percentual}%`, background: baraCor }} />
        </div>
      </div>

      {/* Rodapé */}
      <div className="flex justify-between items-center text-[12px]" style={{ color: '#8b92a8' }}>
        <span>até {formatData(objetivo.data_fim)}</span>
        {objetivo.status === 'EM_PROGRESSO' && <DiasRestantes dias={objetivo.dias_restantes} />}
      </div>
    </div>
  )
}
