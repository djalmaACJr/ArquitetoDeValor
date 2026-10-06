// src/components/ui/SeletorEspaco.tsx
//
// Troca entre "Meus dados" e o espaço de um dono que concedeu acesso como
// agregado (ver CompartilhamentoPage/lib/espacoAtivo.ts). Só aparece na
// Sidebar quando há pelo menos 1 vínculo ACEITO — usuário que nunca foi
// convidado nem convidou ninguém não vê nada aqui, sem poluir a UI.

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Check, Users2 } from 'lucide-react'
import { useEspacoAtivo } from '../../hooks/useEspacoAtivo'
import { useConvitesRecebidos } from '../../hooks/useAgregados'

export default function SeletorEspaco({ colapsado }: { colapsado: boolean }) {
  const { vinculo, setEspacoAtivo } = useEspacoAtivo()
  const { aceitos, loading, recarregar } = useConvitesRecebidos()
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  // Revisa os vínculos ao voltar pra aba/janela: se o dono revogou o acesso
  // enquanto eu estava em "Conta de Fulano", o espaço ativo precisa cair.
  useEffect(() => {
    const revisar = () => { if (document.visibilityState === 'visible') void recarregar() }
    document.addEventListener('visibilitychange', revisar)
    window.addEventListener('focus', revisar)
    return () => {
      document.removeEventListener('visibilitychange', revisar)
      window.removeEventListener('focus', revisar)
    }
  }, [recarregar])

  // Espaço ativo cujo vínculo deixou de estar ACEITO (revogado/removido): volta
  // sozinho pra "Meus dados". Sem isso o seletor sumia (nenhum vínculo aceito)
  // e o usuário ficava preso numa conta vazia, sem como sair.
  const vinculoAtivoId = vinculo?.id
  const vinculoSumiu = !!vinculoAtivoId && !loading && !aceitos.some(a => a.id === vinculoAtivoId)
  useEffect(() => {
    if (vinculoSumiu) {
      setEspacoAtivo(null)
      navigate('/')
    }
  }, [vinculoSumiu, setEspacoAtivo, navigate])

  // Nada pra escolher (nunca aceitou nenhum convite) → não mostra o seletor.
  if (aceitos.length === 0) return null

  const escolher = (destino: typeof vinculo) => {
    setEspacoAtivo(destino)
    setAberto(false)
    navigate('/')
  }

  if (colapsado) {
    return (
      <button
        onClick={() => navigate('/compartilhamento')}
        title={vinculo ? `Espaço: ${vinculo.dono_nome}` : 'Meus dados'}
        className="mx-auto mb-3 w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-av-green hover:border-av-green/40 transition-colors"
      >
        <Users2 size={14} />
      </button>
    )
  }

  return (
    <div ref={ref} className="relative mb-3">
      <button
        onClick={() => setAberto(v => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-av-green/40 transition-colors text-left"
      >
        <Users2 size={14} className="text-av-green flex-shrink-0" />
        <span className="flex-1 min-w-0 text-[13px] text-white/85 truncate">
          {vinculo ? `Conta de ${vinculo.dono_nome}` : 'Meus dados'}
        </span>
        <ChevronDown size={13} className={`text-white/40 flex-shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg border border-white/10 bg-[#1a2235] shadow-xl overflow-hidden">
          <button
            onClick={() => escolher(null)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[13px] text-white/80 hover:bg-white/5 transition-colors"
          >
            Meus dados
            {!vinculo && <Check size={13} className="text-av-green" />}
          </button>
          {aceitos.map(v => (
            <button
              key={v.id}
              onClick={() => escolher({ id: v.id, dono_id: v.dono_id, dono_nome: v.dono_nome, permissoes: v.permissoes })}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[13px] text-white/80 hover:bg-white/5 transition-colors border-t border-white/5"
            >
              <span className="truncate">Conta de {v.dono_nome}</span>
              {vinculo?.id === v.id && <Check size={13} className="text-av-green flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
