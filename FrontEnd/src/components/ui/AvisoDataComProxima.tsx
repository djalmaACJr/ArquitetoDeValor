import { X, CalendarClock } from 'lucide-react'
import { useAvisosDataCom } from '../../hooks/useAvisosDataCom'
import { formatBRL, formatData } from '../../lib/utils'

const MUTED = '#8b92a8'
const DOURADO = '#eab308'

// Card de notificação exibido no login quando algum ativo da carteira tem
// Data COM (última data com direito ao próximo provento) nos próximos dias
// — última chance de manter/comprar o papel antes dele virar "ex". Montado
// uma vez em AppLayout, empilhado com NovidadesProventos no mesmo canto.
export default function AvisoDataComProxima() {
  const { avisos, dispensar } = useAvisosDataCom()
  if (avisos.length === 0) return null

  return (
    <div className="pointer-events-auto w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl"
      style={{ borderColor: 'rgba(234,179,8,0.4)', background: '#0f1729' }}>
      <div className="flex items-start gap-3 p-4">
        <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(234,179,8,0.15)' }}>
          <CalendarClock size={16} style={{ color: DOURADO }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white">Data COM próxima</p>
          <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
            {avisos.length === 1
              ? 'Este ativo vira "ex" em breve — última chance de manter a posição pro próximo provento.'
              : 'Estes ativos viram "ex" em breve — última chance de manter a posição pro próximo provento.'}
          </p>
        </div>
        <button onClick={dispensar} aria-label="Fechar"
          className="shrink-0 p-1 rounded-md hover:bg-white/10" style={{ color: MUTED }}>
          <X size={16} />
        </button>
      </div>

      <ul className="px-4 pb-3 space-y-1 max-h-44 overflow-auto">
        {avisos.map((a) => (
          <li key={a.ativo_id} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="text-white truncate">
              {a.ticker} <span style={{ color: MUTED }}>· Data COM {formatData(a.data_com)}</span>
            </span>
            <span className="shrink-0 font-medium" style={{ color: DOURADO }}>{formatBRL(a.valor_projetado)}</span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-end px-4 py-3 border-t border-white/10">
        <button onClick={dispensar} className="px-3 py-1.5 rounded-lg text-[13px] hover:bg-white/10" style={{ color: MUTED }}>
          Dispensar
        </button>
      </div>
    </div>
  )
}
