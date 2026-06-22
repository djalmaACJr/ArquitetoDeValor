import { useMemo } from 'react'
import { Layers, Info } from 'lucide-react'
import { setorLabel, areaAtivoLabel } from '../../lib/constants'
import { formatBRL } from '../../lib/utils'
import type { InvestimentoAtivo, InvestimentoRankingAtivo } from '../../types'

const MUTED = '#8b92a8'
// Acima deste % de uma única área, sinaliza concentração.
const LIMIAR_CONCENTRACAO = 30

const PALETA = [
  '#3b82f6', '#00c896', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#f97316', '#14b8a6', '#a3e635', '#ef4444',
]

interface Area { area: string; valor: number; ativos: { ticker: string; valor: number }[] }

export default function QuadroSobreposicao({ ativosCarteira, ativoPorId }: {
  /** Ativos com saldo > 0 (traz valor de mercado e ativo_id). */
  ativosCarteira: InvestimentoRankingAtivo[]
  /** Metadado por ativo_id (setor, categoria de FII…). */
  ativoPorId: Map<string, InvestimentoAtivo>
}) {
  const { areas, total, semSetor, concentradas } = useMemo(() => {
    const mapa = new Map<string, Area>()
    let total = 0
    let semSetor = 0
    for (const a of ativosCarteira) {
      const meta = ativoPorId.get(a.ativo_id)
      const area = areaAtivoLabel({ setor: meta?.setor, tipo: a.tipo_ativo, fii_categoria: meta?.fii_categoria })
      // Conta quantos ativos "deveriam" ter setor mas não têm (ações/stocks).
      if ((a.tipo_ativo === 'ACOES' || a.tipo_ativo === 'STOCKS') && !setorLabel(meta?.setor)) semSetor++
      total += a.valor_mercado
      const cur = mapa.get(area) ?? { area, valor: 0, ativos: [] }
      cur.valor += a.valor_mercado
      cur.ativos.push({ ticker: a.ticker, valor: a.valor_mercado })
      mapa.set(area, cur)
    }
    const areas = [...mapa.values()]
      .map((g) => ({ ...g, ativos: g.ativos.sort((x, y) => y.valor - x.valor) }))
      .sort((a, b) => b.valor - a.valor)
    const concentradas = areas.filter((g) => total > 0 && (g.valor / total) * 100 >= LIMIAR_CONCENTRACAO && g.ativos.length >= 2)
    return { areas, total, semSetor, concentradas }
  }, [ativosCarteira, ativoPorId])

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
      <h2 className="text-[13px] font-semibold text-white mb-1 flex items-center gap-1.5">
        <Layers size={15} style={{ color: '#8b5cf6' }} /> Sobreposição por área
      </h2>
      <p className="text-[12px] mb-3" style={{ color: MUTED }}>
        Quanto da carteira se acumula na mesma área (setor das ações, categoria dos FIIs,
        ou tipo). Áreas com vários ativos e fatia grande indicam concentração de risco.
      </p>

      {areas.length === 0 ? (
        <p className="text-[12.5px] py-6 text-center" style={{ color: MUTED }}>
          Nenhum ativo com valor de mercado na carteira.
        </p>
      ) : (
        <div className="space-y-3">
          {concentradas.length > 0 && (
            <div className="rounded-lg border px-3 py-2 text-[12.5px]"
              style={{ borderColor: '#ff5c7a55', background: '#ff5c7a14' }}>
              <span className="font-semibold" style={{ color: '#ff5c7a' }}>Concentração alta.</span>{' '}
              <span className="text-white/85">
                {concentradas.map((g) => `${g.area} (${((g.valor / total) * 100).toFixed(0)}%, ${g.ativos.length} ativos)`).join('; ')}.
                Vários ativos puxando para a mesma área reduzem a diversificação.
              </span>
            </div>
          )}

          <ul className="space-y-2">
            {areas.map((g, i) => {
              const pct = total > 0 ? (g.valor / total) * 100 : 0
              const cor = PALETA[i % PALETA.length]
              return (
                <li key={g.area} className="rounded-lg border border-white/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cor }} />
                      <span className="text-white/90 font-medium truncate">{g.area}</span>
                      <span className="shrink-0" style={{ color: MUTED }}>· {g.ativos.length} ativo{g.ativos.length === 1 ? '' : 's'}</span>
                    </span>
                    <span className="text-white shrink-0">{formatBRL(g.valor)} · {pct.toFixed(1).replace('.', ',')}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full overflow-hidden bg-white/10">
                    <div className="h-full" style={{ width: `${pct}%`, background: cor }} />
                  </div>
                  <p className="mt-1 text-[11px] truncate" style={{ color: MUTED }}>
                    {g.ativos.map((a) => a.ticker).join(' · ')}
                  </p>
                </li>
              )
            })}
          </ul>

          <p className="text-[11px] flex items-start gap-1" style={{ color: MUTED }}>
            <Info size={11} className="mt-0.5 shrink-0" />
            <span>
              ETFs entram como cesta diversificada (não decompostos por dentro).
              {semSetor > 0 && ` ${semSetor} ação/stock sem setor — caem no tipo; atualize os tickets para classificar melhor.`}
            </span>
          </p>
        </div>
      )}
    </section>
  )
}
