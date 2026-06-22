import { useMemo, useState } from 'react'
import { Activity, ChevronDown } from 'lucide-react'
import { TIPO_ATIVO_COR, areaAtivoLabel } from '../../lib/constants'
import type { InvestimentoAtivo, InvestimentoHistoricoMensal, InvestimentoRankingAtivo } from '../../types'

const MUTED = '#8b92a8'
// Mínimo de meses em comum para o par ter correlação significativa.
const MIN_MESES = 4
// Tipos sem correlação útil de mercado (preço "anda" pelo indexador, não pelo
// mercado) — ficam fora do cálculo.
const TIPOS_EXCLUIDOS = new Set(['RENDA_FIXA', 'TESOURO_DIRETO'])

// Correlação de Pearson entre dois vetores alinhados. Retorna null se algum
// vetor for constante (desvio-padrão zero → correlação indefinida).
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

// Cor do par pela correlação: verde (negativa, diversifica) → neutro →
// vermelho (positiva forte, redundância). null = cinza (sem dados).
function corCorrelacao(r: number | null): string {
  if (r == null) return 'rgba(255,255,255,0.04)'
  if (r >= 0) return `rgba(255,92,122,${(0.12 + r * 0.55).toFixed(3)})`
  return `rgba(0,200,150,${(0.12 + Math.abs(r) * 0.5).toFixed(3)})`
}

function rotuloForca(r: number): string {
  const a = Math.abs(r)
  const grau = a >= 0.7 ? 'forte' : a >= 0.4 ? 'moderada' : 'fraca'
  return r >= 0 ? `positiva ${grau}` : `negativa ${grau}`
}

const fmtR = (r: number) => r.toFixed(2).replace('.', ',')

interface Par { aId: string; bId: string; aTk: string; bTk: string; r: number; n: number }

