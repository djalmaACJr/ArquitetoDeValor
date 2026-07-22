import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Doughnut } from 'react-chartjs-2'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useContas } from '../../hooks/useContas'
import { fetchDashboard, useInvestimentosRanking } from '../../hooks/useInvestimentosDashboard'
import { qk } from '../../lib/queryKeys'
import { formatBRL } from '../../lib/utils'
import { TIPO_ATIVO_LABEL } from '../../lib/constants'
import { roscaData, rotulosRosca } from '../../lib/roscaChart'
import type { TipoAtivoInvestimento } from '../../types'

const MUTED = '#8b92a8'

type Nivel =
  | { n: 0 }
  | { n: 1; contaId: string; contaNome: string }
  | { n: 2; contaId: string; contaNome: string; tipo: TipoAtivoInvestimento }

// Rosca "drill-down": Instituição → Tipo de ativo → Ativo (clique no ativo
// abre a página de detalhe — Ctrl/Cmd+clique abre em nova aba, como um link).
// Cada nível reaproveita os endpoints já existentes de dashboard/ranking
// filtrados por conta_id, então não há agregação nova no backend.
export default function ResumoPorInstituicao() {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const { contas } = useContas()
  const navigate = useNavigate()
  const [nivel, setNivel] = useState<Nivel>({ n: 0 })

  // Só contas onde investimentos fazem sentido (as demais nunca têm posição).
  const instituicoes = useMemo(
    () => contas.filter((c) => c.ativa && (c.tipo === 'INVESTIMENTO' || c.tipo === 'CARTEIRA')),
    [contas],
  )

  const dashboards = useQueries({
    queries: instituicoes.map((c) => ({
      queryKey: qk.invDashboard(uid, c.conta_id),
      queryFn: () => fetchDashboard(c.conta_id),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      enabled: !!uid,
    })),
  })
  const carregandoInstituicoes = instituicoes.length > 0 && dashboards.some((q) => q.isLoading)

  // Ativos de um tipo dentro da instituição — só busca ao chegar no nível 2.
  const { ranking, loading: carregandoRanking } = useInvestimentosRanking(nivel.n === 2 ? nivel.contaId : null)

  const fatiasInstituicoes = useMemo(() => (
    instituicoes
      .map((c, i) => ({ label: c.nome, valor: dashboards[i]?.data?.total_mercado ?? 0, contaId: c.conta_id }))
      .filter((f) => f.valor > 0)
      .sort((a, b) => b.valor - a.valor)
  ), [instituicoes, dashboards])

  const dashboardDaInstituicao = nivel.n !== 0
    ? dashboards[instituicoes.findIndex((c) => c.conta_id === nivel.contaId)]?.data ?? null
    : null

  const fatiasTipos = useMemo(() => {
    if (!dashboardDaInstituicao) return []
    return dashboardDaInstituicao.tipos
      .filter((t) => t.valor_mercado > 0)
      .map((t) => ({ label: TIPO_ATIVO_LABEL[t.tipo_ativo], valor: t.valor_mercado, tipo: t.tipo_ativo }))
      .sort((a, b) => b.valor - a.valor)
  }, [dashboardDaInstituicao])

  const fatiasAtivos = useMemo(() => {
    if (nivel.n !== 2 || !ranking) return []
    return ranking.ativos
      .filter((a) => a.tipo_ativo === nivel.tipo && a.valor_mercado > 0)
      .map((a) => ({ label: a.ticker, valor: a.valor_mercado, ativoId: a.ativo_id, nome: a.nome }))
      .sort((a, b) => b.valor - a.valor)
  }, [nivel, ranking])

  function abrirAtivo(ativoId: string, evt: unknown) {
    const url = `/investimentos/ativos/${ativoId}`
    const native = (evt as { native?: MouseEvent } | undefined)?.native
    if (native && (native.ctrlKey || native.metaKey || native.button === 1)) {
      window.open(url, '_blank')
    } else {
      navigate(url)
    }
  }

  const carregando = nivel.n === 0 ? carregandoInstituicoes : nivel.n === 2 ? carregandoRanking : false

  // Dados/rótulos/clique conforme o nível atual.
  const { fatias, centro, onClique, dica } = nivel.n === 0
    ? {
        fatias: fatiasInstituicoes,
        centro: 'Patrimônio',
        onClique: (i: number) => {
          const f = fatiasInstituicoes[i]
          setNivel({ n: 1, contaId: f.contaId, contaNome: f.label })
        },
        dica: 'Clique numa instituição para ver a composição por tipo de ativo.',
      }
    : nivel.n === 1
    ? {
        fatias: fatiasTipos,
        centro: nivel.contaNome,
        onClique: (i: number) => {
          const f = fatiasTipos[i]
          setNivel({ n: 2, contaId: nivel.contaId, contaNome: nivel.contaNome, tipo: f.tipo })
        },
        dica: 'Clique num tipo para ver os ativos dessa instituição.',
      }
    : {
        fatias: fatiasAtivos,
        centro: TIPO_ATIVO_LABEL[nivel.tipo],
        onClique: (i: number, e: unknown) => abrirAtivo(fatiasAtivos[i].ativoId, e),
        dica: 'Clique num ativo para abrir a página dele — Ctrl/Cmd+clique abre em nova aba.',
      }

  const total = fatias.reduce((s, f) => s + f.valor, 0)
  const data = roscaData(fatias, centro, formatBRL(total))

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h2 className="text-[15px] font-semibold text-white">Resumo por instituição</h2>
      </div>

      {/* Breadcrumb — cada nível anterior é clicável para voltar */}
      <div className="flex items-center gap-1 text-[12px] mb-3 flex-wrap" style={{ color: MUTED }}>
        <button onClick={() => setNivel({ n: 0 })}
          className={nivel.n === 0 ? 'text-white font-medium' : 'hover:text-white'}>
          Instituições
        </button>
        {nivel.n !== 0 && (
          <>
            <ChevronRight size={12} />
            <button onClick={() => setNivel({ n: 1, contaId: nivel.contaId, contaNome: nivel.contaNome })}
              className={nivel.n === 1 ? 'text-white font-medium' : 'hover:text-white'}>
              {nivel.contaNome}
            </button>
          </>
        )}
        {nivel.n === 2 && (
          <>
            <ChevronRight size={12} />
            <span className="text-white font-medium">{TIPO_ATIVO_LABEL[nivel.tipo]}</span>
          </>
        )}
        {nivel.n === 2 && (
          <span className="flex items-center gap-1 ml-auto" style={{ color: MUTED }}>
            <ExternalLink size={11} /> Ctrl/Cmd+clique abre em nova aba
          </span>
        )}
      </div>

      <div className="flex-1 min-h-[300px] flex items-center justify-center">
        {carregando ? (
          <p className="text-[13px]" style={{ color: MUTED }}>Carregando...</p>
        ) : fatias.length === 0 ? (
          <p className="text-[13px] text-center py-10 px-4" style={{ color: MUTED }}>
            {nivel.n === 0
              ? 'Nenhuma instituição com valor de mercado ainda.'
              : 'Nenhum ativo com valor de mercado neste grupo.'}
          </p>
        ) : (
          <Doughnut
            plugins={[rotulosRosca]}
            data={data}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              cutout: '62%',
              layout: { padding: { top: 16, bottom: 16, left: 64, right: 64 } },
              onClick: (evt, elements) => {
                if (elements.length > 0) onClique(elements[0].index, evt)
              },
              onHover: (evt, elements) => {
                const alvo = evt.native?.target as HTMLElement | null
                if (alvo) alvo.style.cursor = elements.length ? 'pointer' : 'default'
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const f = fatias[ctx.dataIndex]
                      const pct = total > 0 ? (Number(ctx.parsed) / total) * 100 : 0
                      return ` ${formatBRL(f.valor)} · ${pct.toFixed(1).replace('.', ',')}%`
                    },
                  },
                },
              },
            }}
          />
        )}
      </div>
      {fatias.length > 0 && (
        <p className="text-[11px] text-center mt-2" style={{ color: MUTED }}>{dica}</p>
      )}
    </section>
  )
}
