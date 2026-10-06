import { UserMinus, X } from 'lucide-react'
import { useAvisosAgregadoSaiu } from '../../hooks/useAgregados'

const MUTED = '#8b92a8'
const LARANJA = '#f0b429'

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// Aviso de login para o DONO: um agregado deixou de acessar por conta própria.
// Montado em AppLayout, empilhado com os outros avisos.
export default function AvisoAgregadoSaiu() {
  const { avisos, dispensar } = useAvisosAgregadoSaiu()
  if (avisos.length === 0) return null

  return (
    <div className="pointer-events-auto w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl"
      style={{ borderColor: 'rgba(240,180,41,0.4)', background: '#0f1729' }}>
      <div className="flex items-start gap-3 p-4">
        <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(240,180,41,0.15)' }}>
          <UserMinus size={16} style={{ color: LARANJA }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white">Agregado saiu</p>
          <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
            {avisos.length === 1
              ? `${avisos[0].agregado_nome || avisos[0].email_convidado} deixou de acessar a sua conta por conta própria. Você pode convidar de novo quando quiser.`
              : `${avisos.length} pessoas deixaram de acessar a sua conta por conta própria.`}
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
              <span className="text-white">{a.agregado_nome || a.email_convidado}</span>
              {a.revogado_em && <span style={{ color: MUTED }}> · {formatDataHora(a.revogado_em)}</span>}
            </li>
          ))}
          {avisos.length > 6 && (
            <li className="text-[11px] pt-0.5" style={{ color: MUTED }}>+{avisos.length - 6} outro(s)…</li>
          )}
        </ul>
      )}

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
        <button onClick={dispensar} className="px-3 py-1.5 rounded-lg text-[13px] font-medium"
          style={{ background: LARANJA, color: '#0a0f1a' }}>
          Entendi
        </button>
      </div>
    </div>
  )
}