export default function QuadroCorrelacao({ historico, ativosCarteira, ativoPorId }: {
  historico: InvestimentoHistoricoMensal[]
  /** Ativos com saldo > 0 (define quais entram e a ordem/cor dos rótulos). */
  ativosCarteira: InvestimentoRankingAtivo[]
  /** Metadado por ativo_id (setor, categoria de FII…) — usado no filtro de setor. */
  ativoPorId: Map<string, InvestimentoAtivo>
}) {
  const [aberto, setAberto] = useState(false)         // recolhido por padrão
  const [filtroAtivo, setFiltroAtivo] = useState('')  // ativo_id | ''
  const [filtroSetor, setFiltroSetor] = useState('')  // rótulo de área | ''
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null)

  const { ativos, corr, pares, mediaSign, areaDe } = useMemo(() => {
    // Série de retornos mensais por ativo (mes_ano → variação %).
    const serie = new Map<string, Map<string, number>>()
    for (const h of historico) {
      if (!h.ativo_id) continue
      const m = serie.get(h.ativo_id) ?? new Map<string, number>()
      m.set(h.mes_ano, Number(h.variacao_percentual))
      serie.set(h.ativo_id, m)
    }
    // Carteira (saldo>0), sem renda fixa/tesouro, com histórico mínimo.
    const ativos = ativosCarteira.filter((a) =>
      !TIPOS_EXCLUIDOS.has(a.tipo_ativo) && (serie.get(a.ativo_id)?.size ?? 0) >= MIN_MESES)

    const areaDe = (id: string): string => {
      const r = ativos.find((a) => a.ativo_id === id)
      const meta = ativoPorId.get(id)
      return r ? areaAtivoLabel({ setor: meta?.setor, tipo: r.tipo_ativo, fii_categoria: meta?.fii_categoria }) : '—'
    }

    // Matriz de correlação como mapa aId → bId → {r,n}.
    const corr = new Map<string, Map<string, { r: number | null; n: number }>>()
    for (const a of ativos) corr.set(a.ativo_id, new Map())
    const pares: Par[] = []
    for (let i = 0; i < ativos.length; i++) {
      for (let j = i + 1; j < ativos.length; j++) {
        const sa = serie.get(ativos[i].ativo_id)!, sb = serie.get(ativos[j].ativo_id)!
        const xs: number[] = [], ys: number[] = []
        for (const [mes, v] of sa) { const vb = sb.get(mes); if (vb != null) { xs.push(v); ys.push(vb) } }
        const r = xs.length >= MIN_MESES ? pearson(xs, ys) : null
        corr.get(ativos[i].ativo_id)!.set(ativos[j].ativo_id, { r, n: xs.length })
        corr.get(ativos[j].ativo_id)!.set(ativos[i].ativo_id, { r, n: xs.length })
        if (r != null) pares.push({ aId: ativos[i].ativo_id, bId: ativos[j].ativo_id, aTk: ativos[i].ticker, bTk: ativos[j].ticker, r, n: xs.length })
      }
    }
    const mediaSign = pares.length ? pares.reduce((s, p) => s + p.r, 0) / pares.length : null
    return { ativos, corr, pares, mediaSign, areaDe }
  }, [historico, ativosCarteira, ativoPorId])

  // Setores presentes (para o filtro).
  const setores = useMemo(() => {
    const s = new Set(ativos.map((a) => areaDe(a.ativo_id)))
    return [...s].sort()
  }, [ativos, areaDe])

  // Resumo (sempre visível): diversificação + pares mais correlatos / melhor hedge.
  const resumo = useMemo(() => {
    if (mediaSign == null || pares.length === 0) return null
    const label = mediaSign >= 0.6 ? 'Pouco diversificada' : mediaSign >= 0.3 ? 'Diversificação moderada' : 'Bem diversificada'
    const cor = mediaSign >= 0.6 ? '#ff5c7a' : mediaSign >= 0.3 ? '#f0b429' : '#00c896'
    const topPos = [...pares].sort((a, b) => b.r - a.r).slice(0, 3)
    const maisNeg = [...pares].sort((a, b) => a.r - b.r)[0]
    return { label, cor, topPos, maisNeg: maisNeg && maisNeg.r < 0 ? maisNeg : null }
  }, [pares, mediaSign])

  // Ativos exibidos no mapa conforme o filtro de setor.
  const ativosVis = useMemo(
    () => (filtroSetor ? ativos.filter((a) => areaDe(a.ativo_id) === filtroSetor) : ativos),
    [ativos, filtroSetor, areaDe],
  )

  // Quando um ativo é escolhido: lista das correlações dele com os demais.
  const foco = useMemo(() => {
    if (!filtroAtivo) return null
    const base = ativos.find((a) => a.ativo_id === filtroAtivo)
    if (!base) return null
    const linha = corr.get(filtroAtivo)
    const itens = ativos
      .filter((a) => a.ativo_id !== filtroAtivo)
      .map((a) => ({ ticker: a.ticker, tipo: a.tipo_ativo, ...(linha?.get(a.ativo_id) ?? { r: null, n: 0 }) }))
      .sort((x, y) => (y.r ?? -2) - (x.r ?? -2))
    return { base, itens }
  }, [filtroAtivo, ativos, corr])

  if (ativos.length < 2) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
        <h2 className="text-[13px] font-semibold text-white mb-1 flex items-center gap-1.5">
          <Activity size={15} style={{ color: '#8b5cf6' }} /> Correlação entre ativos
        </h2>
        <p className="text-[12.5px]" style={{ color: MUTED }}>
          Registre o valor de mercado mensal de ao menos 2 ativos (fora renda fixa) por ~{MIN_MESES} meses para calcular a correlação.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
      {/* Cabeçalho clicável (recolhe/expande) */}
      <button onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <h2 className="text-[13px] font-semibold text-white flex items-center gap-1.5">
          <Activity size={15} style={{ color: '#8b5cf6' }} /> Correlação entre ativos
          {resumo && <span className="font-normal text-[11.5px]" style={{ color: resumo.cor }}>· {resumo.label}</span>}
        </h2>
        <ChevronDown size={16} style={{ color: MUTED }} className={`transition-transform shrink-0 ${aberto ? '' : '-rotate-90'}`} />
      </button>

      {/* Resumo sempre visível */}
      {resumo && (
        <div className="mt-2 space-y-1.5">
          {resumo.topPos.length > 0 && (
            <div className="text-[12px]">
              <span className="font-medium text-white/80">Mais correlatos: </span>
              {resumo.topPos.map((p, i) => (
                <span key={`${p.aId}-${p.bId}`} style={{ color: MUTED }}>
                  {i > 0 && ' · '}
                  <span style={{ color: corNotaR(p.r) }}>{p.aTk}×{p.bTk} {fmtR(p.r)}</span>
                </span>
              ))}
            </div>
          )}
          {resumo.maisNeg && (
            <div className="text-[12px]">
              <span className="font-medium text-white/80">Melhor proteção: </span>
              <span style={{ color: '#00c896' }}>{resumo.maisNeg.aTk}×{resumo.maisNeg.bTk} {fmtR(resumo.maisNeg.r)}</span>
              <span style={{ color: MUTED }}> (se equilibram)</span>
            </div>
          )}
        </div>
      )}

      {aberto && (
        <div className="mt-3 space-y-3">
          {/* O que é + como ler */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px]" style={{ color: MUTED }}>
            <p><span className="font-semibold text-white/85">O que é:</span> mede se dois ativos sobem e descem juntos, pela variação mensal do valor de mercado. Vai de <span style={{ color: '#ff5c7a' }}>−1</span> a <span style={{ color: '#00c896' }}>+1</span>.</p>
            <p className="mt-1">
              <span style={{ color: '#ff5c7a' }}>+1</span> = andam idênticos (mesmo risco, pouca diversificação);{' '}
              <span className="text-white/70">0</span> = independentes;{' '}
              <span style={{ color: '#00c896' }}>−1</span> = opostos (um protege o outro). “·” = menos de {MIN_MESES} meses em comum.
            </p>
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12.5px] text-white outline-none focus:border-white/25">
              <option value="">Todos os setores</option>
              {setores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filtroAtivo} onChange={(e) => setFiltroAtivo(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12.5px] text-white outline-none focus:border-white/25">
              <option value="">Todos os ativos (mapa)</option>
              {[...ativos].sort((a, b) => a.ticker.localeCompare(b.ticker)).map((a) => (
                <option key={a.ativo_id} value={a.ativo_id}>{a.ticker}</option>
              ))}
            </select>
            {(filtroSetor || filtroAtivo) && (
              <button onClick={() => { setFiltroSetor(''); setFiltroAtivo('') }}
                className="text-[12px] px-2 py-1.5 rounded-lg border border-white/10 text-white/80 hover:border-white/25">
                Limpar
              </button>
            )}
          </div>

          {/* Visão focada num ativo (lista ranqueada) OU mapa de calor */}
          {foco ? (
            <div>
              <p className="text-[12px] mb-2" style={{ color: MUTED }}>
                Correlação de <span className="font-semibold text-white/90">{foco.base.ticker}</span> com os demais ativos:
              </p>
              <ul className="space-y-1">
                {foco.itens.map((it) => (
                  <li key={it.ticker} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px]">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[it.tipo] }} />
                      <span className="text-white/90 truncate">{it.ticker}</span>
                    </span>
                    <span className="shrink-0 flex items-center gap-2">
                      {it.r == null
                        ? <span style={{ color: MUTED }}>· {it.n}m</span>
                        : <>
                            <span style={{ color: MUTED }} className="text-[11px]">{rotuloForca(it.r)}</span>
                            <span className="font-semibold w-10 text-right" style={{ color: corNotaR(it.r) }}>{fmtR(it.r)}</span>
                          </>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Heatmap ativos={ativosVis} corr={corr} hover={hover} setHover={setHover} />
          )}
        </div>
      )}
    </section>
  )
}

// Cor do número da correlação (texto).
function corNotaR(r: number): string {
  if (r >= 0.4) return '#ff8fa3'
  if (r <= -0.2) return '#00c896'
  return '#c5cad8'
}

function Heatmap({ ativos, corr, hover, setHover }: {
  ativos: InvestimentoRankingAtivo[]
  corr: Map<string, Map<string, { r: number | null; n: number }>>
  hover: { i: number; j: number } | null
  setHover: (h: { i: number; j: number } | null) => void
}) {
  if (ativos.length < 2) {
    return <p className="text-[12.5px] py-4 text-center" style={{ color: MUTED }}>Menos de 2 ativos neste filtro.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="sticky left-0 bg-[#0e1525] z-10" />
            {ativos.map((a) => (
              <th key={a.ativo_id} className="px-1 pb-1 align-bottom">
                <span className="block text-[10.5px] font-medium text-white/80 whitespace-nowrap"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 70 }}>{a.ticker}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ativos.map((a, i) => (
            <tr key={a.ativo_id}>
              <th className="sticky left-0 bg-[#0e1525] z-10 pr-2 text-right">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white/85 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[a.tipo_ativo] }} />
                  {a.ticker}
                </span>
              </th>
              {ativos.map((b, j) => {
                const cell = i === j ? { r: 1, n: 0 } : (corr.get(a.ativo_id)?.get(b.ativo_id) ?? { r: null, n: 0 })
                const r = cell.r
                const isHover = hover?.i === i && hover?.j === j
                return (
                  <td key={b.ativo_id}
                    onMouseEnter={() => setHover({ i, j })} onMouseLeave={() => setHover(null)}
                    title={i === j ? `${a.ticker} (próprio)` : r == null ? `${a.ticker} × ${b.ticker}: histórico insuficiente (${cell.n}m)` : `${a.ticker} × ${b.ticker}: ${fmtR(r)} (${rotuloForca(r)}, ${cell.n}m)`}
                    className="w-8 h-8 text-center align-middle rounded"
                    style={{ background: i === j ? 'rgba(139,92,246,0.25)' : corCorrelacao(r), outline: isHover ? '1px solid rgba(255,255,255,0.5)' : 'none' }}>
                    <span className="text-[10px] font-semibold" style={{ color: r == null ? MUTED : '#fff' }}>
                      {i === j ? '1' : r == null ? '·' : r.toFixed(1).replace('.', ',')}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
