import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSearch, X } from 'lucide-react'
import { useAnalisesNaoVistas } from '../../hooks/useRelatoriosFii'
import { useIAPreferencia } from '../../hooks/useIAPreferencia'
import { provedorPorId } from '../../lib/iaProvedores'
import type { VereditoRelatorio } from '../../types'

const MUTED = '#8b92a8'
const COR: Record<VereditoRelatorio, string> = { POSITIVO: '#22c55e', NEUTRO: '#8b92a8', ATENCAO: '#f0b429', NEGATIVO: '#ff5c7a' }
const ROTULO: Record<VereditoRelatorio, string> = { POSITIVO: 'Positivo', NEUTRO: 'Neutro', ATENCAO: 'Atenção', NEGATIVO: 'Negativo' }

// Aviso de login: há análises de relatórios/resultados (FIIs, ações, stocks) ainda não lidas
// (geradas pela análise automática ou manualmente em outro lugar). Montado em
// AppLayout. "Dispensar" só esconde nesta sessão — a análise continua marcada
// como NOVA até ser aberta/lida na página de análises.
export default function AvisoAnaliseRelatorio() {
  const { naoVistas } = useAnalisesNaoVistas()
  const { configs } = useIAPreferencia()
  const navigate = useNavigate()
  const [dispensado, setDispensado] = useState(false)
  if (dispensado || naoVistas.length === 0) return null
  const n = naoVistas.length

  // Nome do(s) mentor(es): o apelido gravado na análise; em análises antigas (sem
  // apelido), o da config de IA que casa com provedor+modelo; por fim, o provedor.
  const mentores = [...new Set(naoVistas.map((a) => {
    if (a.mentor_nome?.trim()) return a.mentor_nome.trim()
    const cfg = configs.find((c) => c.provedor === a.provedor && (!a.modelo || !c.modelo || c.modelo === a.modelo))
    return cfg?.nome?.trim() || provedorPorId(a.provedor)?.label || a.provedor || 'IA'
  }))]
  const quem = mentores.length === 1
    ? `O mentor ${mentores[0]} analisou`
    : `Os mentores ${mentores.slice(0, -1).join(', ')} e ${mentores[mentores.length - 1]} analisaram`

  return (
    <div className="pointer-events-auto w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl"
      style={{ borderColor: 'rgba(59,130,246,0.4)', background: '#0f1729' }}>
      <div className="flex items-start gap-3 p-4">
        <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.15)' }}>
          <FileSearch size={16} style={{ color: '#3b82f6' }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white">{n === 1 ? 'Nova análise de relatório' : `${n} novas análises de relatórios`}</p>
          <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
            {quem} {n === 1 ? 'um relatório de resultado' : 'relatórios de resultado'} de ativos da sua carteira (FIIs, ações e stocks).
          </p>
        </div>
        <button onClick={() => setDispensado(true)} aria-label="Fechar" className="shrink-0 p-1 rounded-md hover:bg-white/10" style={{ color: MUTED }}>
          <X size={16} />
        </button>
      </div>

      <ul className="px-4 pb-2 space-y-1 max-h-44 overflow-auto">
        {naoVistas.slice(0, 6).map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
            <button onClick={() => navigate(`/investimentos/ativos/${a.ativo_id}#relatorios-fii`)} title="Abrir a análise na página do ativo"
              className="text-white font-semibold truncate hover:underline text-left">{a.inv_ativos?.ticker ?? '—'}</button>
            <span className="shrink-0 font-medium" style={{ color: COR[a.veredito] }}>{ROTULO[a.veredito]}</span>
          </li>
        ))}
        {n > 6 && <li className="text-[11px] pt-0.5" style={{ color: MUTED }}>+{n - 6} outra(s)…</li>}
      </ul>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
        <button onClick={() => setDispensado(true)} className="px-3 py-1.5 rounded-lg text-[13px] hover:bg-white/10" style={{ color: MUTED }}>
          Dispensar
        </button>
        <button onClick={() => { setDispensado(true); navigate('/investimentos/relatorios') }}
          className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white" style={{ background: '#3b82f6' }}>
          Ver análises
        </button>
      </div>
    </div>
  )
}
