// src/pages/ProgressaoAnualPage.tsx
// Progressão ano a ano: o mesmo intervalo de meses em vários anos lado a lado.
// Pensado pra períodos distantes, então além de valores nominais oferece
// "% da receita" e "Corrigido IPCA" (ver ComparativoMensalPage pro par de datas).
import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, LineElement, PointElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { ChartData, ChartOptions } from 'chart.js'
import { RefreshCw, Download, TrendingUp, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { formatBRL, mesLabel, mesAtual } from '../lib/utils'
import { BotaoOcultar } from '../components/ui/BotaoOcultar'
import { useOcultarValores } from '../hooks/useOcultarValores'
import LoadingMascote from '../components/ui/LoadingMascote'
import { registrarResetCliente } from '../lib/clientCache'
import { useRegistrarContextoIA } from '../context/ContextoIAContext'
import { useIndicesEconomicos } from '../hooks/useIndicesEconomicos'
import { criarCorretorIpca } from '../lib/ipcaReal'
import { usePrimeiroLancamento } from '../hooks/usePrimeiroLancamento'
import BotaoAjuda from '../components/ui/BotaoAjuda'
import AjudaModoValor from '../components/ui/AjudaModoValor'
import { isTransf, parseApiRes, type Lancamento } from '../lib/lancamentosRelatorio'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Title, Tooltip, Legend)

type ModoValor = 'valores' | 'pct' | 'ipca'
const MODOS_VALOR: { id: ModoValor; label: string; title: string }[] = [
  { id: 'valores', label: 'Valores',        title: 'Valores nominais, como lançados' },
  { id: 'pct',     label: '% da receita',   title: 'Cada categoria como % da receita total do próprio ano — compara anos distantes sem a distorção da inflação' },
  { id: 'ipca',    label: 'Corrigido IPCA', title: 'Todos os valores levados para os preços de hoje pelo IPCA' },
]
const NOMES_MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const CORES_LINHA = ['#4da6ff', '#f0b429', '#a78bfa', '#00c896', '#f87171', '#fb923c']
const MAX_CATS_GRAFICO = 6
const ANOS_POR_LINHA = 10

interface LinhaCat { key: string; nome: string; tipo: 'RECEITA' | 'DESPESA'; vals: number[] }

// ── Estado do módulo — persiste entre navegações ──────────────────────────────
interface PageState {
  anosSel: number[]; mesIni: number; mesFim: number
  dados: Record<number, Lancamento[]>; anosBuscados: number[]; buscado: boolean
  modo: ModoValor; agrup: 'pai' | 'cat'; selCats: string[]
}
let _saved: PageState | null = null
registrarResetCliente(() => { _saved = null })

function abbrBRL(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000)     return `R$${(v / 1_000).toFixed(0)}k`
  return `R$${v.toFixed(0)}`
}

function anosPadrao(): number[] {
  const atual = Number(mesAtual().slice(0, 4))
  return [atual - 3, atual - 2, atual - 1, atual]
}

