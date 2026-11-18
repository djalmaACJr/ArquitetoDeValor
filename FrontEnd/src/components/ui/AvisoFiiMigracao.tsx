import { useNavigate } from 'react-router-dom'
import { AlertTriangle, X } from 'lucide-react'
import { useAlertasFii } from '../../hooks/useAlertasFii'
import { formatData } from '../../lib/utils'

const MUTED = '#c9a9a9'

// Aviso de login ESPECIAL (vermelho): um FII da carteira publicou fato
// relevante/comunicado de liquidação, fusão, transformação ou troca de código.
// Montado em AppLayout. Fecha por navegador (os ids viram "vistos"); o banner
// fixo na página do ativo e o selo nas listas continuam enquanto o aviso valer.
export default function AvisoFiiMigracao() {
  const { naoVistos, marcarVistos } = useAlertasFii()
  const navigate = useNavigate()
  if (naoVistos.length === 0) return null
  const n = naoVistos.length

  return (
    <div className="pointer-events-auto w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl"
      style={{ borderColor: 'rgba(255,92,122,0.6)', background: '#1f0f14' }}>
      <div className="flex items-start gap-3 p-4">
        <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,92,122,0.18)' }}>
          <AlertTriangle size={16} style={{ color: '#ff5c7a' }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white">{n === 1 ? 'Um FII seu pode estar mudando' : `${n} FIIs seus podem estar mudando`}</p>
          <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
            Liquidação, fusão ou troca de código: a cotação pode zerar e você pode receber cotas de outro fundo. Vale conferir o documento.
          </p>
        </div>
        <button onClick={marcarVistos} aria-label="Fechar" className="shrink-0 p-1 rounded-md hover:bg-white/10" style={{ color: MUTED }}>
          <X size={16} />
        </button>
      </div>

      <ul className="px-4 pb-2 space-y-1.5 max-h-48 overflow-auto">
        {naoVistos.slice(0, 5).map((a) => (
          <li key={`${a.ativo_id}-${a.id}`} className="text-[12px]">
            <button onClick={() => { marcarVistos(); navigate(`/investimentos/ativos/${a.ativo_id}`) }} className="text-white font-semibold hover:underline">
              {a.ticker}
            </button>
            <span style={{ color: '#ff9fb1' }}> · {a.rotulo}</span>
            <span style={{ color: MUTED }}> · {formatData(a.data_entrega.slice(0, 10))}</span>
          </li>
        ))}
        {n > 5 && <li className="text-[11px]" style={{ color: MUTED }}>+{n - 5} outro(s)…</li>}
      </ul>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
        <button onClick={marcarVistos} className="px-3 py-1.5 rounded-lg text-[13px] hover:bg-white/10" style={{ color: MUTED }}>Dispensar</button>
        <button onClick={() => { const a = naoVistos[0]; marcarVistos(); navigate(`/investimentos/ativos/${a.ativo_id}`) }}
          className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white" style={{ background: '#e0415f' }}>
          Ver o ativo
        </button>
      </div>
    </div>
  )
}
