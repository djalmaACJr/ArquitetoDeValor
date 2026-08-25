import { useMemo, useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronRight, TrendingUp, TrendingDown, Layers, LineChart, Pencil } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { LogoAtivo, SelectDark } from './shared'
import { formatBRL, formatData } from '../../lib/utils'
import { recomendacaoCompra } from '../../lib/questionarioAtivos'
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR, setorLabel, INDEXADOR_RF_LABEL, INDICE_RF_LABEL } from '../../lib/constants'
import type { AtivoLinha } from '../../lib/ativosLinha'
import type {
  InvestimentoAtivo, InvestimentoDashboardTipo, TipoAtivoInvestimento,
} from '../../types'

const MUTED = '#8b92a8'
const VERDE = '#00c896'
const VERMELHO = '#ff5c7a'
// Fundo opaco do cabeçalho de grupo (sticky) — aproxima o card sobre o fundo
// escuro da app, para as linhas não vazarem por baixo ao rolar.
const HEADER_BG = '#121a2c'

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
type SortKey = 'ticker' | 'nome' | 'setor' | 'categoria' | 'quantidade' | 'pm' | 'pa' | 'rent' | 'dy' | 'yoc' | 'saldo' | 'nota' | 'cart' | 'venc' | 'indexador' | 'taxa' | 'instituicao'
function precoMedio(l: AtivoLinha) { return l.quantidade > 0 ? l.valor_custo / l.quantidade : 0 }
function precoAtual(l: AtivoLinha) { return l.quantidade > 0 ? l.valor_mercado / l.quantidade : 0 }
function valorOrdenacao(l: AtivoLinha, k: SortKey): number | string {
  switch (k) {
    case 'ticker':     return l.ticker
    case 'nome':       return l.nome ?? ''
    case 'setor':      return setorLabel(l.setor) ?? ''
    case 'categoria':  return l.categoria ?? ''
    case 'quantidade': return l.quantidade
    case 'pm':         return precoMedio(l)
    case 'pa':         return precoAtual(l)
    case 'rent':       return l.rentabilidade_pct
    case 'dy':         return Number(l.dividend_yield_pct) || 0
    case 'yoc':        return Number(l.yield_on_cost_pct) || 0
    case 'saldo':      return l.valor_mercado
    case 'nota':       return l.nota_usuario ?? -1
    case 'cart':       return l.participacao_pct
    case 'venc':       return l.meta?.rf_vencimento ?? ''  // ISO yyyy-mm-dd ordena lexicalmente
    case 'indexador':  return rfIndexadorLabel(l) ?? ''
    case 'taxa':       return l.meta?.rf_taxa ?? ''
    case 'instituicao': return l.contas.join(', ')
  }
}

// Indexador de um título de RF: "Pós-fixado · CDI", "Híbrido · IPCA", "Prefixado".
function rfIndexadorLabel(l: AtivoLinha): string | null {
  const ix = l.meta?.rf_indexador
  if (!ix) return null
  const indice = l.meta?.rf_indice
  return indice ? `${INDEXADOR_RF_LABEL[ix]} · ${INDICE_RF_LABEL[indice]}` : INDEXADOR_RF_LABEL[ix]
}

interface AcoesAtivo {
  onPosicoes:  (a: InvestimentoAtivo) => void
  onHistorico: (a: InvestimentoAtivo) => void
  onEditar:    (a: InvestimentoAtivo) => void
}

export type Dimensao = 'categoria' | 'segmento' | 'nenhum'
const DIMENSOES: { value: Dimensao; label: string }[] = [
  { value: 'categoria', label: 'Categoria' },
  { value: 'segmento',  label: 'Segmento' },
  { value: 'nenhum',    label: 'Nenhum' },
]