export default function ProgressaoAnualPage() {
  const anoAtual = Number(mesAtual().slice(0, 4))
  const mesAtualNum = Number(mesAtual().slice(5, 7))
  // Do ano do lançamento mais antigo até o atual (enquanto carrega, ou sem
  // lançamentos, mostra só os últimos 4 anos).
  const { anoPrimeiroLancamento } = usePrimeiroLancamento()
  const anoInicial = Math.min(anoPrimeiroLancamento ?? anoAtual - 3, anoAtual)
  const anosDisponiveis = useMemo(
    () => Array.from({ length: anoAtual - anoInicial + 1 }, (_, i) => anoInicial + i), [anoAtual, anoInicial])
  // Os anos são exibidos em linhas de no máximo ANOS_POR_LINHA.
  const linhasDeAnos = useMemo(() => {
    const linhas: number[][] = []
    for (let i = 0; i < anosDisponiveis.length; i += ANOS_POR_LINHA) linhas.push(anosDisponiveis.slice(i, i + ANOS_POR_LINHA))
    return linhas
  }, [anosDisponiveis])

  const [anosSel,  setAnosSel]  = useState<number[]>(() => _saved?.anosSel ?? anosPadrao())
  const [mesIni,   setMesIni]   = useState(() => _saved?.mesIni ?? 1)
  const [mesFim,   setMesFim]   = useState(() => _saved?.mesFim ?? 12)
  const [dados,    setDados]    = useState<Record<number, Lancamento[]>>(() => _saved?.dados ?? {})
  const [anosBuscados, setAnosBuscados] = useState<number[]>(() => _saved?.anosBuscados ?? [])
  const [buscado,  setBuscado]  = useState(() => _saved?.buscado ?? false)
  const [loading,  setLoading]  = useState(false)
  const [modo,     setModo]     = useState<ModoValor>(() => _saved?.modo ?? 'valores')
  const [agrup,    setAgrup]    = useState<'pai' | 'cat'>(() => _saved?.agrup ?? 'pai')
  const [selCats,  setSelCats]  = useState<string[]>(() => _saved?.selCats ?? [])
  const { oculto, toggle: toggleOculto } = useOcultarValores()

  useEffect(() => {
    _saved = { anosSel, mesIni, mesFim, dados, anosBuscados, buscado, modo, agrup, selCats }
  }, [anosSel, mesIni, mesFim, dados, anosBuscados, buscado, modo, agrup, selCats])

  // Seleção salva/padrão de anos anteriores ao 1º lançamento não faz sentido.
  useEffect(() => {
    if (anoPrimeiroLancamento == null) return
    setAnosSel(prev => prev.some(a => a < anoPrimeiroLancamento)
      ? prev.filter(a => a >= anoPrimeiroLancamento) : prev)
  }, [anoPrimeiroLancamento])

  const ipcaQ = useIndicesEconomicos(['IPCA'], '2006-01', modo === 'ipca', true)
  const serieIpca = ipcaQ.series['IPCA']
  const corretor = useMemo(() => criarCorretorIpca(serieIpca ?? []), [serieIpca])
  const corrigindo = modo === 'ipca' && corretor.disponivel
  const pctMode = modo === 'pct'

  const periodoInvalido = anosSel.length < 2 || mesIni > mesFim
  const incluiMesesFuturos = anosSel.includes(anoAtual) && mesFim > mesAtualNum

  function alternarAno(ano: number) {
    setAnosSel(prev => prev.includes(ano) ? prev.filter(a => a !== ano) : [...prev, ano].sort((a, b) => a - b))
    setBuscado(false)
  }

  // ── Buscar ─────────────────────────────────────────────────────────────────
  const buscar = useCallback(async () => {
    const anos = [...anosSel].sort((a, b) => a - b)
    if (anos.length < 2 || mesIni > mesFim) return
    setLoading(true)
    try {
      const out: Record<number, Lancamento[]> = {}
      // Um ano por vez (12 requisições em paralelo) pra não saturar a API.
      for (const ano of anos) {
        const meses = Array.from({ length: mesFim - mesIni + 1 },
          (_, i) => `${ano}-${String(mesIni + i).padStart(2, '0')}`)
        const res = await Promise.all(meses.map(m => apiFetch<unknown>(`/transacoes?mes=${m}&saldo=true`)))
        out[ano] = res.flatMap(parseApiRes)
      }
      setDados(out)
      setAnosBuscados(anos)
      setBuscado(true)
    } finally {
      setLoading(false)
    }
  }, [anosSel, mesIni, mesFim])

  // ── Cálculo ────────────────────────────────────────────────────────────────
  const calc = useMemo(() => {
    const anos = anosBuscados
    const n = anos.length
    const rec: number[] = Array(n).fill(0)
    const desp: number[] = Array(n).fill(0)
    const mapa = new Map<string, { nome: string; nets: number[] }>()
    let foraDaSerie = 0

    anos.forEach((ano, i) => {
      for (const l of dados[ano] ?? []) {
        if (isTransf(l)) continue
        const mes = l.data.slice(0, 7)
        if (corrigindo && !corretor.cobre(mes)) foraDaSerie++
        const v = corrigindo ? l.valor * corretor.fator(mes) : l.valor
        if (l.tipo === 'RECEITA') rec[i] += v; else desp[i] += v

        const pai = l.categoria_pai_nome ?? l.categoria_nome ?? 'Sem categoria'
        const key = agrup === 'pai' ? `pai:${pai}` : (l.categoria_id ?? '__sem__')
        const nome = agrup === 'pai' ? pai
          : (l.categoria_pai_nome && l.categoria_nome ? `${l.categoria_pai_nome} › ${l.categoria_nome}`
            : (l.categoria_nome ?? 'Sem categoria'))
        let item = mapa.get(key)
        if (!item) { item = { nome, nets: Array(n).fill(0) }; mapa.set(key, item) }
        item.nets[i] += l.tipo === 'RECEITA' ? v : -v
      }
    })

    // % da receita do próprio ano (0 quando o ano não teve receita)
    const conv = (v: number, i: number) => pctMode ? (rec[i] > 0 ? (v / rec[i]) * 100 : 0) : v

    const linhas: LinhaCat[] = [...mapa.entries()].map(([key, { nome, nets }]) => {
      // Tipo pelo sinal do acumulado dos anos; o valor de cada ano mantém o
      // sinal próprio (uma categoria pode inverter num ano e isso deve aparecer).
      const tipo: 'RECEITA' | 'DESPESA' = nets.reduce((s, x) => s + x, 0) >= 0 ? 'RECEITA' : 'DESPESA'
      return { key, nome, tipo, vals: nets.map((x, i) => conv(tipo === 'RECEITA' ? x : -x, i)) }
    }).sort((a, b) => Math.abs(b.vals[n - 1] ?? 0) - Math.abs(a.vals[n - 1] ?? 0))

    return {
      anos, n, rec, desp, foraDaSerie, linhas,
      receitas: linhas.filter(l => l.tipo === 'RECEITA'),
      despesas: linhas.filter(l => l.tipo === 'DESPESA'),
      despPct: desp.map((d, i) => rec[i] > 0 ? (d / rec[i]) * 100 : 0),
      poupanca: rec.map((r, i) => r > 0 ? ((r - desp[i]) / r) * 100 : 0),
      semReceita: anos.filter((_, i) => rec[i] <= 0),
    }
  }, [anosBuscados, dados, agrup, corrigindo, corretor, pctMode])

  // Categorias no gráfico: seleção do usuário, ou as 5 maiores despesas do último ano.
  const chaveCatsGrafico = useMemo(() => {
    const validas = selCats.filter(k => calc.linhas.some(l => l.key === k)).slice(0, MAX_CATS_GRAFICO)
    return validas.length > 0 ? validas : calc.despesas.slice(0, 5).map(l => l.key)
  }, [selCats, calc])

  function alternarCat(key: string) {
    setSelCats(prev => {
      const base = prev.filter(k => calc.linhas.some(l => l.key === k))
      const atual = base.length > 0 ? base : chaveCatsGrafico
      return atual.includes(key)
        ? atual.filter(k => k !== key)
        : [...atual, key].slice(-MAX_CATS_GRAFICO)
    })
  }

  // ── Formatação ─────────────────────────────────────────────────────────────
  const fmtVal = (v: number) => pctMode ? `${v.toFixed(1)}%` : (oculto ? '••••' : formatBRL(v))
  const fmtPct = (v: number) => `${v.toFixed(1)}%`
  /** Δ do 1º ao último ano: pp no modo %, variação relativa nos demais. */
  function delta(vals: number[]): { texto: string; diff: number } | null {
    if (vals.length < 2) return null
    const primeiro = vals[0], ultimo = vals[vals.length - 1]
    if (pctMode) { const d = ultimo - primeiro; return { diff: d, texto: `${d >= 0 ? '+' : ''}${d.toFixed(1)} pp` } }
    if (primeiro === 0) return null
    const d = ((ultimo - primeiro) / Math.abs(primeiro)) * 100
    return { diff: ultimo - primeiro, texto: `${d >= 0 ? '+' : ''}${d.toFixed(1)}%` }
  }
  const corDelta = (diff: number, bomSeSobe: boolean) =>
    diff === 0 ? '#f0b429' : (diff > 0) === bomSeSobe ? '#00c896' : '#f87171'

  // ── Gráficos ───────────────────────────────────────────────────────────────
  const labelsAnos = calc.anos.map(String)
  const tooltipPlugin = {
    backgroundColor: '#1a1f2e', titleColor: '#e8eaf0', bodyColor: '#8b92a8',
    borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
    callbacks: {
      label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
        ` ${ctx.dataset.label}: ${pctMode ? fmtPct(Number(ctx.raw) || 0) : formatBRL(Number(ctx.raw) || 0)}`,
    },
  }
  const opcoesLinha: ChartOptions<'line'> = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: '#8b92a8', font: { size: 14 }, boxWidth: 12 } }, tooltip: tooltipPlugin },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b92a8', font: { size: 14 } } },
      y: {
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#8b92a8', font: { size: 13 }, callback: (v) => pctMode ? `${Number(v).toFixed(0)}%` : abbrBRL(Number(v)) },
      },
    },
  }
  const ponto = (cor: string, extra: object = {}) => ({
    borderColor: cor, backgroundColor: cor, tension: 0.3, fill: false, pointRadius: 4, pointBackgroundColor: cor, ...extra,
  })
  const chartResumo = useMemo((): ChartData<'line'> => ({
    labels: labelsAnos,
    datasets: pctMode ? [
      { label: 'Despesa / Receita', data: calc.despPct, ...ponto('#f87171') },
      { label: 'Taxa de poupança',  data: calc.poupanca, ...ponto('#4da6ff', { borderDash: [5, 3] }) },
    ] : [
      { label: 'Receitas',  data: calc.rec,  ...ponto('#00c896') },
      { label: 'Despesas',  data: calc.desp, ...ponto('#f87171') },
      { label: 'Resultado', data: calc.rec.map((r, i) => r - calc.desp[i]), ...ponto('#4da6ff', { borderDash: [5, 3] }) },
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [calc, pctMode])
  const chartCats = useMemo((): ChartData<'line'> => ({
    labels: labelsAnos,
    datasets: chaveCatsGrafico.map((k, i) => {
      const l = calc.linhas.find(x => x.key === k)!
      return { label: l.nome, data: l.vals, ...ponto(CORES_LINHA[i % CORES_LINHA.length]) }
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [calc, chaveCatsGrafico])

  // ── Snapshot pra IA ────────────────────────────────────────────────────────
  useRegistrarContextoIA(useMemo(() => {
    if (!buscado) return null
    return {
      titulo: `Progressão anual: ${calc.anos.join(', ')} (${NOMES_MES[mesIni - 1]}–${NOMES_MES[mesFim - 1]})`,
      descricao: 'Mesmo intervalo de meses em vários anos, lado a lado',
      dados: {
        modo_valores: pctMode ? '% da receita do ano' : corrigindo ? 'corrigido pelo IPCA (preços de hoje)' : 'nominal',
        anos: calc.anos.map((ano, i) => ({
          ano, receitas: calc.rec[i], despesas: calc.desp[i],
          despesa_pct_receita: calc.despPct[i], taxa_poupanca_pct: calc.poupanca[i],
        })),
        maiores_despesas: calc.despesas.slice(0, 10).map(l => ({ categoria: l.nome, por_ano: l.vals })),
      },
    }
  }, [buscado, calc, mesIni, mesFim, pctMode, corrigindo]))

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportar = useCallback(async () => {
    if (!buscado || calc.linhas.length === 0) return
    const { exportToExcel } = await import('../lib/exportUtils')
    type Col = import('../lib/exportUtils').ExportColumn
    type Row = import('../lib/exportUtils').ExportRow
    const tipoNum = pctMode ? 'percent' : 'currency'
    const e = (v: number) => pctMode ? v / 100 : v

    const columns: Col[] = [
      { key: 'cat', label: 'Categoria', type: 'text', width: 32 },
      ...calc.anos.map((ano): Col => ({ key: `a${ano}`, label: String(ano), type: tipoNum, width: 16 })),
      { key: 'var', label: pctMode ? 'Δ 1º→último (pp)' : 'Δ 1º→último', type: 'percent', width: 16 },
    ]
    const linha = (nome: string, vals: number[], style?: import('../lib/exportUtils').RowStyle): Row => {
      const r: Row = { cat: nome }
      calc.anos.forEach((ano, i) => { r[`a${ano}`] = e(vals[i]) })
      const d = vals.length >= 2
        ? (pctMode ? (vals[vals.length - 1] - vals[0]) / 100
          : vals[0] !== 0 ? (vals[vals.length - 1] - vals[0]) / Math.abs(vals[0]) : 'N/A')
        : 'N/A'
      r.var = d
      if (style) r._style = style
      return r
    }
    const grupo = (nome: string): Row => {
      const r: Row = { cat: nome, var: '', _style: 'group' }
      calc.anos.forEach(ano => { r[`a${ano}`] = '' })
      return r
    }
    const rows: Row[] = []
    if (calc.receitas.length > 0) {
      rows.push(grupo(`▼ Receitas (${calc.receitas.length})`))
      calc.receitas.forEach(l => rows.push(linha(l.nome, l.vals)))
      rows.push(linha('Total Receitas', calc.anos.map((_, i) => pctMode ? (calc.rec[i] > 0 ? 100 : 0) : calc.rec[i]), 'subtotal'))
    }
    if (calc.despesas.length > 0) {
      rows.push(grupo(`▼ Despesas (${calc.despesas.length})`))
      calc.despesas.forEach(l => rows.push(linha(l.nome, l.vals)))
      rows.push(linha('Total Despesas', calc.anos.map((_, i) => pctMode ? calc.despPct[i] : calc.desp[i]), 'subtotal'))
    }
    rows.push(linha(pctMode ? 'Resultado (taxa de poupança)' : 'Resultado',
      calc.anos.map((_, i) => pctMode ? calc.poupanca[i] : calc.rec[i] - calc.desp[i]), 'total'))

    await exportToExcel({
      filename: `progressao_${calc.anos[0]}_${calc.anos[calc.anos.length - 1]}`,
      sheets: [{
        name: 'Progressão',
        title: 'Progressão Anual',
        subtitle: `${NOMES_MES[mesIni - 1]}–${NOMES_MES[mesFim - 1]} · ${calc.anos.join(' · ')}`
          + (pctMode ? ' · % da receita do ano'
            : corrigindo && corretor.refCompetencia ? ` · corrigido pelo IPCA (preços de ${mesLabel(corretor.refCompetencia)})` : ''),
        columns, rows,
      }],
    })
  }, [buscado, calc, pctMode, corrigindo, corretor, mesIni, mesFim])

  // ── Render ─────────────────────────────────────────────────────────────────
  const seletorMes = (valor: number, onChange: (v: number) => void, label: string) => (
    <div>
      <p className="text-[14px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>{label}</p>
      <select value={valor} onChange={e => { onChange(Number(e.target.value)); setBuscado(false) }}
        className="px-3 py-[7px] rounded-lg border text-[16px] outline-none"
        style={{ background: '#0e1320', borderColor: 'rgba(255,255,255,0.12)', color: '#e8eaf0' }}>
        {NOMES_MES.map((nm, i) => <option key={nm} value={i + 1}>{nm}</option>)}
      </select>
    </div>
  )

  const cabAnos = (
    <>
      {calc.anos.map(ano => (
        <th key={ano} className="px-4 py-2.5 border-b border-white/5 text-right">
          <span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#8b92a8' }}>{ano}</span>
        </th>
      ))}
      <th className="px-4 py-2.5 border-b border-white/5 text-right">
        <span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
          {pctMode ? 'Δ pp' : 'Δ %'}
        </span>
      </th>
    </>
  )

  function CelulaDelta({ vals, bomSeSobe }: { vals: number[]; bomSeSobe: boolean }) {
    const d = delta(vals)
    if (!d) return <td className="px-4 py-2.5 text-right"><span className="text-[14px]" style={{ color: '#4a5168' }}>—</span></td>
    const cor = corDelta(d.diff, bomSeSobe)
    const Icon = d.diff > 0 ? ArrowUpRight : d.diff < 0 ? ArrowDownRight : Minus
    return (
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-1 text-[15px] font-semibold" style={{ color: cor }}>
          <Icon size={13} />{d.texto}
        </span>
      </td>
    )
  }

  function LinhaTabela({ l }: { l: LinhaCat }) {
    const idxGrafico = chaveCatsGrafico.indexOf(l.key)
    const noGrafico = idxGrafico >= 0
    return (
      <tr className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
        <td className="px-4 py-2.5 cursor-pointer select-none" onClick={() => alternarCat(l.key)}
          title={noGrafico ? 'Tirar do gráfico de categorias' : 'Mostrar no gráfico de categorias'}>
          <span className="text-[15px] inline-flex items-center gap-2" style={{ color: '#e8eaf0' }}>
            <span className="inline-block rounded-full" style={{
              width: 9, height: 9, flexShrink: 0,
              background: noGrafico ? CORES_LINHA[idxGrafico % CORES_LINHA.length] : 'transparent',
              border: `1.5px solid ${noGrafico ? CORES_LINHA[idxGrafico % CORES_LINHA.length] : '#4a5168'}`,
            }} />
            {l.nome}
          </span>
        </td>
        {l.vals.map((v, i) => (
          <td key={calc.anos[i]} className="px-4 py-2.5 text-right">
            <span className="text-[15px]" style={{ color: i === l.vals.length - 1 ? '#c5cad8' : '#8b92a8' }}>{fmtVal(v)}</span>
          </td>
        ))}
        <CelulaDelta vals={l.vals} bomSeSobe={l.tipo === 'RECEITA'} />
      </tr>
    )
  }

  function LinhaTotal({ nome, vals, cor, bomSeSobe, fundo }: {
    nome: string; vals: number[]; cor: string; bomSeSobe: boolean; fundo?: string
  }) {
    return (
      <tr style={{ background: fundo ?? `${cor}10`, borderTop: `1px solid ${cor}40` }}>
        <td className="px-4 py-2.5">
          <span className="text-[15px] font-bold uppercase tracking-wider" style={{ color: cor }}>{nome}</span>
        </td>
        {vals.map((v, i) => (
          <td key={calc.anos[i]} className="px-4 py-2.5 text-right">
            <span className="text-[15px] font-bold" style={{ color: cor }}>{fmtVal(v)}</span>
          </td>
        ))}
        <CelulaDelta vals={vals} bomSeSobe={bomSeSobe} />
      </tr>
    )
  }

  return (
    <div className="p-5 min-h-screen" style={{ background: '#0e1320' }}>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold flex items-center gap-2" style={{ color: '#e8eaf0' }}>
            Progressão Anual
            <BotaoAjuda titulo="Progressão Anual" tamanho={18}>
              <p>Mostra o mesmo intervalo de meses em vários anos lado a lado, para ver como receitas, despesas e poupança evoluem ao longo do tempo.</p>
              <p><b style={{ color: '#e8eaf0' }}>Como usar:</b> marque pelo menos 2 anos, escolha o intervalo de meses (vale para todos os anos) e clique em Comparar.</p>
              <p>Use o mesmo intervalo em todos os anos para a comparação ser justa — por isso, no ano corrente, prefira terminar no mês atual.</p>
              <p>Para anos distantes, troque o modo para "% da receita" ou "Corrigido IPCA" (veja o "?" ao lado de Exibir).</p>
            </BotaoAjuda>
          </h1>
          <p className="text-[15px] mt-0.5" style={{ color: '#8b92a8' }}>
            O mesmo intervalo de meses em vários anos · receitas, despesas e poupança lado a lado
          </p>
        </div>
        <BotaoOcultar oculto={oculto} onToggle={toggleOculto} />
      </div>

      {/* Filtros */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-4 mb-5">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="w-full">
            <p className="text-[14px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>
              Anos (mínimo 2)
            </p>
            <div className="flex flex-col gap-1.5">
              {linhasDeAnos.map((linha, i) => (
                <div key={i} className="flex flex-wrap gap-1.5">
                  {linha.map(ano => {
                    const ativo = anosSel.includes(ano)
                    return (
                      <button key={ano} onClick={() => alternarAno(ano)}
                        className="px-3 py-[6px] rounded-lg border text-[15px] font-semibold transition-colors"
                        style={{
                          background:  ativo ? 'rgba(0,200,150,0.15)' : 'transparent',
                          borderColor: ativo ? 'rgba(0,200,150,0.5)' : 'rgba(255,255,255,0.12)',
                          color:       ativo ? '#00c896' : '#8b92a8',
                        }}>
                        {ano}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-2">
            {seletorMes(mesIni, setMesIni, 'De')}
            <span className="pb-[8px] text-[16px]" style={{ color: '#4a5168' }}>→</span>
            {seletorMes(mesFim, setMesFim, 'até')}
          </div>
          <div className="flex items-end gap-2 ml-auto flex-wrap pb-[1px]">
            {buscado && (
              <button onClick={exportar}
                className="flex items-center gap-2 px-3 py-[7px] rounded-lg text-[16px] font-semibold border transition-all hover:opacity-90"
                style={{ color: '#4da6ff', background: 'rgba(77,166,255,0.08)', borderColor: 'rgba(77,166,255,0.2)' }}>
                <Download size={13} /> Exportar
              </button>
            )}
            <button onClick={buscar} disabled={loading || periodoInvalido}
              className="flex items-center gap-2 px-4 py-[7px] rounded-lg text-[16px] font-semibold transition-all hover:opacity-90"
              style={{ background: '#00c896', color: '#0a0f1a', opacity: (loading || periodoInvalido) ? 0.5 : 1 }}>
              {loading ? <><RefreshCw size={13} className="animate-spin" /> Carregando…</>
                : <><RefreshCw size={13} /> Comparar</>}
            </button>
          </div>
        </div>

        {anosSel.length < 2 && (
          <p className="text-[14px] mt-2.5" style={{ color: '#f87171' }}>Selecione pelo menos 2 anos.</p>
        )}
        {mesIni > mesFim && (
          <p className="text-[14px] mt-2.5" style={{ color: '#f87171' }}>O mês inicial não pode ser depois do final.</p>
        )}
        {incluiMesesFuturos && (
          <p className="text-[14px] mt-2.5" style={{ color: '#f0b429' }}>
            {anoAtual} ainda não terminou: os meses até {NOMES_MES[mesFim - 1]} incluem lançamentos futuros (pendentes/projeções).{' '}
            <button className="underline font-semibold"
              onClick={() => { setMesFim(mesAtualNum); setBuscado(false) }}>
              Comparar só até {NOMES_MES[mesAtualNum - 1]}
            </button>
          </p>
        )}

        {/* Modo de exibição */}
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-3 flex-wrap">
          <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Exibir</span>
          <AjudaModoValor unidade="ano" />
          <div className="flex rounded-lg overflow-hidden border border-white/10 text-[14px] font-semibold">
            {MODOS_VALOR.map(({ id, label, title }, idx) => (
              <button key={id} title={title} onClick={() => setModo(id)}
                className="px-3 py-1 transition-colors"
                style={{
                  background:  modo === id ? 'rgba(0,200,150,0.15)' : 'transparent',
                  color:       modo === id ? '#00c896' : '#8b92a8',
                  borderRight: idx < MODOS_VALOR.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg overflow-hidden border border-white/10 text-[14px] font-semibold">
            {([
              { id: 'pai' as const, label: 'Resumo',    title: 'Subcategorias somadas na categoria pai' },
              { id: 'cat' as const, label: 'Categoria', title: 'Cada categoria/subcategoria em uma linha' },
            ]).map(({ id, label, title }, idx) => (
              <button key={id} title={title} onClick={() => setAgrup(id)}
                className="px-3 py-1 transition-colors"
                style={{
                  background:  agrup === id ? 'rgba(0,200,150,0.15)' : 'transparent',
                  color:       agrup === id ? '#00c896' : '#8b92a8',
                  borderRight: idx === 0 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                }}>
                {label}
              </button>
            ))}
          </div>
          {pctMode && (
            <span className="text-[14px]" style={{ color: '#8b92a8' }}>
              Cada categoria como % da receita total do próprio ano · diferenças em pontos percentuais (pp)
            </span>
          )}
          {modo === 'ipca' && (
            <span className="text-[14px]" style={{ color: ipcaQ.loading || corretor.disponivel ? '#8b92a8' : '#f0b429' }}>
              {ipcaQ.loading ? 'Carregando IPCA…'
                : corretor.disponivel && corretor.refCompetencia
                  ? `Todos os valores em preços de ${mesLabel(corretor.refCompetencia)} (IPCA)`
                  : 'Série do IPCA indisponível — exibindo valores nominais'}
            </span>
          )}
        </div>
        {buscado && calc.foraDaSerie > 0 && (
          <p className="text-[14px] mt-2" style={{ color: '#f0b429' }}>
            O IPCA disponível começa em {corretor.primeiraCompetencia ? mesLabel(corretor.primeiraCompetencia) : '2020'}:{' '}
            {calc.foraDaSerie} lançamento{calc.foraDaSerie !== 1 ? 's' : ''} anterior{calc.foraDaSerie !== 1 ? 'es' : ''} ficou sem correção.
          </p>
        )}
        {buscado && pctMode && calc.semReceita.length > 0 && (
          <p className="text-[14px] mt-2" style={{ color: '#f0b429' }}>
            Sem receitas em {calc.semReceita.join(', ')} — os percentuais desse{calc.semReceita.length > 1 ? 's anos' : ' ano'} não podem ser calculados (aparecem como 0%).
          </p>
        )}
      </div>

      {loading && <LoadingMascote texto="Montando a progressão…" size={150} fullPage />}

      {!buscado && !loading && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(77,166,255,0.08)', border: '1px solid rgba(77,166,255,0.15)' }}>
            <TrendingUp size={26} style={{ color: '#4da6ff' }} />
          </div>
          <p className="text-[19px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>Compare vários anos</p>
          <p className="text-[16px]" style={{ color: '#8b92a8' }}>
            {periodoInvalido ? 'Escolha pelo menos 2 anos e um intervalo de meses válido' : 'Clique em Comparar para gerar a progressão'}
          </p>
        </div>
      )}

      {buscado && !loading && (
        <>
          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-4">
              <p className="text-[16px] font-bold mb-0.5" style={{ color: '#e8eaf0' }}>
                {pctMode ? 'Despesa e poupança' : 'Receitas, despesas e resultado'}
              </p>
              <p className="text-[14px] mb-3" style={{ color: '#4a5168' }}>
                {pctMode ? '% da receita de cada ano' : 'Total do intervalo, ano a ano'}
              </p>
              <div style={{ height: 240 }}><Line data={chartResumo} options={opcoesLinha} /></div>
            </div>
            <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-4">
              <p className="text-[16px] font-bold mb-0.5 flex items-center gap-1.5" style={{ color: '#e8eaf0' }}>
                Categorias
                <BotaoAjuda titulo="Gráfico de categorias">
                  <p>Mostra a evolução de categorias escolhidas ao longo dos anos. Por padrão, as 5 maiores despesas do último ano.</p>
                  <p>Para mudar, clique no nome de uma categoria na tabela "Categorias por ano": a bolinha colorida indica quem está no gráfico (máximo {MAX_CATS_GRAFICO}).</p>
                </BotaoAjuda>
              </p>
              <p className="text-[14px] mb-3" style={{ color: '#4a5168' }}>
                Clique numa linha da tabela para incluir/tirar (até {MAX_CATS_GRAFICO})
                {selCats.length > 0 && (
                  <button className="ml-2 underline" onClick={() => setSelCats([])}>restaurar padrão</button>
                )}
              </p>
              <div style={{ height: 240 }}><Line data={chartCats} options={opcoesLinha} /></div>
            </div>
          </div>

          {/* Resumo anual */}
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl overflow-hidden mb-4">
            <div className="px-5 py-3 border-b border-white/10">
              <p className="text-[16px] font-bold flex items-center gap-1.5" style={{ color: '#e8eaf0' }}>
                Resumo anual
                <BotaoAjuda titulo="Resumo anual">
                  <p><b style={{ color: '#e8eaf0' }}>Resultado</b> = receitas − despesas do intervalo.</p>
                  <p><b style={{ color: '#e8eaf0' }}>Taxa de poupança</b> = resultado ÷ receitas: a parte da renda que sobrou. É comparável entre anos mesmo com inflação.</p>
                  <p><b style={{ color: '#e8eaf0' }}>Δ</b> compara o último ano com o primeiro: variação % nos modos de valores, pontos percentuais (pp) no modo % da receita. Verde = melhorou (receita subiu ou despesa caiu).</p>
                </BotaoAjuda>
              </p>
              <p className="text-[14px]" style={{ color: '#4a5168' }}>
                {NOMES_MES[mesIni - 1]}–{NOMES_MES[mesFim - 1]} em cada ano
              </p>
            </div>
            <div className="overflow-auto">
              <table className="w-full border-collapse">
                <thead style={{ background: '#1a1f2e' }}>
                  <tr>
                    <th className="px-4 py-2.5 border-b border-white/5 text-left">
                      <span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Indicador</span>
                    </th>
                    {cabAnos}
                  </tr>
                </thead>
                <tbody>
                  {pctMode ? (
                    <>
                      <LinhaTotal nome="Despesa / Receita" vals={calc.despPct} cor="#f87171" bomSeSobe={false} />
                      <LinhaTotal nome="Taxa de poupança" vals={calc.poupanca} cor="#4da6ff" bomSeSobe />
                    </>
                  ) : (
                    <>
                      <LinhaTotal nome="Receitas" vals={calc.rec} cor="#00c896" bomSeSobe />
                      <LinhaTotal nome="Despesas" vals={calc.desp} cor="#f87171" bomSeSobe={false} />
                      <LinhaTotal nome="Resultado" vals={calc.rec.map((r, i) => r - calc.desp[i])} cor="#4da6ff" bomSeSobe />
                      <tr className="border-b border-white/[0.03]">
                        <td className="px-4 py-2.5"><span className="text-[15px]" style={{ color: '#8b92a8' }}>Taxa de poupança</span></td>
                        {calc.poupanca.map((v, i) => (
                          <td key={calc.anos[i]} className="px-4 py-2.5 text-right">
                            <span className="text-[15px]" style={{ color: '#8b92a8' }}>{fmtPct(v)}</span>
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-right">
                          <span className="text-[15px]" style={{ color: '#8b92a8' }}>
                            {(() => { const d = calc.poupanca[calc.n - 1] - calc.poupanca[0]; return `${d >= 0 ? '+' : ''}${d.toFixed(1)} pp` })()}
                          </span>
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Categorias */}
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10">
              <p className="text-[16px] font-bold flex items-center gap-1.5" style={{ color: '#e8eaf0' }}>
                Categorias por ano
                <BotaoAjuda titulo="Categorias por ano">
                  <p><b style={{ color: '#e8eaf0' }}>Resumo</b> soma as subcategorias na categoria pai; <b style={{ color: '#e8eaf0' }}>Categoria</b> mostra cada uma em separado.</p>
                  <p>Transferências entre contas ficam de fora. Se uma categoria inverter de lado em algum ano (ex.: estorno maior que o gasto), o valor aparece negativo.</p>
                  <p>Clique no nome para incluir a categoria no gráfico.</p>
                </BotaoAjuda>
              </p>
              <p className="text-[14px]" style={{ color: '#4a5168' }}>
                {calc.receitas.length} receita · {calc.despesas.length} despesa · Δ = último ano vs {calc.anos[0]}
              </p>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 560 }}>
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10" style={{ background: '#1a1f2e' }}>
                  <tr>
                    <th className="px-4 py-2.5 border-b border-white/5 text-left">
                      <span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Categoria</span>
                    </th>
                    {cabAnos}
                  </tr>
                </thead>
                <tbody>
                  {calc.linhas.length === 0 && (
                    <tr><td colSpan={calc.n + 2} className="text-center py-10">
                      <span className="text-[15px]" style={{ color: '#4a5168' }}>Nenhum lançamento no intervalo escolhido</span>
                    </td></tr>
                  )}
                  {calc.receitas.length > 0 && (
                    <>
                      <tr style={{ background: 'rgba(0,200,150,0.06)' }}>
                        <td colSpan={calc.n + 2} className="px-4 py-1.5">
                          <span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#00c896' }}>
                            Receitas · {calc.receitas.length} categoria{calc.receitas.length !== 1 ? 's' : ''}
                          </span>
                        </td>
                      </tr>
                      {calc.receitas.map(l => <LinhaTabela key={l.key} l={l} />)}
                      <LinhaTotal nome="Total Receitas" cor="#00c896" bomSeSobe
                        vals={calc.anos.map((_, i) => pctMode ? (calc.rec[i] > 0 ? 100 : 0) : calc.rec[i])} />
                    </>
                  )}
                  {calc.despesas.length > 0 && (
                    <>
                      <tr style={{ background: 'rgba(248,113,113,0.06)' }}>
                        <td colSpan={calc.n + 2} className="px-4 py-1.5">
                          <span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#f87171' }}>
                            Despesas · {calc.despesas.length} categoria{calc.despesas.length !== 1 ? 's' : ''}
                          </span>
                        </td>
                      </tr>
                      {calc.despesas.map(l => <LinhaTabela key={l.key} l={l} />)}
                      <LinhaTotal nome="Total Despesas" cor="#f87171" bomSeSobe={false}
                        vals={calc.anos.map((_, i) => pctMode ? calc.despPct[i] : calc.desp[i])} />
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
