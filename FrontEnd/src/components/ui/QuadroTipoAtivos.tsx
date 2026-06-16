import { useMemo, useState, useEffect, useRef, Fragment } from 'react'
import { ChevronDown, ChevronUp, ChevronRight, TrendingUp, TrendingDown, Layers, LineChart, Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LogoAtivo, SelectDark } from './shared'
import { formatBRL } from '../../lib/utils'
import { recomendacaoCompra } from '../../lib/questionarioAtivos'
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR, setorLabel } from '../../lib/constants'
import type { AtivoLinha } from '../../lib/ativosLinha'
import type {
  InvestimentoAtivo, InvestimentoDashboardTipo, TipoAtivoInvestimento,
} from '../../types'

const MUTED = '#8b92a8'
const VERDE = '#00c896'
const VERMELHO = '#ff5c7a'

function corValor(v: number): string {
  if (v > 0) return VERDE
  if (v < 0) return VERMELHO
  return MUTED
}
function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%`
}
// Tolerante a undefined/null (ranking pode vir sem alguns campos)
const pct2 = (v: number | null | undefined) => `${(Number(v) || 0).toFixed(2).replace('.', ',')}%`
function SetaVariacao({ v, size = 11 }: { v: number; size?: number }) {
  return v >= 0 ? <TrendingUp size={size} /> : <TrendingDown size={size} />
}

const COR_REC = { COMPRAR: '#00c896', NEUTRO: '#8b92a8', AGUARDAR: '#ffb74d' } as const
const LABEL_REC = { COMPRAR: 'Comprar', NEUTRO: 'Neutro', AGUARDAR: 'Aguardar' } as const

// ── Ordenação por coluna ───────────────────────────────────────
type SortKey = 'ticker' | 'nome' | 'setor' | 'quantidade' | 'pm' | 'pa' | 'rent' | 'dy' | 'yoc' | 'saldo' | 'nota' | 'cart'
function precoMedio(l: AtivoLinha) { return l.quantidade > 0 ? l.valor_custo / l.quantidade : 0 }
function precoAtual(l: AtivoLinha) { return l.quantidade > 0 ? l.valor_mercado / l.quantidade : 0 }
function valorOrdenacao(l: AtivoLinha, k: SortKey): number | string {
  switch (k) {
    case 'ticker':     return l.ticker
    case 'nome':       return l.nome ?? ''
    case 'setor':      return setorLabel(l.setor) ?? ''
    case 'quantidade': return l.quantidade
    case 'pm':         return precoMedio(l)
    case 'pa':         return precoAtual(l)
    case 'rent':       return l.rentabilidade_pct
    case 'dy':         return Number(l.dividend_yield_pct) || 0
    case 'yoc':        return Number(l.yield_on_cost_pct) || 0
    case 'saldo':      return l.valor_mercado
    case 'nota':       return l.nota_usuario ?? -1
    case 'cart':       return l.participacao_pct
  }
}

interface AcoesAtivo {
  onPosicoes:  (a: InvestimentoAtivo) => void
  onHistorico: (a: InvestimentoAtivo) => void
  onEditar:    (a: InvestimentoAtivo) => void
}

type Dimensao = 'categoria' | 'segmento' | 'nenhum'
const DIMENSOES: { value: Dimensao; label: string }[] = [
  { value: 'categoria', label: 'Categoria' },
  { value: 'segmento',  label: 'Segmento' },
  { value: 'nenhum',    label: 'Nenhum' },
]

// ── Quadro de um tipo de ativo (cabeçalho colapsável + tabela) ──
// Componente compartilhado entre a página de Investimentos (sem ações) e
// Meus ativos (com botões Posições/Histórico/Editar via prop `acoes`).
export default function QuadroTipoAtivos({
  tipo, dados, linhas, acoes, defaultAberto = false, focoSinal,
}: {
  tipo:          TipoAtivoInvestimento
  dados:         InvestimentoDashboardTipo | null
  linhas:        AtivoLinha[]
  acoes?:        AcoesAtivo
  defaultAberto?: boolean
  focoSinal?:    number | null
}) {
  const [aberto, setAberto] = useState(defaultAberto)
  const [dim, setDim] = useState<Dimensao>('categoria')
  const [catsFechadas, setCatsFechadas] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'saldo', dir: 'desc' })
  const ref = useRef<HTMLDivElement>(null)

  const toggleCat = (cat: string) => setCatsFechadas((s) => {
    const n = new Set(s)
    if (n.has(cat)) n.delete(cat); else n.add(cat)
    return n
  })
  const clickSort = (key: SortKey) => setSort((s) =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'ticker' || key === 'setor' ? 'asc' : 'desc' })

  // Foco vindo do gráfico "Ativos na Carteira": abre e rola até o quadro
  useEffect(() => {
    if (focoSinal == null) return
    const id = requestAnimationFrame(() => {
      setAberto(true)
      requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    })
    return () => cancelAnimationFrame(id)
  }, [focoSinal])

  const cor = TIPO_ATIVO_COR[tipo]
  const ehFII = tipo === 'FII'
  const ganhoPerda = dados?.ganho_perda ?? 0
  const variacaoPct = dados && dados.valor_custo > 0 ? (dados.ganho_perda / dados.valor_custo) * 100 : 0
  const idealRef = dados && dados.percentual_ideal > 0 ? dados.desvio_pct : null

  // Agrupa as linhas pela dimensão escolhida (categoria/segmento) e ordena cada grupo
  const grupos = useMemo(() => {
    const ordenar = (lista: AtivoLinha[]) => {
      const arr = [...lista]
      arr.sort((x, y) => {
        const vx = valorOrdenacao(x, sort.key), vy = valorOrdenacao(y, sort.key)
        const cmp = typeof vx === 'string' ? vx.localeCompare(String(vy)) : (vx as number) - (vy as number)
        return sort.dir === 'asc' ? cmp : -cmp
      })
      return arr
    }
    if (dim === 'nenhum') {
      return [{ chave: '', lista: ordenar(linhas), total: linhas.reduce((s, l) => s + l.valor_mercado, 0) }]
    }
    const chaveDe = (l: AtivoLinha) =>
      dim === 'segmento' ? (setorLabel(l.setor) ?? 'Sem segmento') : (l.categoria ?? 'Sem categoria')
    const map = new Map<string, AtivoLinha[]>()
    for (const l of linhas) {
      const c = chaveDe(l)
      if (!map.has(c)) map.set(c, [])
      map.get(c)!.push(l)
    }
    return [...map.entries()]
      .map(([chave, lista]) => ({ chave, lista: ordenar(lista), total: lista.reduce((s, l) => s + l.valor_mercado, 0) }))
      .sort((a, b) => b.total - a.total)
  }, [linhas, dim, sort])

  // Só há subdivisão real se houver mais de um grupo (ou um grupo nomeado)
  const semNome = dim === 'segmento' ? 'Sem segmento' : 'Sem categoria'
  const temGrupos = dim !== 'nenhum' && (grupos.length > 1 || (grupos.length === 1 && grupos[0].chave !== semNome))

  const cols: { k: SortKey; label: string; align: 'left' | 'right' | 'center'; fii?: boolean; title?: string }[] = [
    { k: 'ticker',     label: 'Ativo',       align: 'left' },
    { k: 'nome',       label: 'Nome',        align: 'left' },
    { k: 'setor',      label: 'Segmento',    align: 'left' },
    { k: 'quantidade', label: 'Quant.',      align: 'right' },
    { k: 'pm',         label: 'Preço médio', align: 'right' },
    { k: 'pa',         label: 'Preço atual', align: 'right' },
    { k: 'rent',       label: 'Variação',    align: 'right' },
    { k: 'dy',         label: 'DY',          align: 'right', fii: true, title: 'Dividend Yield (12m)' },
    { k: 'yoc',        label: 'YoC',         align: 'right', fii: true, title: 'Yield on Cost (12m)' },
    { k: 'saldo',      label: 'Saldo',       align: 'right' },
    { k: 'nota',       label: 'Nota',        align: 'center' },
    { k: 'cart',       label: '% Cart.',     align: 'right' },
  ]
  const visiveis = cols.filter((c) => !c.fii || ehFII)
  const alinhar = (a: 'left' | 'right' | 'center') => a === 'left' ? 'text-left' : a === 'center' ? 'text-center' : 'text-right'
  // colunas visíveis + "Comprar?" + (Ações, se houver)
  const nCols = visiveis.length + 1 + (acoes ? 1 : 0)

  function LinhaAtivo({ l }: { l: AtivoLinha }) {
    const rec = recomendacaoCompra(l.nota_usuario ?? null, idealRef)
    return (
      <tr className="border-t border-white/5 hover:bg-white/[0.03]">
        <td className="px-2 py-1.5">
          <Link to={`/investimentos/ativos/${l.ativo_id}`} className="inline-flex items-center gap-2 text-white font-semibold hover:underline">
            <LogoAtivo url={l.logo_url} />{l.ticker}
          </Link>
        </td>
        <td className="px-2 py-1.5 text-left text-white/70 max-w-[220px]">
          <span className="block truncate" title={l.nome ?? ''}>
            {l.nome && l.nome.toUpperCase() !== l.ticker.toUpperCase() ? l.nome : '—'}
          </span>
          {l.contas.length > 0
            ? <span className="block text-[11px]" style={{ color: MUTED }}>{l.contas.join(', ')}</span>
            : acoes && <span className="block text-[11px]" style={{ color: '#ffb74d' }}>Sem posição em conta</span>}
        </td>
        <td className="px-2 py-1.5 text-left text-white/70">{setorLabel(l.setor) ?? '—'}</td>
        <td className="px-2 py-1.5 text-right text-white/80">{l.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
        <td className="px-2 py-1.5 text-right text-white/80">{formatBRL(precoMedio(l))}</td>
        <td className="px-2 py-1.5 text-right text-white/80">{formatBRL(precoAtual(l))}</td>
        <td className="px-2 py-1.5 text-right" style={{ color: corValor(l.rentabilidade_pct) }}>{fmtPct(l.rentabilidade_pct)}</td>
        {ehFII && <td className="px-2 py-1.5 text-right" style={{ color: l.dividend_yield_pct > 0 ? VERDE : MUTED }}>{pct2(l.dividend_yield_pct)}</td>}
        {ehFII && <td className="px-2 py-1.5 text-right text-white/70">{pct2(l.yield_on_cost_pct)}</td>}
        <td className="px-2 py-1.5 text-right text-white font-medium">{formatBRL(l.valor_mercado)}</td>
        <td className="px-2 py-1.5 text-center">
          {l.nota_usuario != null
            ? <span className="inline-block px-1.5 rounded bg-white/10 text-white text-[11px] font-semibold">{l.nota_usuario}</span>
            : <span style={{ color: MUTED }}>—</span>}
        </td>
        <td className="px-2 py-1.5 text-right text-white/80">{pct2(l.participacao_pct)}</td>
        <td className="px-2 py-1.5 text-center">
          {rec
            ? <span className="text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${COR_REC[rec.recomendacao]}22`, color: COR_REC[rec.recomendacao] }} title={rec.motivo}>{LABEL_REC[rec.recomendacao]}</span>
            : <span style={{ color: MUTED }}>—</span>}
        </td>
        {acoes && (
          <td className="px-2 py-1.5">
            <div className="flex items-center justify-end gap-1">
              <button onClick={() => l.meta && acoes.onPosicoes(l.meta)} disabled={!l.meta} title="Posições"
                className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/25 disabled:opacity-40" style={{ color: MUTED }}>
                <Layers size={13} />
              </button>
              <button onClick={() => l.meta && acoes.onHistorico(l.meta)} disabled={!l.meta} title="Valor de mercado"
                className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/25 disabled:opacity-40" style={{ color: MUTED }}>
                <LineChart size={13} />
              </button>
              <button onClick={() => l.meta && acoes.onEditar(l.meta)} disabled={!l.meta} title="Editar"
                className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/25 disabled:opacity-40" style={{ color: MUTED }}>
                <Pencil size={13} />
              </button>
            </div>
          </td>
        )}
      </tr>
    )
  }

  return (
    <div ref={ref} className="rounded-xl border border-white/10 bg-white/[0.02] scroll-mt-4">
      <button onClick={() => setAberto(!aberto)} className="w-full px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 items-center text-left">
        {/* Tipo + contagem */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cor }} />
          <div className="min-w-0">
            <p className="font-semibold text-[15px]" style={{ color: cor }}>{TIPO_ATIVO_LABEL[tipo]}</p>
            <p className="text-[12px]" style={{ color: MUTED }}>{linhas.length} {linhas.length === 1 ? 'Ativo' : 'Ativos'}</p>
          </div>
        </div>

        {/* Variação total */}
        <div className="text-right md:text-center">
          <p className="text-[12px] inline-flex items-center gap-1" style={{ color: corValor(ganhoPerda) }}>
            <SetaVariacao v={ganhoPerda} size={11} /> Variação Total
          </p>
          <p className="text-[13px] font-medium" style={{ color: corValor(ganhoPerda) }}>
            {dados ? `${fmtPct(variacaoPct)} (${formatBRL(ganhoPerda)})` : '—'}
          </p>
        </div>

        {/* Dividendos do tipo */}
        <div className="hidden md:block text-center">
          <p className="text-[12px]" style={{ color: MUTED }}>Dividendos</p>
          <p className="text-[13px] font-medium" style={{ color: dados && dados.dividendos > 0 ? VERDE : MUTED }}>
            {dados ? formatBRL(dados.dividendos) : '—'}
          </p>
        </div>

        {/* Valor + participação */}
        <div className="flex items-center justify-end gap-2">
          <div className="text-right">
            <p className="text-[13px] font-semibold text-white">{dados ? formatBRL(dados.valor_mercado) : '—'}</p>
            {dados && (
              <div className="flex items-center gap-1.5 justify-end">
                <div className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, dados.percentual_atual)}%`, background: cor }} />
                </div>
                <span className="text-[12px] font-semibold text-white">{dados.percentual_atual.toFixed(2).replace('.', ',')}%</span>
              </div>
            )}
          </div>
          {aberto ? <ChevronUp size={15} style={{ color: MUTED }} /> : <ChevronDown size={15} style={{ color: MUTED }} />}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-white/5 px-4 py-3 space-y-3">
          {/* Alocação atual × meta */}
          {dados && dados.percentual_ideal > 0 && (
            <div>
              <div className="flex justify-between text-[12px] mb-1" style={{ color: MUTED }}>
                <span>Alocação atual {dados.percentual_atual}%</span>
                <span>Meta {dados.percentual_ideal}%
                  <span style={{ color: corValor(-dados.desvio_pct) }}> ({dados.desvio_pct >= 0 ? '+' : ''}{dados.desvio_pct}%)</span>
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="absolute inset-y-0 left-0 rounded-full"
                     style={{ width: `${Math.min(100, dados.percentual_atual)}%`, background: cor }} />
                <div className="absolute inset-y-0 w-0.5 bg-white/70"
                     style={{ left: `${Math.min(100, dados.percentual_ideal)}%` }} title={`Meta ${dados.percentual_ideal}%`} />
              </div>
            </div>
          )}

          {linhas.length === 0 ? (
            <p className="text-[13px] text-center py-2" style={{ color: MUTED }}>Nenhum ativo neste tipo.</p>
          ) : (
            <>
              {/* Seletor de agrupamento */}
              <div className="flex justify-end items-center gap-2">
                <span className="text-[12px]" style={{ color: MUTED }}>Agrupar por</span>
                <SelectDark value={dim} onChange={(e) => setDim(e.target.value as Dimensao)}
                  style={{ width: 'auto' }} className="!text-[12px] !py-1.5">
                  {DIMENSOES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </SelectDark>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[12px]" style={{ minWidth: ehFII ? 980 : 860 }}>
                  <thead>
                    <tr style={{ color: MUTED }}>
                      {visiveis.map((c) => (
                        <th key={c.k} title={c.title} onClick={() => clickSort(c.k)}
                          className={`px-2 py-1.5 font-medium cursor-pointer select-none hover:text-white/80 ${alinhar(c.align)}`}>
                          {c.label}{sort.key === c.k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 font-medium text-center">Comprar?</th>
                      {acoes && <th className="px-2 py-1.5 font-medium text-right">Ações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {grupos.map((g) => {
                      const catAberta = !temGrupos || !catsFechadas.has(g.chave)
                      return (
                        <Fragment key={g.chave || '__flat__'}>
                          {temGrupos && (
                            <tr className="border-t border-white/[0.03] cursor-pointer hover:bg-white/[0.02]" onClick={() => toggleCat(g.chave)}>
                              <td colSpan={nCols} className="px-2 py-1.5">
                                <span className="inline-flex items-center gap-2">
                                  {catAberta ? <ChevronDown size={12} style={{ color: MUTED }} /> : <ChevronRight size={12} style={{ color: MUTED }} />}
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: cor }} />
                                  <span className="text-[13px] font-semibold" style={{ color: '#c5cad8' }}>{g.chave}</span>
                                  <span className="text-[12px]" style={{ color: MUTED }}>· {g.lista.length}</span>
                                  <span className="text-[12px] ml-2" style={{ color: '#e8eaf0' }}>{formatBRL(g.total)}</span>
                                </span>
                              </td>
                            </tr>
                          )}
                          {catAberta && g.lista.map((l) => <LinhaAtivo key={l.ativo_id} l={l} />)}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
