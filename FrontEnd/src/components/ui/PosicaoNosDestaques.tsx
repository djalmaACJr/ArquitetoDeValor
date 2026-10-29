import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, ChevronRight } from 'lucide-react'
import { useInvestimentosDestaques } from '../../hooks/useInvestimentosDashboard'
import {
  CHAVES_RANKING_DESTAQUE, ROTULO_RANKING_DESTAQUE, calcularRankingsDestaques, posicaoNosRankings,
} from '../../lib/destaquesRanking'
import { SelectDark } from './shared'
import { TIPO_ATIVO_LABEL } from '../../lib/constants'
import type { PeriodoRanking } from '../../types'

const MUTED = '#8b92a8'
const CORES_PODIO = ['#ffd700', '#c0c0c0', '#cd7f32']

// Mesmos períodos da página Destaques.
const PERIODOS: { value: PeriodoRanking; label: string }[] = [
  { value: 'SEMANA',    label: 'Semana' },
  { value: 'MES_ATUAL', label: 'Mês atual' },
  { value: 'MES',       label: 'Últimos 30 dias' },
  { value: 'SEMESTRE',  label: 'Semestre' },
  { value: 'ANO_ATUAL', label: `Ano ${new Date().getFullYear()}` },
  { value: 'ANO',       label: 'Últimos 12 meses' },
  { value: 'DOIS_ANOS',  label: '2 anos' },
  { value: 'CINCO_ANOS', label: '5 anos' },
  { value: 'TUDO',      label: 'Desde o início' },
]

/** Onde este ativo fica em cada ranking da página Destaques (carteira inteira, no período escolhido). */
export default function PosicaoNosDestaques({ ativoId }: { ativoId: string }) {
  const [periodo, setPeriodo] = useState<PeriodoRanking>('TUDO')
  const { destaques } = useInvestimentosDestaques(null, periodo)

  // Posição na carteira inteira e dentro do tipo do ativo (mesmas listas,
  // recortadas pelo tipo — quem não entra num ranking fica "fora" dos dois).
  const posicoes = useMemo(() => {
    const ativos = destaques?.ativos ?? []
    const atual = ativos.find((a) => a.ativo_id === ativoId)
    if (!atual) return null
    return {
      tipo: atual.tipo_ativo,
      geral: posicaoNosRankings(calcularRankingsDestaques(ativos), ativoId),
      noTipo: posicaoNosRankings(calcularRankingsDestaques(ativos.filter((a) => a.tipo_ativo === atual.tipo_ativo)), ativoId),
    }
  }, [destaques, ativoId])

  // Sem posição na carteira (ou ainda carregando pela 1ª vez): nada a mostrar.
  if (!posicoes) return null

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4" data-tutorial="detalhe-destaques">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-[12.5px] font-semibold text-white flex items-center gap-1.5">
          <Trophy size={14} style={{ color: '#f0b429' }} /> Posição nos destaques
        </h3>
        <div className="flex items-center gap-2">
          <div className="w-44">
            <SelectDark value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoRanking)}>
              {PERIODOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </SelectDark>
          </div>
          <Link to={`/investimentos/destaques?periodo=${periodo}`}
            className="text-[11.5px] inline-flex items-center gap-0.5 hover:text-white" style={{ color: MUTED }}>
            Ver destaques <ChevronRight size={12} />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-2">
        {CHAVES_RANKING_DESTAQUE.map((k) => {
          const g = posicoes.geral[k]
          const t = posicoes.noTipo[k]
          return (
            <div key={k} className="rounded-md bg-white/[0.03] px-2.5 py-2">
              <p className="text-[11px] leading-tight" style={{ color: MUTED }}>{ROTULO_RANKING_DESTAQUE[k]}</p>
              {g ? (
                <p className="mt-1 flex items-baseline gap-1" title="Posição na carteira inteira">
                  <span className="text-[16px] font-semibold" style={{ color: g.posicao <= 3 ? CORES_PODIO[g.posicao - 1] : '#fff' }}>
                    {g.posicao}º
                  </span>
                  <span className="text-[11px]" style={{ color: MUTED }}>de {g.total} na carteira</span>
                </p>
              ) : (
                <p className="mt-1 text-[12px]" style={{ color: MUTED }}>Fora do ranking</p>
              )}
              {t && (
                <p className="mt-0.5 flex items-baseline gap-1" title={`Posição entre os ativos do tipo ${TIPO_ATIVO_LABEL[posicoes.tipo]}`}>
                  <span className="text-[13px] font-semibold" style={{ color: t.posicao <= 3 ? CORES_PODIO[t.posicao - 1] : '#e5e7eb' }}>
                    {t.posicao}º
                  </span>
                  <span className="text-[11px]" style={{ color: MUTED }}>de {t.total} em {TIPO_ATIVO_LABEL[posicoes.tipo]}</span>
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