// ── Quadro de um tipo de ativo (cabeçalho colapsável + tabela) ──
// Componente compartilhado entre a página de Investimentos (sem ações) e
// Meus ativos (com botões Posições/Histórico/Editar via prop `acoes`).
export default function QuadroTipoAtivos({
  tipo, dados, linhas, acoes, defaultAberto = false, focoSinal, focoGrupo, alca, totalCarteira,
}: {
  tipo:          TipoAtivoInvestimento
  dados:         InvestimentoDashboardTipo | null
  linhas:        AtivoLinha[]
  acoes?:        AcoesAtivo
  defaultAberto?: boolean
  focoSinal?:    number | null
  // Quando informado, o foco realça apenas este agrupamento (a fatia da rosca
  // que originou o gráfico). Sem ele, o realce recai sobre o quadro inteiro.
  focoGrupo?:    { dim: Dimensao; chave: string } | null
  // Alça de arrastar (ex.: AlcaArrastar de useOrdemReordenavel) — renderizada
  // DENTRO do cabeçalho do quadro, antes do indicador de tipo. Opcional: só
  // quem envolve este componente numa lista reordenável passa.
  alca?:         ReactNode
  // Valor de mercado da carteira INTEIRA (não só deste tipo) — necessário só
  // pra mostrar "R$ faltando pra bater a meta" no cabeçalho recolhido.
  totalCarteira?: number
}) {
  const location = useLocation()
  // Origem para o botão "voltar" da página de detalhe — preserva de qual página
  // (Meus ativos, Investimentos, …) o usuário abriu o ativo.
  const origem = location.pathname + location.search
  const [aberto, setAberto] = useState(defaultAberto)
  // FII vem por padrão sem agrupamento — os demais tipos agrupam por
  // categoria por padrão (o usuário ainda pode trocar via o seletor).
  const [dim, setDim] = useState<Dimensao>(tipo === 'FII' ? 'nenhum' : 'categoria')
  const [catsFechadas, setCatsFechadas] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'saldo', dir: 'desc' })
  const [destaque, setDestaque] = useState(false)
  // null = realça o quadro todo; string = realça só aquele agrupamento
  const [destaqueChave, setDestaqueChave] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // tbody do agrupamento realçado — alvo do scroll quando o foco é por grupo
  const grupoRef = useRef<HTMLTableSectionElement>(null)
  // payload do foco lido dentro do effect sem re-disparar a cada render
  const focoGrupoRef = useRef(focoGrupo)
  useEffect(() => { focoGrupoRef.current = focoGrupo })

  const toggleCat = (cat: string) => setCatsFechadas((s) => {
    const n = new Set(s)
    if (n.has(cat)) n.delete(cat); else n.add(cat)
    return n
  })
  const clickSort = (key: SortKey) => setSort((s) =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'ticker' || key === 'setor' || key === 'categoria' || key === 'venc' || key === 'nome' || key === 'indexador' || key === 'taxa' ? 'asc' : 'desc' })

  // Foco vindo do gráfico (rosca): abre, rola até o quadro e o destaca por
  // alguns instantes (anel/glow) para o usuário se localizar na listagem.
  useEffect(() => {
    if (focoSinal == null) return
    const id = requestAnimationFrame(() => {
      setAberto(true)
      const fg = focoGrupoRef.current
      if (fg) {
        setDim(fg.dim)
        setDestaqueChave(fg.chave)
        setCatsFechadas((s) => { const n = new Set(s); n.delete(fg.chave); return n })
      } else {
        setDestaqueChave(null)
      }
      setDestaque(true)
    })
    const t = setTimeout(() => setDestaque(false), 2200)
    return () => { cancelAnimationFrame(id); clearTimeout(t) }
  }, [focoSinal])

  // Posiciona na tela o alvo do foco — o agrupamento realçado, quando há um;
  // senão, o quadro inteiro. Centraliza se couber na tela; se for mais alto que
  // a viewport, alinha ao topo (deixando uma folga) para começar pelo início.
  useEffect(() => {
    if (!destaque) return
    const id = requestAnimationFrame(() => {
      const alvo = grupoRef.current ?? ref.current
      if (!alvo) return
      const cabe = alvo.getBoundingClientRect().height <= window.innerHeight - 100
      alvo.scrollIntoView({ behavior: 'smooth', block: cabe ? 'center' : 'start' })
    })
    return () => cancelAnimationFrame(id)
  }, [destaque, destaqueChave])

  const cor = TIPO_ATIVO_COR[tipo]
  const ehFII = tipo === 'FII'
  // Mesmo critério de DetalheInvestimentoPage (podeDividendos): renda fixa,
  // Tesouro e cripto não pagam dividendo de verdade — o campo sempre vem
  // zerado do backend (inv_dividendos não tem linha pra esses tipos).
  const mostraDividendos = !['RENDA_FIXA', 'TESOURO_DIRETO', 'CRIPTOMOEDAS'].includes(tipo)
  const ganhoPerda = dados?.ganho_perda ?? 0
  const variacaoPct = dados && dados.valor_custo > 0 ? (dados.ganho_perda / dados.valor_custo) * 100 : 0
  const idealRef = dados && dados.percentual_ideal > 0 ? dados.desvio_pct : null

  // DY/YoC médios do quadro (só FII) — ponderados por valor de mercado/custo,
  // não é a média simples dos %: um FII pequeno com DY alto não pode pesar
  // igual a um FII grande. Equivale a Σdividendos_12m ÷ Σvalor, sem precisar
  // do valor bruto do dividendo (só temos o % pronto em cada linha).
  const dyYocMedio = useMemo(() => {
    if (!ehFII) return null
    const somaMercado = linhas.reduce((s, l) => s + l.valor_mercado, 0)
    const somaCusto   = linhas.reduce((s, l) => s + l.valor_custo, 0)
    return {
      dy:  somaMercado > 0 ? linhas.reduce((s, l) => s + l.dividend_yield_pct * l.valor_mercado, 0) / somaMercado : 0,
      yoc: somaCusto   > 0 ? linhas.reduce((s, l) => s + l.yield_on_cost_pct  * l.valor_custo,   0) / somaCusto   : 0,
    }
  }, [ehFII, linhas])

  // Agrupamentos que fazem sentido para estas linhas: só oferece "Categoria"
  // se algum ativo tiver categoria, e "Segmento" se algum tiver setor — assim
  // Renda Fixa/Cripto/ETF não exibem dimensões vazias. "Nenhum" sempre vale.
  const temCategoria = useMemo(() => linhas.some((l) => l.categoria), [linhas])
  // FII não oferece "Segmento": o setor dos FIIs vem incorreto (preenchido com
  // a categoria), então agrupar por ele apenas duplicaria o agrupamento por categoria.
  const temSegmento  = useMemo(() => !ehFII && linhas.some((l) => setorLabel(l.setor)), [linhas, ehFII])
  const dimsDisponiveis = useMemo<Dimensao[]>(() => {
    const arr: Dimensao[] = []
    if (temCategoria) arr.push('categoria')
    if (temSegmento)  arr.push('segmento')
    arr.push('nenhum')
    return arr
  }, [temCategoria, temSegmento])
  // Dimensão efetiva: a escolhida, se disponível; senão a primeira que fizer
  // sentido (ou "nenhum"). Mantém o estado intacto sem precisar de setState.
  const dimEf: Dimensao = dimsDisponiveis.includes(dim) ? dim : dimsDisponiveis[0]

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
    if (dimEf === 'nenhum') {
      return [{ chave: '', lista: ordenar(linhas), total: linhas.reduce((s, l) => s + l.valor_mercado, 0) }]
    }
    const chaveDe = (l: AtivoLinha) =>
      dimEf === 'segmento' ? (setorLabel(l.setor) ?? 'Sem segmento') : (l.categoria ?? 'Sem categoria')
    const map = new Map<string, AtivoLinha[]>()
    for (const l of linhas) {
      const c = chaveDe(l)
      if (!map.has(c)) map.set(c, [])
      map.get(c)!.push(l)
    }
    return [...map.entries()]
      .map(([chave, lista]) => ({ chave, lista: ordenar(lista), total: lista.reduce((s, l) => s + l.valor_mercado, 0) }))
      .sort((a, b) => b.total - a.total)
  }, [linhas, dimEf, sort])

  // Só há subdivisão real se houver mais de um grupo (ou um grupo nomeado)
  const semNome = dimEf === 'segmento' ? 'Sem segmento' : 'Sem categoria'
  const temGrupos = dimEf !== 'nenhum' && (grupos.length > 1 || (grupos.length === 1 && grupos[0].chave !== semNome))

  const ehRF = tipo === 'RENDA_FIXA' || tipo === 'TESOURO_DIRETO'
  const alinhar = (a: 'left' | 'right' | 'center') => a === 'left' ? 'text-left' : a === 'center' ? 'text-center' : 'text-right'

  // Coluna como descritor: cabeçalho + célula (render). Permite montar conjuntos
  // diferentes por tipo de ativo — RF/Tesouro exibe Indexador/Taxa/Vencimento e
  // esconde Ticker/Segmento (irrelevantes); ações mantêm o layout clássico
  // (ticker, segmento, preços) e FIIs idem mas sem Segmento (o dado de setor
  // dos FIIs vem incorreto — preenchido com a categoria — então é omitido).
  type Coluna = {
    id: string; label: string; align: 'left' | 'right' | 'center'
    sortKey?: SortKey; title?: string; cell: (l: AtivoLinha) => ReactNode
  }
  const traco = <span style={{ color: MUTED }}>—</span>
  const linkAtivo = (l: AtivoLinha, texto: ReactNode) => (
    <Link to={`/investimentos/ativos/${l.ativo_id}`} state={{ from: origem }}
      className="inline-flex items-center gap-2 text-white font-semibold hover:underline">
      <LogoAtivo url={l.logo_url} />{texto}
    </Link>
  )
  const celNome = (l: AtivoLinha): ReactNode => (
    <>
      <span className="block truncate max-w-[220px]" title={l.nome ?? ''}>
        {l.nome && l.nome.toUpperCase() !== l.ticker.toUpperCase() ? l.nome : '—'}
      </span>
      {l.contas.length > 0
        ? <span className="block text-[11px]" style={{ color: MUTED }}>{l.contas.join(', ')}</span>
        : acoes && <span className="block text-[11px]" style={{ color: '#ffb74d' }}>Sem posição em conta</span>}
    </>
  )
  const C: Record<string, Coluna> = {
    ticker: { id: 'ticker', label: 'Ativo', align: 'left', sortKey: 'ticker', cell: (l) => linkAtivo(l, l.ticker) },
    nome:   { id: 'nome', label: 'Nome', align: 'left', sortKey: 'nome', cell: celNome },
    // RF: identificador é o nome do título (não há ticker útil), com link.
    titulo: { id: 'titulo', label: 'Título', align: 'left', sortKey: 'nome', cell: (l) =>
      linkAtivo(l, <span className="truncate max-w-[240px]" title={l.nome ?? l.ticker}>{l.nome || l.ticker}</span>)
    },
    instituicao: { id: 'instituicao', label: 'Instituição', align: 'left', sortKey: 'instituicao', cell: (l) =>
      l.contas.length > 0
        ? <span className="text-white/70 truncate block max-w-[160px]" title={l.contas.join(', ')}>{l.contas.join(', ')}</span>
        : acoes ? <span className="text-[11px]" style={{ color: '#ffb74d' }}>Sem posição em conta</span> : traco
    },
    setor:  { id: 'setor', label: 'Segmento', align: 'left', sortKey: 'setor', cell: (l) => <span className="text-white/70">{setorLabel(l.setor) ?? '—'}</span> },
    categoria: { id: 'categoria', label: 'Categoria', align: 'left', sortKey: 'categoria', cell: (l) => <span className="text-white/70">{l.categoria ?? '—'}</span> },
    indexador: { id: 'indexador', label: 'Indexador', align: 'left', sortKey: 'indexador', cell: (l) => {
      const v = rfIndexadorLabel(l); return v ? <span className="text-white/80">{v}</span> : traco } },
    taxa:   { id: 'taxa', label: 'Taxa', align: 'right', sortKey: 'taxa', cell: (l) => l.meta?.rf_taxa ? <span className="text-white/80">{l.meta.rf_taxa}</span> : traco },
    venc:   { id: 'venc', label: 'Vencimento', align: 'right', sortKey: 'venc', cell: (l) => l.meta?.rf_vencimento ? <span className="text-white/80">{formatData(l.meta.rf_vencimento)}</span> : traco },
    quant:  { id: 'quant', label: 'Quant.', align: 'right', sortKey: 'quantidade', cell: (l) => <span className="text-white/80">{l.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</span> },
    pm:     { id: 'pm', label: 'Preço médio', align: 'right', sortKey: 'pm', cell: (l) => <span className="text-white/80">{formatBRL(precoMedio(l))}</span> },
    pa:     { id: 'pa', label: 'Preço atual', align: 'right', sortKey: 'pa', cell: (l) => <span className="text-white/80">{formatBRL(precoAtual(l))}</span> },
    rent:   { id: 'rent', label: 'Variação', align: 'right', sortKey: 'rent', cell: (l) => <span style={{ color: corValor(l.rentabilidade_pct) }}>{fmtPct(l.rentabilidade_pct)}</span> },
    // Posse < 12 meses: o projetado (ritmo do fundo, padrão investidor10) e o
    // real (efetivamente recebido) divergem — mostra os dois.
    dy:     { id: 'dy', label: 'DY', align: 'right', sortKey: 'dy', title: 'Dividend Yield (12m) — distribuição do fundo × posição atual', cell: (l) => (
      <>
        <span style={{ color: l.dividend_yield_pct > 0 ? VERDE : MUTED }}>{pct2(l.dividend_yield_pct)}</span>
        {!l.posse_12m && l.dy_real_pct !== l.dividend_yield_pct && (
          <span className="block text-[10px]" style={{ color: MUTED }} title="Recebido nos últimos 12m ÷ saldo atual (posse menor que 12 meses)">
            real {pct2(l.dy_real_pct)}
          </span>
        )}
      </>
    ) },
    yoc:    { id: 'yoc', label: 'YoC', align: 'right', sortKey: 'yoc', title: 'Yield on Cost (12m) — distribuição do fundo × posição atual ÷ custo', cell: (l) => (
      <>
        <span className="text-white/70">{pct2(l.yield_on_cost_pct)}</span>
        {!l.posse_12m && l.yoc_real_pct !== l.yield_on_cost_pct && (
          <span className="block text-[10px]" style={{ color: MUTED }} title="Recebido nos últimos 12m ÷ custo (posse menor que 12 meses)">
            real {pct2(l.yoc_real_pct)}
          </span>
        )}
      </>
    ) },
    saldo:  { id: 'saldo', label: 'Saldo', align: 'right', sortKey: 'saldo', cell: (l) => <span className="text-white font-medium">{formatBRL(l.valor_mercado)}</span> },
    nota:   { id: 'nota', label: 'Nota', align: 'center', sortKey: 'nota', cell: (l) => l.nota_usuario != null
      ? <span className="inline-block px-1.5 rounded bg-white/10 text-white text-[11px] font-semibold">{l.nota_usuario}</span> : traco },
    cart:   { id: 'cart', label: '% Cart.', align: 'right', sortKey: 'cart', cell: (l) => <span className="text-white/80">{pct2(l.participacao_pct)}</span> },
  }

  const base: Coluna[] = ehRF
    ? [C.titulo, C.instituicao, C.indexador, C.taxa, C.venc, C.quant, C.pm, C.pa, C.rent, C.saldo, C.nota, C.cart]
    : ehFII
      ? [C.ticker, C.nome, C.quant, C.pm, C.pa, C.rent, C.dy, C.yoc, C.saldo, C.nota, C.cart]
      : [C.ticker, C.nome, C.setor, C.quant, C.pm, C.pa, C.rent, C.saldo, C.nota, C.cart]
  // Quando o quadro NÃO está agrupado por categoria, ela deixa de aparecer como
  // cabeçalho de grupo — então a exibimos como coluna (após Título+Instituição,
  // na RF, ou após Nome, nos demais). Sem dados de categoria, a coluna é omitida.
  const visiveis: Coluna[] = (() => {
    if (dimEf === 'categoria' || !temCategoria) return base
    const arr = [...base]
    arr.splice(2, 0, C.categoria)
    return arr
  })()
  // colunas visíveis + "Comprar?" + (Ações, se houver)
  const nCols = visiveis.length + 1 + (acoes ? 1 : 0)
  const minWidth = ehFII ? 980 : ehRF ? 1040 : 860

  function LinhaAtivo({ l, realce, alvo, primeira, ultima }: {
    l: AtivoLinha; realce: boolean; alvo: boolean; primeira: boolean; ultima: boolean
  }) {
    const rec = recomendacaoCompra(l.nota_usuario ?? null, idealRef)
    const estilo: CSSProperties = realce ? { background: `${cor}1f` } : {}
    if (alvo) {
      estilo.borderLeft = `1px solid ${cor}`
      estilo.borderRight = `1px solid ${cor}`
      if (primeira) estilo.borderTop = `1px solid ${cor}`
      if (ultima) estilo.borderBottom = `1px solid ${cor}`
    }
    return (
      <tr className="border-t border-white/5 hover:bg-white/[0.03] transition-colors duration-700"
        style={Object.keys(estilo).length ? estilo : undefined}>
        {visiveis.map((c) => (
          <td key={c.id} className={`px-2 py-1.5 ${alinhar(c.align)}`}>{c.cell(l)}</td>
        ))}
        <td className="px-2 py-1.5 text-center">
          {rec
            ? <span className="text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${COR_REC[rec.recomendacao]}22`, color: COR_REC[rec.recomendacao] }} title={rec.motivo}>{LABEL_REC[rec.recomendacao]}</span>
            : <span style={{ color: MUTED }}>—</span>}
        </td>
        {acoes && (
          <td className="px-2 py-1.5">
            <div className="flex items-center justify-end gap-1">
              <button onClick={() => l.meta && acoes.onPosicoes(l.meta)} disabled={!l.meta} title="Movimentações"
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
    <div ref={ref} className="rounded-xl border bg-white/[0.02] scroll-mt-4 transition-shadow duration-700"
      style={{
        borderColor: destaque && destaqueChave === null ? cor : 'rgba(255,255,255,0.1)',
        boxShadow: destaque && destaqueChave === null ? `0 0 0 2px ${cor}, 0 0 26px ${cor}88` : 'none',
      }}>
      {/* div, não <button>: quando `alca` (arrastar) está presente, um
          <button> engolindo a alça impede o `dragstart` de disparar no
          Firefox (bug conhecido, Mozilla #646823) — o arraste simplesmente
          nunca começava. */}
      <div role="button" tabIndex={0} onClick={() => setAberto(!aberto)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAberto(!aberto) } }}
        className={`w-full px-4 py-3 grid grid-cols-2 gap-3 items-center text-left cursor-pointer ${mostraDividendos ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        {/* Tipo + contagem */}
        <div className="flex items-center gap-2 min-w-0">
          {alca && (
            // stopPropagation: o botão inteiro do cabeçalho abre/fecha o
            // quadro ao clicar — sem isso, um clique (sem arrastar) na alça
            // também alternaria o quadro junto.
            <span onClick={(e) => e.stopPropagation()}>{alca}</span>
          )}
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

        {/* Dividendos do tipo — não existe para renda fixa/Tesouro/cripto */}
        {mostraDividendos && (
          <div className="hidden md:block text-center">
            <p className="text-[12px]" style={{ color: MUTED }}>Dividendos</p>
            <p className="text-[13px] font-medium" style={{ color: dados && dados.dividendos > 0 ? VERDE : MUTED }}>
              {dados ? formatBRL(dados.dividendos) : '—'}
            </p>
            {dyYocMedio && (
              <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
                DY méd. <span className="text-white/80">{pct2(dyYocMedio.dy)}</span>
                {' · '}YoC méd. <span className="text-white/80">{pct2(dyYocMedio.yoc)}</span>
              </p>
            )}
          </div>
        )}

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
            {/* Meta de alocação — some visível mesmo com o quadro recolhido
                (antes só aparecia dentro, aberto). Mostra o % ideal e, logo
                abaixo, quanto falta (ou sobra) em R$ pra bater essa meta. */}
            {dados && dados.percentual_ideal > 0 && totalCarteira != null && (() => {
              const valorIdeal = totalCarteira * dados.percentual_ideal / 100
              const falta = valorIdeal - dados.valor_mercado
              return (
                <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
                  Meta {dados.percentual_ideal}%
                  <span style={{ color: corValor(-dados.desvio_pct) }}>
                    {' · '}{falta >= 0 ? `faltam ${formatBRL(falta)}` : `${formatBRL(Math.abs(falta))} acima`}
                  </span>
                </p>
              )
            })()}
          </div>
          {aberto ? <ChevronUp size={15} style={{ color: MUTED }} /> : <ChevronDown size={15} style={{ color: MUTED }} />}
        </div>
      </div>

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
              {/* Seletor de agrupamento — só aparece quando há mais de uma
                  dimensão que faz sentido para este tipo de ativo. */}
              {dimsDisponiveis.length > 1 && (
                <div className="flex justify-end items-center gap-2">
                  <span className="text-[12px]" style={{ color: MUTED }}>Agrupar por</span>
                  <SelectDark value={dimEf} onChange={(e) => setDim(e.target.value as Dimensao)}
                    style={{ width: 'auto' }} className="!text-[12px] !py-1.5">
                    {DIMENSOES.filter((d) => dimsDisponiveis.includes(d.value)).map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </SelectDark>
                </div>
              )}

              <div className="overflow-auto max-h-[72vh]">
                <table className="w-full text-[12px]" style={{ minWidth }}>
                  {/* sticky top-0: fica visível rolando a listagem — sem isso
                      as colunas somem de vista e é fácil perder o que cada
                      número significa. z-20 > o dos cabeçalhos de grupo
                      (z-10), que ficam por baixo (top-8, logo abaixo desta
                      linha) — nunca os dois sticky disputam o mesmo lugar. */}
                  <thead className="sticky top-0 z-20" style={{ background: HEADER_BG }}>
                    <tr className="h-8" style={{ color: MUTED }}>
                      {visiveis.map((c) => (
                        <th key={c.id} title={c.title} onClick={c.sortKey ? () => clickSort(c.sortKey!) : undefined}
                          className={`px-2 font-medium ${alinhar(c.align)} ${c.sortKey ? 'cursor-pointer select-none hover:text-white/80' : ''}`}>
                          {c.label}{c.sortKey && sort.key === c.sortKey ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      <th className="px-2 font-medium text-center">Comprar?</th>
                      {acoes && <th className="px-2 font-medium text-right">Ações</th>}
                    </tr>
                  </thead>
                  {grupos.map((g) => {
                    const catAberta = !temGrupos || !catsFechadas.has(g.chave)
                    // Realça este grupo: foco no quadro todo (chave null) ou
                    // foco exatamente nesta chave (fatia clicada na rosca).
                    const realce = destaque && (destaqueChave === null || destaqueChave === g.chave)
                    const ehAlvo = destaqueChave !== null && destaqueChave === g.chave
                    // Fundo sempre opaco (sticky) — com tinta sobreposta no realce.
                    const estiloHeader: CSSProperties = {
                      background: realce ? `linear-gradient(${cor}33, ${cor}33), ${HEADER_BG}` : HEADER_BG,
                    }
                    if (ehAlvo) {
                      estiloHeader.borderTop = `1px solid ${cor}`
                      estiloHeader.borderLeft = `1px solid ${cor}`
                      estiloHeader.borderRight = `1px solid ${cor}`
                    }
                    return (
                      <tbody key={g.chave || '__flat__'} ref={ehAlvo ? grupoRef : undefined}
                        style={{ scrollMarginTop: 12 }}>
                        {temGrupos && (
                          <tr className="cursor-pointer" onClick={() => toggleCat(g.chave)}>
                            <td colSpan={nCols} style={estiloHeader}
                              className="px-2 py-1.5 sticky top-8 z-10 border-t border-white/[0.03] transition-[filter] duration-700 hover:brightness-125">
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
                        {catAberta && g.lista.map((l, idx) => (
                          <LinhaAtivo key={l.ativo_id} l={l} realce={realce} alvo={ehAlvo}
                            primeira={!temGrupos && idx === 0} ultima={idx === g.lista.length - 1} />
                        ))}
                      </tbody>
                    )
                  })}
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
