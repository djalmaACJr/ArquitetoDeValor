import { useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { TIPO_ATIVO_LABEL } from '../../lib/constants'
import type { TipoAtivoInvestimento } from '../../types'

const MUTED = '#8b92a8'

export interface AtivoBusca { ativo_id: string; ticker: string; nome: string; tipo_ativo: TipoAtivoInvestimento }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Campo "Localizar ativo": filtra por ticker ou nome e abre o detalhe do ativo escolhido.
export default function BuscaAtivo({ ativos }: { ativos: AtivoBusca[] }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [aberto, setAberto] = useState(false)
  const [ativoIdx, setAtivoIdx] = useState(0)
  const raiz = useRef<HTMLDivElement>(null)

  const resultados = useMemo(() => {
    const t = norm(q.trim())
    if (!t) return []
    return ativos
      .filter((a) => norm(a.ticker).includes(t) || norm(a.nome ?? '').includes(t))
      .sort((a, b) => Number(norm(b.ticker).startsWith(t)) - Number(norm(a.ticker).startsWith(t)) || a.ticker.localeCompare(b.ticker))
      .slice(0, 8)
  }, [q, ativos])

  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  const abrir = (a: AtivoBusca) => { setAberto(false); setQ(''); navigate(`/investimentos/ativos/${a.ativo_id}`) }

  return (
    <div ref={raiz} className="relative" data-tutorial="investimentos-busca">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-transparent">
        <Search size={15} style={{ color: MUTED }} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setAberto(true); setAtivoIdx(0) }}
          onFocus={() => setAberto(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAtivoIdx((i) => Math.min(i + 1, resultados.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivoIdx((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && resultados[ativoIdx]) abrir(resultados[ativoIdx])
            else if (e.key === 'Escape') setAberto(false)
          }}
          placeholder="Localizar ativo…"
          aria-label="Localizar ativo"
          className="bg-transparent text-[13px] text-white outline-none w-40 placeholder:text-white/40"
        />
      </div>
      {aberto && q.trim() && (
        <ul className="absolute right-0 z-30 mt-1 w-72 max-w-[calc(100vw-2.5rem)] rounded-lg border border-white/10 shadow-2xl overflow-hidden" style={{ background: '#0f1729' }} role="listbox">
          {resultados.length === 0 ? (
            <li className="px-3 py-2 text-[13px]" style={{ color: MUTED }}>Nenhum ativo encontrado.</li>
          ) : resultados.map((a, i) => (
            <li key={a.ativo_id} role="option" aria-selected={i === ativoIdx}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => abrir(a)} onMouseEnter={() => setAtivoIdx(i)}
                className="w-full text-left px-3 py-2 flex items-center justify-between gap-2"
                style={{ background: i === ativoIdx ? 'rgba(59,130,246,0.15)' : 'transparent' }}>
                <span className="min-w-0">
                  <span className="block text-[13px] text-white font-semibold">{a.ticker}</span>
                  <span className="block text-[12px] truncate" style={{ color: MUTED }}>{a.nome}</span>
                </span>
                <span className="text-[11px] shrink-0" style={{ color: MUTED }}>{TIPO_ATIVO_LABEL[a.tipo_ativo] ?? a.tipo_ativo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
