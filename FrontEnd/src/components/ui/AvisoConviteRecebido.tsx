import { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { useConvitesRecebidos } from '../../hooks/useAgregados'

const MUTED = '#8b92a8'
const AZUL = '#60a5fa'

// Aviso de login para quem FOI CONVIDADO: há convites de compartilhamento
// pendentes (o convidado já tem conta, o e-mail do convite bate com o dele).
// Aceitar/recusar direto daqui; "Depois" só esconde nesta sessão — o convite
// continua em Compartilhamento → "Convites que recebi". Montado em AppLayout,
// empilhado com os outros avisos (canto inferior direito).
export default function AvisoConviteRecebido() {
  const { convites, aceitar, recusar } = useConvitesRecebidos()
  const [oculto, setOculto] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState('')

  const pendentes = convites.filter(c => c.status === 'PENDENTE')
  if (oculto || pendentes.length === 0) return null

  const responder = async (id: string, aceitando: boolean) => {
    setErro(''); setOcupado(id)
    const res = aceitando ? await aceitar(id) : await recusar(id)
    setOcupado(null)
    if (!res.ok) setErro(res.erro ?? 'Não foi possível responder ao convite.')
  }

  return (
    <div className="pointer-events-auto w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl"
      style={{ borderColor: 'rgba(96,165,250,0.4)', background: '#0f1729' }}>
      <div className="flex items-start gap-3 p-4">
        <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(96,165,250,0.15)' }}>
          <UserPlus size={16} style={{ color: AZUL }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white">
            {pendentes.length === 1 ? 'Convite para ser agregado' : `${pendentes.length} convites para ser agregado`}
          </p>
          <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
            Ao aceitar, você poderá visualizar (e editar, se permitido) as contas e módulos que o dono liberar.
          </p>
        </div>
        <button onClick={() => setOculto(true)} aria-label="Fechar"
          className="shrink-0 p-1 rounded-md hover:bg-white/10" style={{ color: MUTED }}>
          <X size={16} />
        </button>
      </div>

      <ul className="px-4 pb-3 space-y-2 max-h-48 overflow-auto">
        {pendentes.map(c => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-white truncate">{c.dono_nome}</span>
            <span className="flex gap-1.5 shrink-0">
              <button disabled={ocupado === c.id} onClick={() => responder(c.id, true)}
                className="px-2.5 py-1 rounded-lg text-[12px] font-medium disabled:opacity-50"
                style={{ background: '#00c896', color: '#0a0f1a' }}>
                Aceitar
              </button>
              <button disabled={ocupado === c.id} onClick={() => responder(c.id, false)}
                className="px-2.5 py-1 rounded-lg text-[12px] font-medium border border-white/15 text-white/80 hover:bg-white/5 disabled:opacity-50">
                Recusar
              </button>
            </span>
          </li>
        ))}
      </ul>
      {erro && <p className="px-4 pb-3 text-[12px] text-red-400">{erro}</p>}
    </div>
  )
}
