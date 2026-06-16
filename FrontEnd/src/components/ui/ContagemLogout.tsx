// src/components/ui/ContagemLogout.tsx
//
// Contagem regressiva de logout por inatividade, exibida na Sidebar (rodapé)
// apenas no último minuto. Lê o store `autoLogoutAviso` (alimentado pelo
// useAutoLogout) via useSyncExternalStore — sem prop-drilling nem mexer nas
// telas. Clicar zera o relógio de inatividade e some com o aviso.
//
// Chama atenção SEM modal central: pílula vermelha pulsante no canto da barra.

import { useSyncExternalStore } from 'react'
import { Clock } from 'lucide-react'
import { subscribeAviso, getAvisoSnapshot, resetarInatividade } from '../../lib/autoLogoutAviso'

export default function ContagemLogout({ colapsado = false }: { colapsado?: boolean }) {
  const { avisando, segundos } = useSyncExternalStore(subscribeAviso, getAvisoSnapshot)
  if (!avisando) return null

  const base =
    'w-full mb-2 flex items-center rounded-lg border border-red-500/60 bg-red-500/15 ' +
    'text-red-200 hover:bg-red-500/25 hover:border-red-400 transition-colors ' +
    'animate-pulse shadow-[0_0_0_3px_rgba(239,68,68,0.18)] focus:outline-none ' +
    'focus:ring-2 focus:ring-red-400/70'

  // aria-live assertivo: leitores de tela anunciam a expiração iminente.
  if (colapsado) {
    return (
      <button
        type="button"
        onClick={resetarInatividade}
        aria-live="assertive"
        title={`Sessão expira em ${segundos}s — clique para continuar conectado`}
        className={`${base} flex-col justify-center gap-0.5 px-1 py-1.5`}
      >
        <Clock size={14} className="text-red-300" />
        <span className="text-[13px] font-bold tabular-nums leading-none">{segundos}s</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={resetarInatividade}
      aria-live="assertive"
      title="Clique para continuar conectado"
      className={`${base} gap-2 px-2 py-2 text-left`}
    >
      <Clock size={16} className="text-red-300 flex-shrink-0" />
      <span className="flex-1 leading-tight">
        <span className="block text-[13px] text-red-200/90">Sessão expira em</span>
        <span className="block text-[15px] font-bold tabular-nums text-white">
          {segundos}s — clique para continuar
        </span>
      </span>
    </button>
  )
}
