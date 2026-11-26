import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, X } from 'lucide-react'
import { useAssembleiasNaoVistas } from '../../hooks/useAssembleiasFii'
import { useEmailEntrada } from '../../hooks/useEmailEntrada'

const MUTED = '#8b92a8'

function quando(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
}

// Aviso de login: há convocações de assembleia (FIIs da carteira) e/ou e-mails recebidos ainda não lidos
// (inclui os em quarentena, que aguardam aprovação). Montado em AppLayout. "Dispensar" só esconde nesta
// sessão; o item segue "NOVO" até ser visto na página.
export default function AvisoAssembleiaFii() {
  const { naoVistas } = useAssembleiasNaoVistas()
  const { mensagens } = useEmailEntrada()
  const navigate = useNavigate()
  const [dispensado, setDispensado] = useState(false)
  const emailsNovos = mensagens.filter((m) => m.status === 'QUARENTENA' || (m.status === 'PROCESSADO' && !m.visto_em))
  const n = naoVistas.length
  const ne = emailsNovos.length
  if (dispensado || (n === 0 && ne === 0)) return null
  const titulo = n > 0 && ne > 0
    ? `${n} assembleia(s) e ${ne} e-mail(s) novos`
    : n > 0 ? (n === 1 ? 'Assembleia convocada' : `${n} assembleias convocadas`)
    : (ne === 1 ? 'E-mail novo' : `${ne} e-mails novos`)
  return (
    <div className="pointer-events-auto w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl"
      style={{ borderColor: 'rgba(240,180,41,0.45)', background: '#0f1729' }}>
      <div className="flex items-start gap-3 p-4">
        <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(240,180,41,0.15)' }}>
          <CalendarClock size={16} style={{ color: '#f0b429' }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white">{titulo}</p>
          <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
            {n > 0 ? 'Fundos da sua carteira vão se reunir. Veja a data, como votar e o que vão decidir.' : 'Chegaram e-mails na sua caixa de entrada (alguns podem aguardar a sua aprovação).'}
          </p>
        </div>
        <button onClick={() => setDispensado(true)} aria-label="Fechar" className="shrink-0 p-1 rounded-md hover:bg-white/10" style={{ color: MUTED }}><X size={16} /></button>
      </div>
      <ul className="px-4 pb-2 space-y-1 max-h-44 overflow-auto">
        {naoVistas.slice(0, 6).map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="text-white font-semibold truncate">{a.inv_ativos?.ticker ?? '—'}</span>
            <span className="shrink-0" style={{ color: a.relevancia === 'IMPORTANTE' ? '#f0b429' : MUTED }}>{quando(a.data_evento)}{a.relevancia === 'IMPORTANTE' ? ' · importante' : ''}</span>
          </li>
        ))}
        {n > 6 && <li className="text-[11px] pt-0.5" style={{ color: MUTED }}>+{n - 6} outra(s)…</li>}
        {ne > 0 && (
          <li className="flex items-center justify-between gap-2 text-[12px]">
            <span className="text-white font-semibold truncate">E-mails</span>
            <span className="shrink-0" style={{ color: MUTED }}>{ne} nova(s){emailsNovos.some((m) => m.status === 'QUARENTENA') ? ' · há p/ aprovar' : ''}</span>
          </li>
        )}
      </ul>
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
        <button onClick={() => setDispensado(true)} className="px-3 py-1.5 rounded-lg text-[13px] hover:bg-white/10" style={{ color: MUTED }}>Dispensar</button>
        {ne > 0 && (
          <button onClick={() => { setDispensado(true); navigate('/investimentos/relatorios?aba=emails') }}
            className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white" style={{ background: '#3b82f6' }}>Ver e-mails</button>
        )}
        {n > 0 && (
          <button onClick={() => { setDispensado(true); navigate('/investimentos/relatorios?aba=assembleias') }}
            className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white" style={{ background: '#3b82f6' }}>Ver assembleias</button>
        )}
      </div>
    </div>
  )
}
