// src/components/ui/AvisoFecharAba.tsx
//
// Modal central (mais chamativo que a pílula de contagem da Sidebar),
// mostrado quando o timer de inatividade DESTA aba expira. Como a sessão
// desktop fica em localStorage compartilhado entre abas, deslogar direto
// aqui derrubaria todas — mesmo as ativas. Dá a chance de fechar só esta
// aba antes de cair no signOut global (ver useAutoLogout.ts).

import { useSyncExternalStore } from 'react'
import { LogOut, X } from 'lucide-react'
import {
  subscribeAvisoFecharAba,
  getAvisoFecharAbaSnapshot,
  fecharAbaAtual,
  continuarNestaAba,
} from '../../lib/avisoFecharAba'

export default function AvisoFecharAba() {
  const { mostrando, segundos, fechando } = useSyncExternalStore(subscribeAvisoFecharAba, getAvisoFecharAbaSnapshot)
  if (!mostrando) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[300]" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
        className="fixed z-[301] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[min(440px,calc(100vw-32px))] rounded-2xl border border-white/10 flex flex-col"
        style={{ background: '#1a1f2e' }}
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
          <LogOut size={15} className="text-red-300" />
          <span className="text-[18px] font-semibold" style={{ color: '#e8eaf0' }}>
            Aba inativa
          </span>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <p className="text-[15px] leading-relaxed" style={{ color: '#c2c7d6' }}>
            {fechando
              ? 'Tentando fechar esta aba automaticamente…'
              : 'Esta aba ficou muito tempo sem uso. Se você tem outras abas do sistema abertas, feche apenas esta para mantê-las conectadas.'}
          </p>
          {!fechando && (
            <p className="text-[13px]" style={{ color: '#8b92a8' }}>
              Sem uma ação sua, a sessão será encerrada em todas as abas em {segundos}s.
            </p>
          )}
        </div>

        {!fechando && (
          <div className="flex gap-3 px-5 pb-5">
            <button
              onClick={fecharAbaAtual}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5
                text-[15px] font-semibold text-white bg-red-500/80 hover:bg-red-500 transition-colors"
            >
              <X size={15} />
              Fechar esta aba
            </button>
            <button
              onClick={continuarNestaAba}
              className="flex-1 rounded-lg border border-white/10 px-3 py-2.5 text-[15px] font-semibold
                hover:border-white/30 transition-colors"
              style={{ color: '#e8eaf0' }}
            >
              Continuar aqui
            </button>
          </div>
        )}
      </div>
    </>
  )
}
