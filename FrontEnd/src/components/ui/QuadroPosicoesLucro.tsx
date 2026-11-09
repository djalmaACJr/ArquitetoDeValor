import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, ArrowUp, ArrowDown, ArrowUpRight, ArrowDownRight, Info, X } from 'lucide-react'
import { AlcaArrastar } from '../../hooks/useOrdemReordenavel'
import { formatBRL } from '../../lib/utils'
import { TIPO_ATIVO_COR } from '../../lib/constants'
import type { InvestimentoRankingAtivo } from '../../types'

const MUTED    = '#8b92a8'
const VERDE    = '#00c896'
const VERMELHO = '#ff8fa3'
const POR_PAGINA = 5

type Aba = 'lucro' | 'prejuizo'

function fmtPct(v: number): string {
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

// "Lucro"/"prejuízo" = rentabilidade TOTAL desde a compra (rentabilidade_pct),
// não a do período filtrado — a "Variação" mostra o período, a
// "Rentabilidade" mostra o acumulado. Ativo com rentabilidade 0 não entra em nenhum
// dos lados (mas conta no total "de N").
export function dividirPorResultado(ativos: InvestimentoRankingAtivo[]) {
  const lucro = ativos.filter((a) => a.rentabilidade_pct > 0)
    .sort((x, y) => y.rentabilidade_pct - x.rentabilidade_pct)
  const prejuizo = ativos.filter((a) => a.rentabilidade_pct < 0)
    .sort((x, y) => x.rentabilidade_pct - y.rentabilidade_pct)
  return { lucro, prejuizo }
}

function Pilula({ pct, cor, fundo, icone }: { pct: number; cor: string; fundo: string; icone?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap"
      style={{ color: cor, background: fundo }}>
      {fmtPct(pct)}{icone}
    </span>
  )
}

function ModalPosicoes({ lucro, prejuizo, abaInicial, origem, aoFechar }: {
  lucro: InvestimentoRankingAtivo[]; prejuizo: InvestimentoRankingAtivo[]
  abaInicial: Aba; origem: string; aoFechar: () => void
}) {
  const [aba, setAba] = useState<Aba>(abaInicial)
  const [pagina, setPagina] = useState(1)
  const lista = aba === 'lucro' ? lucro : prejuizo
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const visiveis = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [aoFechar])

  function trocarAba(a: Aba) { setAba(a); setPagina(1) }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={aoFechar}>
      <div role="dialog" aria-modal="true" aria-label="Posições no lucro"
        className="w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-xl border border-white/10 p-5"
        style={{ background: '#161b29' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <h3 className="text-[17px] font-semibold text-white">Posições no lucro</h3>
          <button type="button" onClick={aoFechar} aria-label="Fechar" style={{ color: MUTED }} className="hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-lg bg-black/25 px-4 py-3 mt-4 text-[13px] text-white/90">
          <Info size={15} className="shrink-0" />
          Consideramos a rentabilidade para fornecer a informação dos ativos no lucro e no prejuízo.
        </div>

        <div className="flex justify-center mt-4">
          <div className="inline-flex gap-1 rounded-lg bg-black/25 p-1">
            {([['lucro', `${lucro.length} no lucro`, VERDE, <ArrowUp size={13} key="u" />],
               ['prejuizo', `${prejuizo.length} no prejuízo`, VERMELHO, <ArrowDown size={13} key="d" />]] as const).map(([k, rot, cor, ic]) => (
              <button key={k} type="button" onClick={() => trocarAba(k)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] border transition-colors ${aba === k ? 'border-white/20 bg-white/10' : 'border-transparent'}`}
                style={{ color: cor }}>
                {rot}{ic}
              </button>
            ))}
          </div>
        </div>

        <table className="w-full text-[13px] mt-4">
          <thead>
            <tr style={{ color: MUTED }} className="border-y border-white/10">
              <th className="text-left font-medium py-2.5">Ativo</th>
              <th className="text-right font-medium py-2.5">Valor</th>
              <th className="text-right font-medium py-2.5">Variação</th>
              <th className="text-right font-medium py-2.5">Rentabilidade</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr><td colSpan={4} className="py-6 text-center" style={{ color: MUTED }}>Nenhuma posição aqui.</td></tr>
            ) : visiveis.map((a) => {
              const positivo = a.rentabilidade_pct > 0
              return (
                <tr key={a.ativo_id} className="border-b border-white/5">
                  <td className="py-3 pr-2">
                    <Link to={`/investimentos/ativos/${a.ativo_id}`} state={{ from: origem }} target="_blank" rel="noopener noreferrer"
                      title={a.nome || a.ticker} className="inline-flex items-center gap-2 text-white font-medium hover:underline">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[a.tipo_ativo] }} />
                      {a.ticker}
                    </Link>
                  </td>
                  <td className="py-3 text-right text-white whitespace-nowrap">{formatBRL(a.valor_mercado)}</td>
                  <td className="py-3 text-right">
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap text-white/90"
                      style={{ background: 'rgba(255,255,255,0.08)' }}>
                      {fmtPct(a.rentabilidade_periodo_pct)}
                      {a.rentabilidade_periodo_pct >= 0
                        ? <ArrowUp size={11} style={{ color: VERDE }} />
                        : <ArrowDown size={11} style={{ color: VERMELHO }} />}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <Pilula pct={a.rentabilidade_pct} cor={positivo ? VERDE : VERMELHO}
                      fundo={positivo ? 'rgba(0,200,150,0.15)' : 'rgba(255,92,122,0.2)'}
                      icone={positivo ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {totalPaginas > 1 && (
          <div className="flex justify-center mt-4">
            <div className="inline-flex rounded-lg border border-white/10 overflow-hidden text-[13px]">
              <button type="button" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}
                className="px-3 py-2 disabled:opacity-40" style={{ color: MUTED }}>Anterior</button>
              {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((p) => (
                <button key={p} type="button" onClick={() => setPagina(p)}
                  className={`px-3.5 py-2 border-l border-white/10 ${p === pagina ? 'bg-white/10 text-white' : ''}`}
                  style={p === pagina ? undefined : { color: MUTED }}>{p}</button>
              ))}
              <button type="button" disabled={pagina === totalPaginas} onClick={() => setPagina(pagina + 1)}
                className="px-3 py-2 border-l border-white/10 disabled:opacity-40 text-white">Próximo</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function QuadroPosicoesLucro({ ativos, origem, dragHandleProps, dropTargetProps, bordaClasse }: {
  ativos: InvestimentoRankingAtivo[]; origem: string
  dragHandleProps: React.HTMLAttributes<HTMLSpanElement>
  dropTargetProps: React.HTMLAttributes<HTMLDivElement>
  bordaClasse: string
}) {
  const [modal, setModal] = useState<Aba | null>(null)
  const { lucro, prejuizo } = useMemo(() => dividirPorResultado(ativos), [ativos])
  const total = ativos.length
  const pctLucro = total > 0 ? Math.round((lucro.length / total) * 100) : 0
  const larguraLucro = total > 0 ? (lucro.length / total) * 100 : 0
  const larguraPrejuizo = total > 0 ? (prejuizo.length / total) * 100 : 0

  return (
    <div data-quadro-arrastavel className={`rounded-xl bg-white/[0.02] p-4 flex flex-col transition-all duration-150 ${bordaClasse}`} {...dropTargetProps}>
      <div className="flex items-center justify-between gap-2 text-[13px]" style={{ color: MUTED }}>
        <span className="flex items-center gap-2">
          <AlcaArrastar {...dragHandleProps} />
          <TrendingUp size={14} />Posições no lucro
        </span>
        <button type="button" onClick={() => setModal('lucro')} aria-label="Ver detalhes" title="Ver detalhes" className="hover:text-white">
          <Info size={15} />
        </button>
      </div>

      <div role="button" tabIndex={0} onClick={() => setModal('lucro')}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModal('lucro') } }}
        className="cursor-pointer mt-3">
        <div className="flex items-center gap-3">
          <span className="text-[26px] font-semibold text-white">{lucro.length} <span className="font-normal">de {total}</span></span>
          <span className="rounded-full px-2.5 py-0.5 text-[13px] font-medium" style={{ color: VERDE, background: 'rgba(0,200,150,0.15)' }}>
            {pctLucro}%
          </span>
        </div>
        <div className="flex h-2.5 rounded-full overflow-hidden mt-3 bg-white/10" role="img"
          aria-label={`${lucro.length} no lucro e ${prejuizo.length} no prejuízo de ${total} posições`}>
          <div style={{ width: `${larguraLucro}%`, background: VERDE }} />
          <div style={{ width: `${larguraPrejuizo}%`, background: VERMELHO }} />
        </div>
        <div className="flex items-center justify-between mt-4 text-[13px]">
          <span className="inline-flex items-center gap-1.5" style={{ color: VERDE }}>
            {lucro.length} no lucro <TrendingUp size={13} />
          </span>
          <span className="inline-flex items-center gap-1.5" style={{ color: VERMELHO }}>
            {prejuizo.length} no prejuízo <TrendingDown size={13} />
          </span>
        </div>
      </div>

      {modal && (
        <ModalPosicoes lucro={lucro} prejuizo={prejuizo} abaInicial={modal} origem={origem} aoFechar={() => setModal(null)} />
      )}
    </div>
  )
}
