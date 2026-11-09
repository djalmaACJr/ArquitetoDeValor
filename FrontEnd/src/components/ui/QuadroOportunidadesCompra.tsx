import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart, ArrowRight, ArrowUpDown, Info, X } from 'lucide-react'
import { AlcaArrastar } from '../../hooks/useOrdemReordenavel'
import { calcularOportunidadesCompra, type OportunidadeCompra } from '../../lib/oportunidadesCompra'
import { formatBRL } from '../../lib/utils'
import { TIPO_ATIVO_COR } from '../../lib/constants'
import type { InvestimentoRankingAtivo, InvestimentoDashboardTipo } from '../../types'

const MUTED = '#8b92a8'
const VERDE = '#00c896'
const POR_PAGINA = 5

type ChaveOrdem = 'ticker' | 'pm' | 'pa' | 'cart' | 'sugerido'
const VALOR: Record<ChaveOrdem, (o: OportunidadeCompra) => number | string> = {
  ticker:   (o) => o.ativo.ticker,
  pm:       (o) => o.precoMedio,
  pa:       (o) => o.precoAtual,
  cart:     (o) => o.ativo.participacao_pct,
  sugerido: (o) => o.valorSugerido,
}

function ModalOportunidades({ itens, origem, aoFechar }: { itens: OportunidadeCompra[]; origem: string; aoFechar: () => void }) {
  const [pagina, setPagina] = useState(1)
  const [ordem, setOrdem] = useState<{ chave: ChaveOrdem; dir: 'asc' | 'desc' }>({ chave: 'sugerido', dir: 'desc' })

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [aoFechar])

  const ordenados = useMemo(() => {
    const f = VALOR[ordem.chave]
    return [...itens].sort((x, y) => {
      const vx = f(x), vy = f(y)
      const c = typeof vx === 'string' ? vx.localeCompare(String(vy)) : (vx as number) - (vy as number)
      return ordem.dir === 'asc' ? c : -c
    })
  }, [itens, ordem])
  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / POR_PAGINA))
  const visiveis = ordenados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const totalSugerido = itens.reduce((s, o) => s + o.valorSugerido, 0)

  function clicar(chave: ChaveOrdem) {
    setOrdem((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: chave === 'ticker' ? 'asc' : 'desc' }))
    setPagina(1)
  }
  const Th = ({ k, rot, esquerda }: { k: ChaveOrdem; rot: string; esquerda?: boolean }) => (
    <th className={`font-medium py-2.5 ${esquerda ? 'text-left' : 'text-right'}`}>
      <button type="button" onClick={() => clicar(k)} className={`inline-flex items-center gap-1 hover:text-white ${ordem.chave === k ? 'text-white' : ''}`}>
        {rot}<ArrowUpDown size={11} />
      </button>
    </th>
  )

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={aoFechar}>
      <div role="dialog" aria-modal="true" aria-label="Oportunidades de compra"
        className="w-full max-w-[760px] max-h-[90vh] overflow-y-auto rounded-xl border border-white/10 p-5"
        style={{ background: '#161b29' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <h3 className="text-[17px] font-semibold text-white">Oportunidades de compra</h3>
          <button type="button" onClick={aoFechar} aria-label="Fechar" style={{ color: MUTED }} className="hover:text-white"><X size={20} /></button>
        </div>

        <div className="flex items-center gap-3 rounded-lg bg-black/25 px-4 py-3 mt-4 text-[13px] text-white/90">
          <Info size={15} className="shrink-0" />
          Você possui {itens.length} {itens.length === 1 ? 'ativo marcado' : 'ativos marcados'} como comprar e com preço atual abaixo do seu preço médio.
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ color: MUTED }} className="border-y border-white/10">
                <Th k="ticker" rot="Ativo" esquerda />
                <Th k="pm" rot="Preço Médio" />
                <Th k="pa" rot="Preço Atual" />
                <Th k="cart" rot="% na carteira" />
                <Th k="sugerido" rot="Valor sugerido" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((o) => (
                <tr key={o.ativo.ativo_id} className="border-b border-white/5">
                  <td className="py-3 pr-2">
                    <Link to={`/investimentos/ativos/${o.ativo.ativo_id}`} state={{ from: origem }} target="_blank" rel="noopener noreferrer"
                      title={o.ativo.nome || o.ativo.ticker} className="inline-flex items-center gap-2 text-white font-medium hover:underline">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[o.ativo.tipo_ativo] }} />
                      {o.ativo.ticker}
                    </Link>
                  </td>
                  <td className="py-3 text-right text-white whitespace-nowrap">{formatBRL(o.precoMedio)}</td>
                  <td className="py-3 text-right text-white whitespace-nowrap">{formatBRL(o.precoAtual)}</td>
                  <td className="py-3 text-right text-white whitespace-nowrap">
                    {o.ativo.participacao_pct.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                  </td>
                  <td className="py-3 text-right font-medium whitespace-nowrap" style={{ color: o.valorSugerido > 0 ? VERDE : MUTED }}
                    title="Quanto falta pra este ativo chegar à sua fatia ideal da carteira (meta do tipo rateada pela nota), sem passar da meta do tipo.">
                    {o.valorSugerido > 0 ? formatBRL(o.valorSugerido) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10">
                <td colSpan={4} className="py-2.5 font-medium" style={{ color: MUTED }}>Total sugerido</td>
                <td className="py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: VERDE }}>{formatBRL(totalSugerido)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {totalPaginas > 1 && (
          <div className="flex justify-center mt-4">
            <div className="inline-flex rounded-lg border border-white/10 overflow-hidden text-[13px]">
              <button type="button" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)} className="px-3 py-2 disabled:opacity-40" style={{ color: MUTED }}>Anterior</button>
              {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((p) => (
                <button key={p} type="button" onClick={() => setPagina(p)}
                  className={`px-3.5 py-2 border-l border-white/10 ${p === pagina ? 'bg-white/10 text-white' : ''}`}
                  style={p === pagina ? undefined : { color: MUTED }}>{p}</button>
              ))}
              <button type="button" disabled={pagina === totalPaginas} onClick={() => setPagina(pagina + 1)} className="px-3 py-2 border-l border-white/10 disabled:opacity-40 text-white">Próximo</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function QuadroOportunidadesCompra({ ativos, tipos, totalCarteira, origem, dragHandleProps, dropTargetProps, bordaClasse }: {
  ativos: InvestimentoRankingAtivo[]; tipos: InvestimentoDashboardTipo[]; totalCarteira: number; origem: string
  dragHandleProps: React.HTMLAttributes<HTMLSpanElement>
  dropTargetProps: React.HTMLAttributes<HTMLDivElement>
  bordaClasse: string
}) {
  const [aberto, setAberto] = useState(false)
  const itens = useMemo(() => calcularOportunidadesCompra(ativos, tipos, totalCarteira), [ativos, tipos, totalCarteira])

  return (
    <div data-quadro-arrastavel className={`rounded-xl bg-white/[0.02] p-4 flex flex-col transition-all duration-150 ${bordaClasse}`} {...dropTargetProps}>
      <div className="flex items-center justify-between gap-2 text-[13px]" style={{ color: MUTED }}>
        <span className="flex items-center gap-2"><AlcaArrastar {...dragHandleProps} /><ShoppingCart size={14} />Oportunidades de compra</span>
        <span title="Ativos com recomendação “Comprar” (nota alta e tipo abaixo da meta) e preço atual abaixo do seu preço médio."><Info size={15} /></span>
      </div>
      <p className="text-[26px] font-semibold text-white mt-3">{itens.length} {itens.length === 1 ? 'ativo' : 'ativos'}</p>
      <button type="button" disabled={itens.length === 0} onClick={() => setAberto(true)}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-full border border-white/15 py-2.5 text-[13px] text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-default">
        Ver ativos <ArrowRight size={14} />
      </button>
      {aberto && <ModalOportunidades itens={itens} origem={origem} aoFechar={() => setAberto(false)} />}
    </div>
  )
}
