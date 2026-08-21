import { Link } from 'react-router-dom'
import { AlertTriangle, X } from 'lucide-react'
import { useAvisosCron } from '../../hooks/useAvisosCron'

const MUTED = '#8b92a8'

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// Card de notificação exibido no login (só pra admin) quando algum cron
// falhou desde a última vez que foi visto — inclui falhas que nunca chegaram
// a invocar a Edge Function (pg_cron/pg_net, ex.: secret ausente do Vault),
// detectadas por fn_verificar_saude_cron e gravadas em cron_execucoes como
// uma falha normal. Montado uma vez em AppLayout. Some ao dispensar.
export default function AvisosCronAdmin() {
  const { avisos, dispensar } = useAvisosCron()
  if (avisos.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl"
      style={{ borderColor: 'rgba(248,113,113,0.4)', background: '#0f1729' }}>
      <div className="flex items-start gap-3 p-4">
        <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(248,113,113,0.15)' }}>
          <AlertTriangle size={16} style={{ color: '#f87171' }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white">
            {avisos.length} cron{avisos.length > 1 ? 's' : ''} com falha
          </p>
          <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
            Inclui falhas que nem chegaram a rodar (ex.: secret ausente) — veja em /admin/crons.
          </p>
        </div>
        <button onClick={dispensar} aria-label="Fechar"
          className="shrink-0 p-1 rounded-md hover:bg-white/10" style={{ color: MUTED }}>
          <X size={16} />
        </button>
      </div>

      <ul className="px-4 pb-2 space-y-1.5 max-h-44 overflow-auto">
        {avisos.slice(0, 6).map(a => (
          <li key={a.id} className="text-[12px]">
            <span className="text-white">{a.job_nome}</span>
            <span style={{ color: MUTED }}> · {formatDataHora(a.executado_em)}</span>
          </li>
        ))}
        {avisos.length > 6 && (
          <li className="text-[11px] pt-0.5" style={{ color: MUTED }}>+{avisos.length - 6} outro(s)…</li>
        )}
      </ul>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
        <button onClick={dispensar} className="px-3 py-1.5 rounded-lg text-[13px] hover:bg-white/10" style={{ color: MUTED }}>
          Dispensar
        </button>
        <Link to="/admin/crons" className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white text-center"
          style={{ background: '#f87171' }}>
          Ver detalhes
        </Link>
      </div>
    </div>
  )
}
