// src/components/relatorios/BotaoExpandirTodas.tsx
import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * Botão "Expandir todas / Colapsar todas" usado pelos relatórios no modo
 * Resumo (agrupado por categoria pai). Versão única — antes era replicado em
 * cada página com mesmas cores/ícones/comportamento.
 *
 * Variant `compacto` (default = false) reduz padding/tamanho de fonte —
 * usado em barras de controle densas (ex.: Comparativo).
 */
export default function BotaoExpandirTodas({
  todasExpandidas,
  onClick,
  compacto = false,
}: {
  todasExpandidas: boolean
  onClick: () => void
  compacto?: boolean
}) {
  return (
    <button
      title={todasExpandidas ? 'Colapsar todas as categorias' : 'Expandir todas as categorias'}
      onClick={onClick}
      className={`rounded-lg font-semibold transition-all border flex items-center gap-1.5 ${
        compacto ? 'px-2.5 py-1 text-[14px]' : 'px-3 py-1 text-[15px]'
      }`}
      style={{
        background:  'transparent',
        borderColor: 'rgba(255,255,255,0.1)',
        color:       '#8b92a8',
      }}
    >
      {todasExpandidas ? <ChevronRight size={compacto ? 12 : 14} /> : <ChevronDown size={compacto ? 12 : 14} />}
      {todasExpandidas ? 'Colapsar todas' : 'Expandir todas'}
    </button>
  )
}
