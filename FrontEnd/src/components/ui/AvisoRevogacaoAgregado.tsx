import { UserX, X } from 'lucide-react'
import { useAvisosRevogacaoAgregado } from '../../hooks/useAgregados'

const MUTED = '#8b92a8'
const VERMELHO = '#f87171'

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// Aviso de login: algum dono revogou meu acesso ao espaço dele desde a
// última vez que vi este aviso. Sem isso, o vínculo só sumia do seletor de
// espaço sem nenhuma explicação visível. Montado uma vez em AppLayout,
// empilhado com NovidadesProventos/AvisoDataComProxima (canto inferior
// direito) — o wrapper de lá já cuida do pointer-events-none/auto.
export default function AvisoRevogacaoAgregado() {
  const { avisos, dispensar } = useAvisosRevogacaoAgregado()
  if (avisos.length === 0) return null

  return (
    <div className="pointer-events-auto w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl"
      style={{ borderColor: 'rgba(248,113,113,0.4)', background: '#0f1729' }}>
      <div className="flex items-start gap-3 p-4">
        <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(248,113,113,0.15)' }}>
          <UserX size={16} style={{ color: VERMELHO }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white">
            Acesso revogado
          </p>
          <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
            {avisos.length === 1
              ? `${avisos[0].dono_nome} revogou seu acesso à conta dele.`
              : `${avisos.length} pessoas revogaram seu acesso à conta delas.`}
          </p>
        </div>
        <button onClick={dispensar} aria-label="Fechar"
          className="shrink-0 p-1 rounded-md hover:bg-white/10" style={{ color: MUTED }}>
          <X size={16} />
        </button>
      </div>

      {avisos.length > 1 && (
        <ul className="px-4 pb-2 space-y-1.5 max-h-32 overflow-auto">
          {avisos.slice(0, 6).map(a => (
            <li key={a.id} className="text-[12px]">
              <span className="text-white">{a.dono_nome}</span>
              {a.revogado_em && <span style={{ color: MUTED }}> · {formatDataHora(a.revogado_em)}</span>}
            </li>
          ))}
          {avisos.length > 6 && (
            <li className="text-[11px] pt-0.5" style={{ color: MUTED }}>+{avisos.length - 6} outro(s)…</li>
          )}
        </ul>
      )}

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
        <button onClick={dispensar} className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white"
          style={{ background: '#f87171' }}>
          Entendi
        </button>
      </div>
    </div>
  )
}
