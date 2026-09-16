import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Pencil, Coins, Wallet, TrendingUp, TrendingDown, Star, Trash2, Plus, Minus, ExternalLink, ChevronLeft, ChevronRight, Calculator } from 'lucide-react'
import { Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, Tooltip, Legend,
  CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement,
} from 'chart.js'
import { useInvestimentoAtivo, useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes } from '../hooks/useInvestimentosPosicoes'
import { useInvestimentosHistorico } from '../hooks/useInvestimentosHistorico'
import { useDividendos } from '../hooks/useDividendos'
import { useInvestimentosOperacoes } from '../hooks/useInvestimentosOperacoes'
import { useInvestimentosDashboard } from '../hooks/useInvestimentosDashboard'
import { usePtax } from '../hooks/usePtax'
import { Drawer, BtnSalvar, BtnCancelar, Toast, ModalExcluir, LogoAtivo, SelectDark, Field, Input, InputMoeda } from '../components/ui/shared'
import DrawerAtivo from '../components/ui/DrawerAtivo'
import DrawerMovimentacoes from '../components/ui/DrawerMovimentacoes'
import LoadingMascote from '../components/ui/LoadingMascote'
import TutorialTour from '../components/ui/TutorialTour'
import { TUTORIAL_INVESTIMENTOS_DETALHE } from '../lib/tutoriaisPaginas'
import { formatBRL, formatData, formatUSD as fmtUSD } from '../lib/utils'
import {
  TIPO_ATIVO_LABEL, TIPO_ATIVO_COR, TIPO_OPERACAO_LABEL,
  INDEXADOR_RF_LABEL, INDEXADOR_RF_DESCRICAO, SUBTIPO_RF_INFO, FII_CATEGORIA_INFO,
  setorLabel,
} from '../lib/constants'
import { calcularNota, recomendacaoCompra } from '../lib/questionarioAtivos'
import { CRITERIOS_QUESTAO, CRITERIO_LABEL } from '../lib/constants'
import { useInvQuestionarios } from '../hooks/useInvQuestionarios'
import { useInvPerfil } from '../hooks/useInvPerfil'
import { useInvPesos } from '../hooks/useInvPesos'
import type { InvestimentoAtivo, QuestionarioRespostas, PerguntaAvaliacao, CriterioQuestao, TipoAtivoInvestimento } from '../types'

ChartJS.register(Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement)

const MUTED = '#8b92a8'
const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function fmtMes(anoMes: string): string {
  const [ano, m] = anoMes.split('-')
  return `${MESES_PT[parseInt(m) - 1]}/${ano.slice(2)}`
}

// Helpers de aritmética sobre "YYYY-MM" — usados pela paginação de 6 em 6
// meses do quadro "Últimos dividendos".
function mesParaIndice(anoMes: string): number {
  const [ano, m] = anoMes.split('-').map(Number)
  return ano * 12 + (m - 1)
}
function deslocarMes(anoMes: string, deltaMeses: number): string {
  const indice = mesParaIndice(anoMes) + deltaMeses
  const ano = Math.floor(indice / 12)
  const mes = (indice % 12) + 1
  return `${ano}-${String(mes).padStart(2, '0')}`
}

function corValor(v: number): string {
  if (v > 0) return '#00c896'
  if (v < 0) return '#ff5c7a'
  return MUTED
}

// Atalho pra página do ativo no investidor10 — cada categoria do site tem seu
// próprio caminho (ex.: investidor10.com.br/acoes/petr4/). Renda fixa e
// Tesouro Direto não têm página por papel individual lá, então ficam de fora
// (link não aparece pra esses tipos).
const INVESTIDOR10_CAMINHO: Partial<Record<TipoAtivoInvestimento, string>> = {
  ACOES:             'acoes',
  FII:               'fiis',
  ETF:               'etfs',
  STOCKS:            'stocks',
  REIT:              'reits',
  ETF_INTERNACIONAL: 'etfs-americanos',
  CRIPTOMOEDAS:      'criptomoedas',
}
function linkInvestidor10(ativo: InvestimentoAtivo): string | null {
  const caminho = INVESTIDOR10_CAMINHO[ativo.tipo_ativo]
  if (!caminho) return null
  return `https://investidor10.com.br/${caminho}/${ativo.ticker.toLowerCase()}/`
}

const PERIODOS_GRAFICO = [
  { value: 'mes_atual', label: 'Mês atual' },
  { value: '6',         label: '6 Meses' },
  { value: '12',        label: '12 Meses' },
  { value: 'tudo',      label: 'Tudo' },
]

const OPCOES_GRAFICO = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: MUTED }, grid: { color: 'rgba(255,255,255,0.05)' } },
    y: { ticks: { color: MUTED }, grid: { color: 'rgba(255,255,255,0.05)' } },
  },
} as const

export default function DetalheInvestimentoPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // De onde o usuário chegou (Meus ativos, Investimentos, etc.) — passado em
  // `state.from` pelo link de origem. Fallback p/ a lista quando veio de link
  // direto/refresh (sem histórico).
  const voltarPara = (location.state as { from?: string } | null)?.from ?? '/investimentos/ativos'
  // Volta de verdade no histórico (POP) quando há para onde voltar — assim o
  // AppLayout restaura a posição de scroll da página de origem. Sem histórico
  // (link direto/refresh), navega para o caminho conhecido.
  const voltar = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
    else navigate(voltarPara)
  }
  const ativoId = id ?? null
  const [toast, setToast] = useState<string | null>(null)
  // Toggle do gráfico de rentabilidade: somar os proventos do mês (total return)
  const [rentComDividendos, setRentComDividendos] = useState(false)
  // Período exibido nos gráficos mensais desta página (6/12 meses ou tudo)
  const [periodoGraficos, setPeriodoGraficos] = useState('12')
  const [editandoNota, setEditandoNota] = useState(false)
  const [editandoAtivo, setEditandoAtivo] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [salvandoExclusao, setSalvandoExclusao] = useState(false)
  const [gerenciar, setGerenciar] = useState(false)
  const [simulando, setSimulando] = useState(false)
  // Preenche "Nova movimentação" com os números da simulação quando o usuário
  // decide transformá-la numa compra de verdade (ver DrawerSimularCompra).
  const [prefilCompra, setPrefilCompra] = useState<{ quantidade: string; preco_unitario: string } | null>(null)
  const [provisionando, setProvisionando] = useState(false)

  const { ativo, loading, error } = useInvestimentoAtivo(ativoId)
  const { excluir, provisionarRendimentoCripto } = useInvestimentosAtivos()
  const { posicoes }  = useInvestimentosPosicoes(ativoId ? { ativo_id: ativoId } : {})
  const { historico } = useInvestimentosHistorico(ativoId ? { ativo_id: ativoId } : {})
  const { dividendos } = useDividendos(ativoId ? { ativo_id: ativoId } : {})
  const { operacoes } = useInvestimentosOperacoes(ativoId ? { ativo_id: ativoId } : {})
  const { dashboard } = useInvestimentosDashboard()

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(null), 3000) }

  async function provisionarRendimento() {
    setProvisionando(true)
    const res = await provisionarRendimentoCripto()
    setProvisionando(false)
    if (!res.ok) { showToast(res.erro ?? 'Erro ao provisionar rendimento'); return }
    const n = res.dados?.operacoes_criadas ?? 0
    showToast(n === 0
      ? 'Nenhum rendimento a creditar ainda.'
      : `Rendimento atualizado — ${n} crédito(s) semanais na posição.`)
  }

  // Resumo: custo das posições ativas; mercado = snapshot mais recente por conta
  const resumo = useMemo(() => {
    const ativas = posicoes.filter((p) => p.status === 'ATIVA')
    const custo = ativas.reduce((s, p) => s + Number(p.valor_custo), 0)
    const ultimoPorConta = new Map<string, { mes: string; valor: number }>()
    for (const h of historico) {
      const atual = ultimoPorConta.get(h.conta_id)
      if (!atual || h.mes_ano > atual.mes) ultimoPorConta.set(h.conta_id, { mes: h.mes_ano, valor: Number(h.valor_mercado) })
    }
    const contasComSnapshot = new Set(ultimoPorConta.keys())
    const custoSemSnapshot = ativas
      .filter((p) => !contasComSnapshot.has(p.conta_id))
      .reduce((s, p) => s + Number(p.valor_custo), 0)
    const mercado = [...ultimoPorConta.values()].reduce((s, v) => s + v.valor, 0) + custoSemSnapshot
    const totalDiv = dividendos.reduce((s, d) => s + Number(d.valor), 0)
    return { custo, mercado, ganho: mercado - custo, dividendos: totalDiv }
  }, [posicoes, historico, dividendos])

  // Quantidade atual de cotas/ações (soma das posições ATIVAS) — usada tanto
  // na estimativa de cotação quanto no cálculo do Magic Number (FIIs).
  const qtdAtual = useMemo(
    () => posicoes.filter((p) => p.status === 'ATIVA').reduce((s, p) => s + Number(p.quantidade), 0),
    [posicoes],
  )

  // Cotação estimada: valor de mercado do último snapshot (resumo.mercado) ÷
  // quantidade ATUAL das posições (posicoes, sempre em dia) — não a quantidade
  // que o snapshot tinha NA DATA dele, que fica desatualizada entre um
  // fechamento mensal e outro (ex.: rendimento semanal de cripto aumenta a
  // quantidade toda semana, mas o valor_mercado só é recalculado no mês
  // seguinte). Mesmo método da coluna "Preço atual" do ranking. Usada só para
  // dar um R$ aproximado ao total de RENDIMENTO, que só registra tokens (sem
  // valor_total, pois é yield em cripto).
  const precoAtualEstimado = useMemo(
    () => (qtdAtual > 0 ? resumo.mercado / qtdAtual : null),
    [qtdAtual, resumo.mercado],
  )

  // Magic Number (FIIs): quantas cotas seriam necessárias para que o próprio
  // dividendo mensal já compre 1 cota nova, sem precisar de aporte externo
  // ("efeito bola de neve"). Usa o dividendo por cota mais recente disponível
  // (dividendos vem ordenado do mais novo para o mais antigo).
  const magicNumberFII = useMemo(() => {
    if (ativo?.tipo_ativo !== 'FII' || !precoAtualEstimado || precoAtualEstimado <= 0) return null
    const ultimoDiv = dividendos.find((d) => d.valor_por_cota != null && Number(d.valor_por_cota) > 0)
    const valorPorCota = ultimoDiv ? Number(ultimoDiv.valor_por_cota) : null
    if (!valorPorCota || valorPorCota <= 0) return null
    const cotasNecessarias = Math.ceil(precoAtualEstimado / valorPorCota)
    const diferenca = cotasNecessarias - qtdAtual
    // Já com o Magic Number atingido: quantas cotas os dividendos das cotas
    // que o usuário JÁ TEM (não só as "necessárias") compram por período.
    const cotasCompraveis = diferenca <= 0 ? Math.floor((qtdAtual * valorPorCota) / precoAtualEstimado) : 0
    return {
      precoCota: precoAtualEstimado,
      valorPorCota,
      cotasNecessarias,
      totalInvestido: cotasNecessarias * precoAtualEstimado,
      diferenca,
      valorFaltante: diferenca > 0 ? diferenca * precoAtualEstimado : 0,
      cotasCompraveis,
    }
  }, [ativo?.tipo_ativo, precoAtualEstimado, dividendos, qtdAtual])

  // Janela do período selecionado (6/12 meses ou "tudo") para os gráficos
  // mensais desta página. mesInicio null = sem limite inferior (tudo).
  const janela = useMemo(() => {
    const hoje = new Date()
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
    if (periodoGraficos === 'tudo') return { mesInicio: null as string | null, mesAtual }
    if (periodoGraficos === 'mes_atual') return { mesInicio: mesAtual, mesAtual }
    const n = Number(periodoGraficos)
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - (n - 1), 1)
    const mesInicio = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`
    return { mesInicio, mesAtual }
  }, [periodoGraficos])
  const dentroJanela = (mes: string) =>
    mes <= janela.mesAtual && (janela.mesInicio == null || mes >= janela.mesInicio)
  const labelSemDados = periodoGraficos === 'tudo' ? 'no período'
    : periodoGraficos === 'mes_atual' ? 'no mês atual'
    : `nos últimos ${periodoGraficos} meses`

  // Evolução mensal (soma de todas as contas por mês, ordem cronológica)
  const evolucao = useMemo(() => {
    const porMes = new Map<string, number>()
    for (const h of historico) {
      if (!dentroJanela(h.mes_ano)) continue
      porMes.set(h.mes_ano, (porMes.get(h.mes_ano) ?? 0) + Number(h.valor_mercado))
    }
    return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historico, janela])

  // Proventos realizados por mês (todo o histórico, sem meses futuros) —
  // usado pela opção "total return" do gráfico de rentabilidade.
  const divPagoPorMes = useMemo(() => {
    const hoje = new Date()
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
    const porMes = new Map<string, number>()
    for (const d of dividendos) {
      const mes = d.data_pagamento.slice(0, 7)
      if (mes <= mesAtual) porMes.set(mes, (porMes.get(mes) ?? 0) + Number(d.valor))
    }
    return porMes
  }, [dividendos])

  // Rentabilidade mensal agregada entre contas: Σ rentabilidade_mes (já
  // descontados aportes/resgates no backend) ÷ valor de mercado do mês
  // anterior. Com o toggle ligado, soma os proventos do mês (total return).
  // Calculada sobre a série INTEIRA (não a janela): o % de um mês depende do
  // mês anterior, então cortar a série cedo demais distorceria o 1º ponto.
  const rentPorMes = useMemo(() => {
    const valor  = new Map<string, number>()
    const rentab = new Map<string, number>()
    for (const h of historico) {
      valor.set(h.mes_ano, (valor.get(h.mes_ano) ?? 0) + Number(h.valor_mercado))
      rentab.set(h.mes_ano, (rentab.get(h.mes_ano) ?? 0) + Number(h.rentabilidade_mes))
    }
    const meses = [...valor.keys()].sort()
    const out: (readonly [string, number])[] = []
    for (let i = 1; i < meses.length; i++) {
      const prev = valor.get(meses[i - 1])!
      if (!(prev > 0)) continue
      const extra = rentComDividendos ? (divPagoPorMes.get(meses[i]) ?? 0) : 0
      out.push([meses[i], ((rentab.get(meses[i])! + extra) / prev) * 100] as const)
    }
    return out
  }, [historico, divPagoPorMes, rentComDividendos])

  // Recorte da janela selecionada, só para exibição no gráfico de barras.
  const rentPorMesJanela = useMemo(
    () => rentPorMes.filter(([mes]) => dentroJanela(mes)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rentPorMes, janela],
  )

  // Rentabilidade acumulada dentro da janela: compõe os % mensais a partir do
  // 1º mês exibido (rebase em 0%) — mostra o retorno total do período em tela.
  const rentAcumulada = useMemo(() => {
    let acc = 1
    return rentPorMesJanela.map(([mes, v]) => {
      acc *= 1 + v / 100
      return [mes, (acc - 1) * 100] as const
    })
  }, [rentPorMesJanela])

  // Dividendos dentro do período selecionado — exclui projeções de meses
  // futuros tanto dos gráficos quanto da lista de dividendos.
  const divFiltrados = useMemo(
    () => dividendos.filter((d) => dentroJanela(d.data_pagamento.slice(0, 7))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dividendos, janela],
  )

  // Paginação do quadro "Últimos dividendos": blocos de 6 meses (mais recente
  // primeiro), pra não listar de uma vez todo o período selecionado no topo
  // (ex.: "Tudo"). Reinicia na página mais recente ao trocar de ativo/período.
  const [paginaDividendos, setPaginaDividendos] = useState(0)
  useEffect(() => { setPaginaDividendos(0) }, [ativoId, periodoGraficos])
  const divPaginacao = useMemo(() => {
    if (divFiltrados.length === 0) {
      return { itens: [] as typeof divFiltrados, pagina: 0, totalPaginas: 0, mesInicio: '', mesFim: '' }
    }
    const mesMaisAntigo = divFiltrados.reduce(
      (m, d) => { const mes = d.data_pagamento.slice(0, 7); return mes < m ? mes : m },
      janela.mesAtual,
    )
    const totalMeses = mesParaIndice(janela.mesAtual) - mesParaIndice(mesMaisAntigo) + 1
    const totalPaginas = Math.max(1, Math.ceil(totalMeses / 6))
    const pagina = Math.min(paginaDividendos, totalPaginas - 1)
    const mesFim = deslocarMes(janela.mesAtual, -6 * pagina)
    const mesInicio = deslocarMes(mesFim, -5)
    const itens = divFiltrados.filter((d) => {
      const mes = d.data_pagamento.slice(0, 7)
      return mes >= mesInicio && mes <= mesFim
    })
    return { itens, pagina, totalPaginas, mesInicio, mesFim }
  }, [divFiltrados, janela, paginaDividendos])

  // Dividendos agregados por mês (período selecionado)
  const divPorMes = useMemo(() => {
    const porMes = new Map<string, number>()
    for (const d of divFiltrados) {
      const mes = d.data_pagamento.slice(0, 7)
      porMes.set(mes, (porMes.get(mes) ?? 0) + Number(d.valor))
    }
    return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [divFiltrados])

  // Dividend Yield mensal POR COTA: rate do mês (dividendo por cota) ÷
  // cotação do mês (valor de mercado ÷ quantidade do snapshot). Comprar mais
  // cotas muda o valor recebido, não o rate — o % fica comparável mês a mês.
  const dyPorMes = useMemo(() => {
    // cotação do mês = Σ valor_mercado ÷ Σ quantidade (todas as contas)
    const snapPorMes = new Map<string, { valor: number; qtd: number }>()
    for (const h of historico) {
      const s = snapPorMes.get(h.mes_ano) ?? { valor: 0, qtd: 0 }
      s.valor += Number(h.valor_mercado)
      s.qtd   += Number(h.quantidade) || 0
      snapPorMes.set(h.mes_ano, s)
    }
    // rate do mês: 1× por pagamento (data|tipo) — há 1 linha por conta
    const ratePorMes = new Map<string, number>()
    const semRatePorMes = new Map<string, number>() // recebido sem rate gravado
    const vistos = new Set<string>()
    for (const d of divFiltrados) {
      const mes = d.data_pagamento.slice(0, 7)
      const vpc = d.valor_por_cota != null ? Number(d.valor_por_cota) : NaN
      if (Number.isFinite(vpc) && vpc > 0) {
        const k = `${d.data_pagamento}|${d.tipo_dividendo_id ?? ''}`
        if (vistos.has(k)) continue
        vistos.add(k)
        ratePorMes.set(mes, (ratePorMes.get(mes) ?? 0) + vpc)
      } else {
        semRatePorMes.set(mes, (semRatePorMes.get(mes) ?? 0) + Number(d.valor))
      }
    }
    const meses = [...new Set([...ratePorMes.keys(), ...semRatePorMes.keys()])].sort()
    const out: (readonly [string, number])[] = []
    for (const mes of meses) {
      const s = snapPorMes.get(mes)
      if (!s || !(s.qtd > 0) || !(s.valor > 0)) continue
      const cotacao = s.valor / s.qtd
      // sem rate gravado, estima pelo recebido ÷ cotas do snapshot do mês
      const rate = (ratePorMes.get(mes) ?? 0) + (semRatePorMes.get(mes) ?? 0) / s.qtd
      if (rate > 0) out.push([mes, (rate / cotacao) * 100] as const)
    }
    return out
  }, [divFiltrados, historico])

  // Operações do ativo separadas: compras/aportes × rendimentos (yield).
  // Rendimentos (RENDIMENTO) têm valor_total 0 e podem ser muitos (semanais),
  // então vão num grupo próprio, exibidos como tokens creditados.
  const { compras, rendimentos, totalRendimento } = useMemo(() => {
    const posIds = new Set(posicoes.map((p) => p.id))
    const doAtivo = operacoes.filter((o) => posIds.has(o.posicao_id))
    const rend = doAtivo.filter((o) => o.tipo_operacao === 'RENDIMENTO')
    return {
      compras: doAtivo.filter((o) => o.tipo_operacao !== 'RENDIMENTO'),
      rendimentos: rend,
      totalRendimento: rend.reduce((s, o) => s + Number(o.quantidade), 0),
    }
  }, [operacoes, posicoes])

  // Paginação do quadro "Operações recentes": 6 por página (operações já vêm
  // ordenadas da mais recente para a mais antiga). Reinicia ao trocar de ativo.
  const [paginaOperacoes, setPaginaOperacoes] = useState(0)
  useEffect(() => { setPaginaOperacoes(0) }, [ativoId])
  const totalPaginasOperacoes = Math.max(1, Math.ceil(compras.length / 6))
  const paginaOperacoesEfetiva = Math.min(paginaOperacoes, totalPaginasOperacoes - 1)
  const comprasPaginadas = useMemo(
    () => compras.slice(paginaOperacoesEfetiva * 6, paginaOperacoesEfetiva * 6 + 6),
    [compras, paginaOperacoesEfetiva],
  )

  // Resumo GERAL de compras × vendas (todo o histórico do ativo, não só o
  // período selecionado no topo da página) — entrada = COMPRA/APORTE, saída =
  // VENDA/RESGATE. Resultado = entrada − saída, tanto em quantidade quanto em
  // R$. RENDIMENTO (yield de cripto) fica à parte, só soma tokens.
  const resumoComprasVendas = useMemo(() => {
    const posIds = new Set(posicoes.map((p) => p.id))
    let qtdEntrada = 0, valorEntrada = 0
    let qtdSaida = 0, valorSaida = 0
    let qtdRendimento = 0
    for (const o of operacoes) {
      if (!posIds.has(o.posicao_id)) continue
      if (o.tipo_operacao === 'RENDIMENTO') { qtdRendimento += Number(o.quantidade); continue }
      const saida = o.tipo_operacao === 'VENDA' || o.tipo_operacao === 'RESGATE'
      if (saida) { qtdSaida += Number(o.quantidade); valorSaida += Number(o.valor_total) }
      else       { qtdEntrada += Number(o.quantidade); valorEntrada += Number(o.valor_total) }
    }
    return {
      qtdEntrada, valorEntrada,
      qtdSaida, valorSaida,
      qtdLiquida: qtdEntrada - qtdSaida,
      valorLiquido: valorEntrada - valorSaida,
      qtdRendimento,
    }
  }, [operacoes, posicoes])
  const fmtTokens = (q: number) => Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 8 })

  // ── Conversão cambial (ativos em moeda estrangeira) ────────────
  // Só as POSIÇÕES (inv_posicoes.valor_custo) ficam na moeda do ativo (ex.:
  // USD) — convertemos o CUSTO para BRL com a PTAX da DATA DA COMPRA. Já os
  // snapshots (inv_historico_mensal.valor_mercado) e os dividendos
  // (inv_dividendos.valor) são gravados EM BRL pelo backend (cotação × PTAX
  // na hora da gravação) — usar direto, reconverter aqui multiplicava tudo
  // pela PTAX de novo (~5× no caso USD).
  const moeda = (ativo?.moeda ?? 'BRL').toUpperCase()
  const ehMoedaEstrangeira = moeda !== 'BRL'
  // Operações ficam na moeda do ativo → exibe com o símbolo certo (US$/R$).
  const fmtNativo = ehMoedaEstrangeira ? fmtUSD : formatBRL
  const datasPtax = useMemo(
    () => [...new Set(posicoes.map((p) => p.data_compra).filter(Boolean))],
    [posicoes],
  )
  const { atual: ptaxAtual, atualData: ptaxData, taxaEm } = usePtax(datasPtax, ehMoedaEstrangeira)

  const resumoConvertido = useMemo(() => {
    if (!ehMoedaEstrangeira) return null
    const taxaAtual = ptaxAtual ?? 0
    const ativas = posicoes.filter((p) => p.status === 'ATIVA')
    const custo = ativas.reduce((s, p) => s + Number(p.valor_custo) * (taxaEm(p.data_compra) ?? taxaAtual), 0)
    // mercado: snapshot mais recente por conta (já em BRL); posições sem
    // snapshot caem para o custo convertido na data da compra.
    const ultimoPorConta = new Map<string, number>()
    const mesPorConta = new Map<string, string>()
    for (const h of historico) {
      const m = mesPorConta.get(h.conta_id)
      if (!m || h.mes_ano > m) { mesPorConta.set(h.conta_id, h.mes_ano); ultimoPorConta.set(h.conta_id, Number(h.valor_mercado)) }
    }
    let mercado = [...ultimoPorConta.values()].reduce((s, v) => s + v, 0)
    for (const p of ativas) {
      if (!ultimoPorConta.has(p.conta_id)) mercado += Number(p.valor_custo) * (taxaEm(p.data_compra) ?? taxaAtual)
    }
    const divs = dividendos.reduce((s, d) => s + Number(d.valor), 0)
    // Originais em USD para o subtítulo dos cards: custo é nativo (soma das
    // posições); mercado/dividendos estão em BRL → divide pela PTAX atual.
    const custoUSD = ativas.reduce((s, p) => s + Number(p.valor_custo), 0)
    const usd = taxaAtual > 0 ? {
      custo:      custoUSD,
      mercado:    mercado / taxaAtual,
      ganho:      mercado / taxaAtual - custoUSD,
      dividendos: divs / taxaAtual,
    } : null
    return { custo, mercado, ganho: mercado - custo, dividendos: divs, usd }
  }, [ehMoedaEstrangeira, posicoes, historico, dividendos, taxaEm, ptaxAtual])

  if (loading) return <LoadingMascote />
  if (error || !ativo) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[14px] text-red-300">
          {error ?? 'Ativo não encontrado'}
        </div>
        <button onClick={voltar} className="inline-flex items-center gap-1.5 mt-4 text-[13px] text-white/70 hover:text-white">
          <ArrowLeft size={14} /> Voltar
        </button>
      </div>
    )
  }

  const cor = TIPO_ATIVO_COR[ativo.tipo_ativo]
  // Renda fixa, Tesouro e cripto não pagam proventos → escondem os quadros de dividendos.
  const podeDividendos = !['RENDA_FIXA', 'TESOURO_DIRETO', 'CRIPTOMOEDAS'].includes(ativo.tipo_ativo)
  const ehRendaFixaAtivo = ativo.tipo_ativo === 'RENDA_FIXA' || ativo.tipo_ativo === 'TESOURO_DIRETO'
  const urlInvestidor10 = linkInvestidor10(ativo)

  async function confirmarExclusao() {
    if (!ativo) return
    setSalvandoExclusao(true)
    const res = await excluir(ativo.id)
    setSalvandoExclusao(false)
    if (res.ok) voltar()
    else { setExcluindo(false); showToast(res.erro ?? 'Erro ao excluir o ativo') }
  }

  // Recomendação de compra: nota do usuário × desvio da alocação ideal do tipo
  const tipoDash = dashboard?.tipos.find((t) => t.tipo_ativo === ativo.tipo_ativo)
  const recomendacao = recomendacaoCompra(
    ativo.nota_usuario,
    tipoDash && tipoDash.percentual_ideal > 0 ? tipoDash.desvio_pct : null,
  )
  const COR_RECOMENDACAO = { COMPRAR: '#00c896', NEUTRO: '#8b92a8', AGUARDAR: '#ffb74d' } as const

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={voltar} title="Voltar" className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
            <ArrowLeft size={15} />
          </button>
          <LogoAtivo url={ativo.logo_url} size={36} tipoAtivo={ativo.tipo_ativo} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[22px] font-bold text-white">{ativo.ticker}</h1>
              <span className="inline-flex items-center gap-1.5 text-[12px] px-2 py-0.5 rounded-full"
                style={{ background: `${cor}22`, color: cor }}>
                {TIPO_ATIVO_LABEL[ativo.tipo_ativo]}
              </span>
              {setorLabel(ativo.setor) && (
                <span className="inline-flex items-center text-[12px] px-2 py-0.5 rounded-full border border-white/15"
                  style={{ color: MUTED }}>
                  {setorLabel(ativo.setor)}
                </span>
              )}
              {urlInvestidor10 && (
                <a href={urlInvestidor10} target="_blank" rel="noopener noreferrer"
                  title="Abrir página do ativo no investidor10"
                  className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full border border-white/15 hover:border-white/30 hover:text-white/90"
                  style={{ color: MUTED }}>
                  <ExternalLink size={11} /> investidor10
                </a>
              )}
            </div>
            <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>{ativo.nome}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap" data-tutorial="detalhe-header">
          {recomendacao && (
            <span title={recomendacao.motivo}
              className="inline-flex items-center text-[12px] px-2.5 py-1 rounded-full font-medium"
              style={{ background: `${COR_RECOMENDACAO[recomendacao.recomendacao]}22`, color: COR_RECOMENDACAO[recomendacao.recomendacao] }}>
              {recomendacao.recomendacao === 'COMPRAR' ? 'Comprar' : recomendacao.recomendacao === 'AGUARDAR' ? 'Aguardar' : 'Neutro'}
            </span>
          )}
          <button onClick={() => setEditandoNota(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
            <Star size={14} style={{ color: '#f0b429' }} />
            Nota: {ativo.nota_usuario ?? '—'}
            <Pencil size={12} style={{ color: MUTED }} />
          </button>
          {ativo.tipo_ativo === 'CRIPTOMOEDAS' && Number(ativo.cripto_rendimento_aa) > 0 && (
            <button onClick={provisionarRendimento} disabled={provisionando}
              title={`Credita o rendimento de ${ativo.cripto_rendimento_aa}% a.a. em mais tokens (operações RENDIMENTO)`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25 disabled:opacity-60">
              <Coins size={14} className={provisionando ? 'animate-spin' : ''} style={{ color: '#00c896' }} />
              {provisionando ? 'Provisionando…' : 'Provisionar rendimento'}
            </button>
          )}
          <button onClick={() => setGerenciar(true)} title="Registrar compra, venda ou outra movimentação"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-white"
            style={{ background: '#3b82f6' }}>
            <Plus size={14} /> Nova movimentação
          </button>
          {!ehRendaFixaAtivo && (
            <button onClick={() => setSimulando(true)} title="Simular quantas cotas/ações dá para comprar com um valor"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
              <Calculator size={14} style={{ color: MUTED }} /> Simular compra
            </button>
          )}
          <button onClick={() => setEditandoAtivo(true)} title="Editar dados do ativo"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
            <Pencil size={14} style={{ color: MUTED }} /> Editar
          </button>
          <button onClick={() => setExcluindo(true)} title="Excluir ativo"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] transition-colors hover:bg-red-400/10"
            style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#ff5c7a' }}>
            <Trash2 size={14} /> Excluir
          </button>
        </div>
      </div>

      {recomendacao && (
        <p className="text-[12px] -mt-2 mb-4 text-right" style={{ color: MUTED }}>{recomendacao.motivo}</p>
      )}

      <Toast msg={toast} />

      {/* Cotação do dólar (ativos em moeda estrangeira) */}
      {ehMoedaEstrangeira && (
        <div className="mb-4 flex items-center gap-2 text-[13px] rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2" style={{ color: MUTED }}>
          <span className="font-medium text-white/80">Moeda: {moeda}</span>
          <span>·</span>
          {ptaxAtual != null ? (
            <span>Dólar PTAX{ptaxData ? ` (${formatData(ptaxData)})` : ''}: <span className="text-white/90 font-medium">{formatBRL(ptaxAtual)}</span></span>
          ) : (
            <span>Cotação PTAX indisponível no momento.</span>
          )}
        </div>
      )}

      {/* Cards de resumo — em BRL (com o valor original em USD quando estrangeiro) */}
      {(() => {
        const r = resumoConvertido ?? resumo
        const usd = resumoConvertido?.usd
        const sub = (v?: number) => (v != null ? fmtUSD(v) : undefined)
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" data-tutorial="detalhe-cards">
            <CardMini icone={<Wallet size={14} />} titulo="Valor de mercado" valor={formatBRL(r.mercado)} sub={sub(usd?.mercado)} />
            <CardMini icone={<Coins size={14} />} titulo="Custo" valor={formatBRL(r.custo)} sub={sub(usd?.custo)} />
            <CardMini icone={r.ganho >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              titulo="Ganho / Prejuízo"
              valor={`${r.ganho >= 0 ? '+' : ''}${formatBRL(r.ganho)}`} cor={corValor(r.ganho)} sub={sub(usd?.ganho)} />
            <CardMini icone={<Coins size={14} />} titulo="Dividendos" valor={formatBRL(r.dividendos)} cor="#00c896" sub={sub(usd?.dividendos)} />
          </div>
        )
      })()}

      {/* Características do título (renda fixa / Tesouro) e do FII */}
      <CaracteristicasAtivo ativo={ativo} valorInvestido={resumo.custo} />

      <div className="flex items-center justify-end gap-2 mb-3">
        <span className="text-[12px]" style={{ color: MUTED }}>Período dos gráficos:</span>
        <SelectDark value={periodoGraficos} onChange={(e) => setPeriodoGraficos(e.target.value)}
          style={{ width: 'auto' }} className="!text-[13px] !py-1.5">
          {PERIODOS_GRAFICO.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </SelectDark>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-tutorial="detalhe-graficos">
        {/* Evolução do valor de mercado */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-[14px] font-semibold text-white/80 mb-3">Evolução mensal</h2>
          {evolucao.length < 2 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>
              Registre o valor de mercado de pelo menos 2 meses para ver o gráfico.
            </p>
          ) : (
            <Line
              data={{
                labels: evolucao.map(([mes]) => fmtMes(mes)),
                datasets: [{
                  label: 'Valor de mercado',
                  data: evolucao.map(([, v]) => v),
                  borderColor: cor,
                  backgroundColor: `${cor}22`,
                  fill: true,
                  tension: 0.3,
                  pointRadius: evolucao.length <= 12 ? 4 : 2,
                  pointBackgroundColor: cor,
                }],
              }}
              options={OPCOES_GRAFICO}
            />
          )}
        </section>

        {/* Rentabilidade mensal */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-[14px] font-semibold text-white/80">Rentabilidade do mês (%)</h2>
            {podeDividendos && (
              <button onClick={() => setRentComDividendos((v) => !v)}
                aria-pressed={rentComDividendos}
                title="Soma os proventos recebidos no mês à variação de preço (total return)"
                className={`px-2.5 py-1 rounded-lg text-[12px] font-medium border ${
                  rentComDividendos
                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                    : 'border-white/15 text-white/70 hover:border-white/30'
                }`}>
                + dividendos
              </button>
            )}
          </div>
          {rentPorMesJanela.length === 0 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>
              Sem dados suficientes de variação mensal.
            </p>
          ) : (
            <Bar
              data={{
                labels: rentPorMesJanela.map(([mes]) => fmtMes(mes)),
                datasets: [{
                  label: rentComDividendos ? 'Variação + dividendos %' : 'Variação %',
                  data: rentPorMesJanela.map(([, v]) => Number(v.toFixed(2))),
                  backgroundColor: rentPorMesJanela.map(([, v]) => v >= 0 ? '#00c896aa' : '#ff5c7aaa'),
                  borderRadius: 4,
                }],
              }}
              options={OPCOES_GRAFICO}
            />
          )}
        </section>

        {/* Rentabilidade acumulada no período (compõe os % mensais) */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-[14px] font-semibold text-white/80 mb-3"
            title="Composição da variação mensal desde o início do período selecionado">
            Rentabilidade acumulada (%){rentComDividendos ? ' — com dividendos' : ''}
          </h2>
          {rentAcumulada.length === 0 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>
              Sem dados suficientes de variação mensal.
            </p>
          ) : (
            <Line
              data={{
                labels: rentAcumulada.map(([mes]) => fmtMes(mes)),
                datasets: [{
                  label: 'Acumulado %',
                  data: rentAcumulada.map(([, v]) => Number(v.toFixed(2))),
                  borderColor: cor,
                  backgroundColor: `${cor}22`,
                  fill: true,
                  tension: 0.3,
                  pointRadius: rentAcumulada.length <= 12 ? 4 : 2,
                  pointBackgroundColor: cor,
                }],
              }}
              options={OPCOES_GRAFICO}
            />
          )}
        </section>

        {/* Dividendos mensais — só para ativos que pagam proventos */}
        {podeDividendos && (
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h2 className="text-[14px] font-semibold text-white/80 mb-3">Dividendos por mês</h2>
            {divPorMes.length === 0 ? (
              <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>Nenhum dividendo {labelSemDados}.</p>
            ) : (
              <Bar
                data={{
                  labels: divPorMes.map(([mes]) => fmtMes(mes)),
                  datasets: [{
                    label: 'Dividendos',
                    data: divPorMes.map(([, v]) => v),
                    backgroundColor: '#00c896aa',
                    borderRadius: 4,
                  }],
                }}
                options={OPCOES_GRAFICO}
              />
            )}
          </section>
        )}

        {/* Dividend Yield mensal — só quando há provento E snapshot de mercado */}
        {podeDividendos && dyPorMes.length > 0 && (
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h2 className="text-[14px] font-semibold text-white/80 mb-3"
              title="Dividendos recebidos no mês ÷ valor de mercado da posição no mês">
              Dividend Yield por mês (%)
            </h2>
            <Bar
              data={{
                labels: dyPorMes.map(([mes]) => fmtMes(mes)),
                datasets: [{
                  label: 'DY %',
                  data: dyPorMes.map(([, v]) => Number(v.toFixed(2))),
                  backgroundColor: `${cor}aa`,
                  borderRadius: 4,
                }],
              }}
              options={OPCOES_GRAFICO}
            />
          </section>
        )}

        {/* Últimos dividendos — só para ativos que pagam proventos */}
        {podeDividendos && (
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-[14px] font-semibold text-white/80">Últimos dividendos</h2>
              {divPaginacao.totalPaginas > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPaginaDividendos((p) => p + 1)}
                    disabled={divPaginacao.pagina >= divPaginacao.totalPaginas - 1}
                    title="6 meses mais antigos"
                    aria-label="6 meses mais antigos"
                    className="flex items-center justify-center h-6 w-6 rounded-md border border-white/10 text-white/70
                               hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span className="text-[11px] whitespace-nowrap" style={{ color: MUTED }}>
                    Página {divPaginacao.pagina + 1}/{divPaginacao.totalPaginas}
                  </span>
                  <button
                    onClick={() => setPaginaDividendos((p) => Math.max(0, p - 1))}
                    disabled={divPaginacao.pagina <= 0}
                    title="6 meses mais recentes"
                    aria-label="6 meses mais recentes"
                    className="flex items-center justify-center h-6 w-6 rounded-md border border-white/10 text-white/70
                               hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              )}
            </div>
            {divPaginacao.itens.length === 0 ? (
              <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>Nenhum dividendo {labelSemDados}.</p>
            ) : (
              <div className="space-y-2">
                {divPaginacao.itens.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <div>
                      <p className="text-white font-medium">{d.inv_tipos_dividendo?.nome ?? 'Dividendo'}</p>
                      <p style={{ color: MUTED }}>{formatData(d.data_pagamento)}
                        {d.transacoes?.status === 'PROJECAO' && <span className="ml-1.5" style={{ color: '#ffb74d' }}>· projetado</span>}
                      </p>
                    </div>
                    <span className="font-semibold" style={{ color: '#00c896' }}>{formatBRL(d.valor)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Magic Number — só para FIIs, quando há cotação e último dividendo por cota */}
        {magicNumberFII && (
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-start gap-2 mb-3">
              <span className="flex items-center justify-center w-7 h-7 rounded-full border border-white/15 text-[13px] font-semibold flex-shrink-0" style={{ color: MUTED }}>
                ƒ
              </span>
              <div>
                <h2 className="text-[14px] font-semibold text-white/80">Magic Number do FII</h2>
                <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>
                  O número de cotas que permite comprar novas cotas só com os dividendos pagos por elas, sem precisar de novos aportes — o efeito bola de neve.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-stretch gap-2">
              <CaixaMagicNumber rotulo="Valor atual da cota" valor={formatBRL(magicNumberFII.precoCota)} />
              <span className="self-center text-[15px] px-1" style={{ color: MUTED }}>÷</span>
              <CaixaMagicNumber rotulo="Último dividendo por cota" valor={formatBRL(magicNumberFII.valorPorCota)} />
              <span className="self-center text-[15px] px-1" style={{ color: MUTED }}>=</span>
              <CaixaMagicNumber rotulo="Cotas para o efeito bola de neve" valor={`${magicNumberFII.cotasNecessarias} cotas`} destaque />
            </div>

            <p className="text-center text-[12px] my-2" style={{ color: MUTED }}>Ou</p>

            <div className="flex flex-wrap items-stretch gap-2">
              <CaixaMagicNumber rotulo="Cotas" valor={String(magicNumberFII.cotasNecessarias)} />
              <span className="self-center text-[15px] px-1" style={{ color: MUTED }}>×</span>
              <CaixaMagicNumber rotulo="Valor atual da cota" valor={formatBRL(magicNumberFII.precoCota)} />
              <span className="self-center text-[15px] px-1" style={{ color: MUTED }}>=</span>
              <CaixaMagicNumber rotulo="Total investido necessário" valor={formatBRL(magicNumberFII.totalInvestido)} destaque />
            </div>

            <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between flex-wrap gap-2">
              <span className="text-[13px]" style={{ color: MUTED }}>
                Você tem <span className="text-white font-medium">{qtdAtual} cota{qtdAtual === 1 ? '' : 's'}</span>
              </span>
              {magicNumberFII.diferenca > 0 ? (
                <span className="text-[13px] font-semibold text-right" style={{ color: '#ffb74d' }}>
                  Faltam {magicNumberFII.diferenca} cota{magicNumberFII.diferenca === 1 ? '' : 's'} para o Magic Number
                  <span className="block font-normal" style={{ color: MUTED }}>
                    ≈ {formatBRL(magicNumberFII.valorFaltante)} a mais investidos
                  </span>
                </span>
              ) : (
                <span className="text-[13px] font-semibold text-right" style={{ color: '#00c896' }}>
                  Magic Number atingido — sobram {-magicNumberFII.diferenca} cota{-magicNumberFII.diferenca === 1 ? '' : 's'}
                  <span className="block font-normal" style={{ color: MUTED }}>
                    Os dividendos já compram {magicNumberFII.cotasCompraveis} cota{magicNumberFII.cotasCompraveis === 1 ? '' : 's'} nova{magicNumberFII.cotasCompraveis === 1 ? '' : 's'} a cada pagamento
                  </span>
                </span>
              )}
            </div>
          </section>
        )}

        {/* Operações recentes */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4" data-tutorial="detalhe-operacoes">
          <h2 className="text-[14px] font-semibold text-white/80 mb-3">Operações recentes</h2>

          {/* Resumo GERAL do ativo (todo o histórico, não só o período
              selecionado no topo da página): compras × vendas × resultado. */}
          {(resumoComprasVendas.qtdEntrada > 0 || resumoComprasVendas.qtdSaida > 0 || resumoComprasVendas.qtdRendimento > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              {resumoComprasVendas.qtdEntrada > 0 && (
                <div className="rounded-lg border border-white/10 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
                    {ehRendaFixaAtivo ? 'Aportes' : 'Compras'}
                  </p>
                  <p className="font-semibold text-[13px]" style={{ color: '#00c896' }}>{fmtNativo(resumoComprasVendas.valorEntrada)}</p>
                  <p className="text-[11px]" style={{ color: MUTED }}>Qtd: {fmtTokens(resumoComprasVendas.qtdEntrada)}</p>
                </div>
              )}
              {resumoComprasVendas.qtdSaida > 0 && (
                <div className="rounded-lg border border-white/10 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
                    {ehRendaFixaAtivo ? 'Resgates' : 'Vendas'}
                  </p>
                  <p className="font-semibold text-[13px]" style={{ color: '#ff5c7a' }}>{fmtNativo(resumoComprasVendas.valorSaida)}</p>
                  <p className="text-[11px]" style={{ color: MUTED }}>Qtd: {fmtTokens(resumoComprasVendas.qtdSaida)}</p>
                </div>
              )}
              {resumoComprasVendas.qtdSaida > 0 && (
                <div className="rounded-lg border border-white/10 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
                    Resultado ({ehRendaFixaAtivo ? 'aportes − resgates' : 'compras − vendas'})
                  </p>
                  <p className="font-semibold text-[13px]" style={{ color: corValor(resumoComprasVendas.valorLiquido) }}>
                    {fmtNativo(resumoComprasVendas.valorLiquido)}
                  </p>
                  <p className="text-[11px]" style={{ color: MUTED }}>Qtd líquida: {fmtTokens(resumoComprasVendas.qtdLiquida)}</p>
                </div>
              )}
              {/* RENDIMENTO não tem valor_total (sempre 0, é yield em tokens) — o
                  R$ é uma ESTIMATIVA pela cotação atual, não o valor real
                  recebido em cada crédito. */}
              {resumoComprasVendas.qtdRendimento > 0 && (
                <div className="rounded-lg border border-white/10 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>Rendimento</p>
                  <p className="text-white font-semibold text-[13px]">
                    +{fmtTokens(resumoComprasVendas.qtdRendimento)} {ativo.ticker}
                  </p>
                  {precoAtualEstimado != null && (
                    <p className="text-[11px]" style={{ color: MUTED }}>
                      ≈ {formatBRL(resumoComprasVendas.qtdRendimento * precoAtualEstimado)} (preço atual)
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {compras.length === 0 && rendimentos.length === 0 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>Nenhuma operação registrada.</p>
          ) : (
            <div className="space-y-4">
              {compras.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    {rendimentos.length > 0 ? (
                      <p className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>Compras e aportes</p>
                    ) : <span />}
                    {totalPaginasOperacoes > 1 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setPaginaOperacoes((p) => p + 1)}
                          disabled={paginaOperacoesEfetiva >= totalPaginasOperacoes - 1}
                          title="Operações mais antigas"
                          aria-label="Operações mais antigas"
                          className="flex items-center justify-center h-6 w-6 rounded-md border border-white/10 text-white/70
                                     hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronLeft size={13} />
                        </button>
                        <span className="text-[11px] whitespace-nowrap" style={{ color: MUTED }}>
                          Página {paginaOperacoesEfetiva + 1}/{totalPaginasOperacoes}
                        </span>
                        <button
                          onClick={() => setPaginaOperacoes((p) => Math.max(0, p - 1))}
                          disabled={paginaOperacoesEfetiva <= 0}
                          title="Operações mais recentes"
                          aria-label="Operações mais recentes"
                          className="flex items-center justify-center h-6 w-6 rounded-md border border-white/10 text-white/70
                                     hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  {comprasPaginadas.map((o) => {
                    // Entrada (compra/aplicação) em verde, saída (venda/resgate) em
                    // vermelho — mesmo par de cores usado no resto da página.
                    const saida = o.tipo_operacao === 'VENDA' || o.tipo_operacao === 'RESGATE'
                    const corOperacao = saida ? '#ff5c7a' : '#00c896'
                    return (
                      <div key={o.id} className="flex items-center justify-between gap-2 text-[13px]">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: corOperacao }} />
                          <div>
                            <p className="font-medium" style={{ color: corOperacao }}>{TIPO_OPERACAO_LABEL[o.tipo_operacao]}</p>
                            <p style={{ color: MUTED }}>
                              {ativo.tipo_ativo === 'RENDA_FIXA'
                                ? formatData(o.data_operacao)
                                : `${o.quantidade} × ${fmtNativo(o.preco_unitario)} · ${formatData(o.data_operacao)}`}
                            </p>
                          </div>
                        </div>
                        <span className="font-semibold" style={{ color: corOperacao }}>
                          {saida ? '-' : '+'}{fmtNativo(o.valor_total)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {rendimentos.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>Rendimentos (yield)</p>
                    <span className="text-[12px] font-semibold" style={{ color: '#00c896' }}>
                      +{fmtTokens(totalRendimento)} {ativo.ticker} · {rendimentos.length}×
                    </span>
                  </div>
                  {rendimentos.slice(0, 5).map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <p style={{ color: MUTED }}>{formatData(o.data_operacao)}</p>
                      <span className="font-semibold" style={{ color: '#00c896' }}>+{fmtTokens(o.quantidade)} {ativo.ticker}</span>
                    </div>
                  ))}
                  {rendimentos.length > 5 && (
                    <p className="text-[12px] text-center" style={{ color: MUTED }}>
                      +{rendimentos.length - 5} crédito(s) — ver em Gerenciar
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {editandoNota && (
        <DrawerQuestionario ativo={ativo}
          onClose={() => setEditandoNota(false)} onToast={showToast} />
      )}

      {editandoAtivo && (
        <DrawerAtivo ativo={ativo}
          onClose={() => setEditandoAtivo(false)} onToast={showToast} />
      )}

      {gerenciar && (
        <DrawerMovimentacoes ativo={ativo} onClose={() => { setGerenciar(false); setPrefilCompra(null) }}
          onToast={showToast} valoresIniciais={prefilCompra ?? undefined} />
      )}

      {simulando && (
        <DrawerSimularCompra ticker={ativo.ticker} tipoAtivo={ativo.tipo_ativo}
          precoAtual={precoAtualEstimado} onClose={() => setSimulando(false)}
          onRegistrar={(quantidade, precoUnitario) => {
            setPrefilCompra({ quantidade: String(quantidade), preco_unitario: String(precoUnitario) })
            setSimulando(false)
            setGerenciar(true)
          }} />
      )}

      {excluindo && (
        <ModalExcluir nome={ativo.ticker}
          mensagem="Isso remove o ativo e todas as suas posições, operações e dividendos."
          onConfirmar={confirmarExclusao} onCancelar={() => setExcluindo(false)} salvando={salvandoExclusao} />
      )}

      <TutorialTour pageKey="investimentos-detalhe-v1" passos={TUTORIAL_INVESTIMENTOS_DETALHE} />
    </div>
  )
}

// ── Características do título (RF/Tesouro) ou do FII ──────────

function ItemCaracteristica({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div>
      <p className="text-[12px]" style={{ color: MUTED }}>{rotulo}</p>
      <p className="text-[13px] font-medium" style={{ color: cor ?? '#fff' }}>{valor}</p>
    </div>
  )
}

// Caixa de um termo da "conta" do Magic Number (ex.: "R$ 60,47 ÷ R$ 0,60 = 101 cotas").
function CaixaMagicNumber({ valor, rotulo, destaque }: { valor: string; rotulo: string; destaque?: boolean }) {
  return (
    <div className="flex-1 min-w-[110px] rounded-lg px-3 py-3 text-center border"
      style={destaque
        ? { background: 'rgba(0,200,150,0.10)', borderColor: 'rgba(0,200,150,0.35)' }
        : { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)' }}>
      <p className="text-[15px] font-bold" style={{ color: destaque ? '#00c896' : '#fff' }}>{valor}</p>
      <p className="text-[11px] mt-1 leading-tight" style={{ color: MUTED }}>{rotulo}</p>
    </div>
  )
}

// Rótulo da unidade negociada, por tipo de ativo — só cosmético (a conta é a
// mesma pra todos: valor ÷ preço, arredondado para baixo pois não dá pra
// comprar fração de cota/ação nem token fracionado por aqui).
function unidadeLabel(tipo: TipoAtivoInvestimento, plural: boolean): string {
  const singular = tipo === 'FII' ? 'cota' : tipo === 'CRIPTOMOEDAS' ? 'token' : 'ação'
  if (!plural) return singular
  return singular === 'ação' ? 'ações' : `${singular}s`
}

// Simulação de nova compra: "tenho R$ x, quantas cotas/ações dá pra comprar
// aproximadamente?" — usa o mesmo preço atual estimado (valor de mercado do
// último snapshot ÷ quantidade atual) já calculado para o Magic Number e para
// o card de rendimento de cripto. Não persiste nada — é só uma conta na hora.
function DrawerSimularCompra({ ticker, tipoAtivo, precoAtual, onClose, onRegistrar }: {
  ticker: string; tipoAtivo: TipoAtivoInvestimento; precoAtual: number | null; onClose: () => void
  // Presente: oferece o botão que vira a simulação numa movimentação real,
  // repassando quantidade/preço já calculados para o formulário de "Nova
  // movimentação" (ver uso em DetalheInvestimentoPage).
  onRegistrar: (quantidade: number, precoUnitario: number) => void
}) {
  const [valorDisponivel, setValorDisponivel] = useState<number | null>(null)
  // Quantidade efetivamente simulada — parte da sugestão calculada a partir
  // do valor disponível, mas o usuário pode ajustá-la livremente (+/- ou
  // digitando), por exemplo para comprar um pouco mais/menos do que o valor
  // informado permitiria à risca.
  const [quantidade, setQuantidade] = useState(0)
  const unidade = unidadeLabel(tipoAtivo, false)
  const unidadePlural = unidadeLabel(tipoAtivo, true)

  // Só resincroniza a quantidade quando o VALOR muda (não a cada render) —
  // depois disso o usuário é livre para ajustar sem o campo "voltar sozinho"
  // ao valor sugerido a cada re-render.
  useEffect(() => {
    if (precoAtual && precoAtual > 0 && valorDisponivel && valorDisponivel > 0) {
      setQuantidade(Math.floor(valorDisponivel / precoAtual))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorDisponivel])

  const ajustarQtd = (delta: number) => setQuantidade((q) => Math.max(0, q + delta))

  const gasto = quantidade * (precoAtual ?? 0)
  // Só compara com "sobra/falta" quando o usuário informou um valor de
  // referência — sem ele, a quantidade é livre e não há o que comparar.
  const diferenca = valorDisponivel != null ? valorDisponivel - gasto : null

  return (
    <Drawer open onClose={onClose} titulo={`Simular compra · ${ticker}`}
      subtitulo={precoAtual ? `Preço atual estimado: ${formatBRL(precoAtual)} por ${unidade}` : undefined}>
      {!precoAtual || precoAtual <= 0 ? (
        <p className="text-[13px]" style={{ color: MUTED }}>
          Sem cotação atual disponível para este ativo — não é possível simular.
        </p>
      ) : (
        <>
          <Field label="Quanto você tem disponível para investir? (opcional)">
            <InputMoeda value={valorDisponivel} onChange={setValorDisponivel} placeholder="R$ 0,00" autoFocus />
          </Field>

          <Field label={`Quantidade de ${unidadePlural}`}>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => ajustarQtd(-1)} disabled={quantidade <= 0}
                title={`Remover 1 ${unidade}`}
                className="w-9 h-9 shrink-0 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25 disabled:opacity-40" style={{ color: MUTED }}>
                <Minus size={14} />
              </button>
              <Input type="number" min={0} step={1} value={quantidade} className="text-center"
                onChange={(e) => setQuantidade(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
              <button type="button" onClick={() => ajustarQtd(1)} title={`Adicionar 1 ${unidade}`}
                className="w-9 h-9 shrink-0 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
                <Plus size={14} />
              </button>
            </div>
          </Field>

          {quantidade > 0 && (
            <>
              <div className="flex flex-wrap items-stretch gap-2">
                <CaixaMagicNumber destaque rotulo="Total gasto" valor={formatBRL(gasto)} />
                {diferenca != null && (
                  <CaixaMagicNumber
                    rotulo={diferenca >= 0 ? 'Sobra estimada' : 'Falta'}
                    valor={formatBRL(Math.abs(diferenca))} />
                )}
              </div>
              <button onClick={() => onRegistrar(quantidade, precoAtual)}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[14px] font-semibold text-white"
                style={{ background: '#3b82f6' }}>
                <Plus size={14} /> Registrar esta compra
              </button>
            </>
          )}

          {valorDisponivel != null && valorDisponivel > 0 && quantidade === 0 && (
            <p className="text-[13px]" style={{ color: '#ffb74d' }}>
              Valor insuficiente para 1 {unidade} inteira ao preço atual — ajuste a quantidade acima se quiser simular mesmo assim.
            </p>
          )}

          <p className="text-[11px]" style={{ color: MUTED }}>
            Estimativa com base no preço atual — não considera corretagem, emolumentos nem a variação da cotação até a compra de verdade.
          </p>
        </>
      )}
    </Drawer>
  )
}

// Projeta o valor no vencimento pelos juros compostos da taxa contratada
// (rf_taxa) sobre o custo de aquisição — sem considerar novos aportes/
// resgates. Só PREFIXADO/HIBRIDO têm uma taxa nominal própria para compor;
// pós-fixado (SELIC/CDI) mostra só o spread sobre um índice futuro
// desconhecido, então uma composição com ele seria enganosa.
function projecaoVencimento(
  ativo: InvestimentoAtivo, valorInvestido: number,
): { valor: number } | null {
  if (!ativo.rf_vencimento || !ativo.rf_taxa || valorInvestido <= 0) return null
  if (ativo.rf_indexador !== 'PREFIXADO' && ativo.rf_indexador !== 'HIBRIDO') return null
  const m = ativo.rf_taxa.match(/(\d+(?:,\d+)?)\s*%/)
  if (!m) return null
  const taxaAnual = Number(m[1].replace(',', '.')) / 100
  if (!Number.isFinite(taxaAnual)) return null
  const hoje = new Date()
  const venc = new Date(`${ativo.rf_vencimento}T00:00:00`)
  const anos = (venc.getTime() - hoje.getTime()) / (365.25 * 24 * 3600 * 1000)
  if (anos <= 0) return null
  return { valor: valorInvestido * Math.pow(1 + taxaAnual, anos) }
}

function CaracteristicasAtivo({ ativo, valorInvestido }: { ativo: InvestimentoAtivo; valorInvestido: number }) {
  const ehRF  = ativo.tipo_ativo === 'RENDA_FIXA' || ativo.tipo_ativo === 'TESOURO_DIRETO'
  const ehFII = ativo.tipo_ativo === 'FII'
  if (!ehRF && !ehFII) return null

  if (ehFII) {
    if (!ativo.fii_categoria) return null
    const info = FII_CATEGORIA_INFO[ativo.fii_categoria]
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
        <h2 className="text-[14px] font-semibold text-white/80 mb-3">
          Categoria do fundo: <span style={{ color: TIPO_ATIVO_COR.FII }}>{info.label}</span>
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <ItemCaracteristica rotulo="O que compra" valor={info.compra} />
          <ItemCaracteristica rotulo="Fonte de lucro" valor={info.fonteLucro} />
          <ItemCaracteristica rotulo="Nível de risco" valor={info.risco}
            cor={info.risco.startsWith('Alto') ? '#ff5c7a' : info.risco.startsWith('Baixo') ? '#00c896' : '#f0b429'} />
          <ItemCaracteristica rotulo="Principal vantagem" valor={info.vantagem} />
        </div>
      </section>
    )
  }

  const temAlgo = ativo.rf_subtipo || ativo.rf_indexador || ativo.rf_taxa || ativo.rf_vencimento || ativo.rf_emissor
  if (!temAlgo) return null
  const proj = projecaoVencimento(ativo, valorInvestido)
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
      <h2 className="text-[14px] font-semibold text-white/80 mb-3">Características do título</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {ativo.rf_subtipo && (
          <ItemCaracteristica rotulo="Tipo" valor={SUBTIPO_RF_INFO[ativo.rf_subtipo].label} />
        )}
        {ativo.rf_indexador && (
          <ItemCaracteristica rotulo="Rentabilidade"
            valor={`${INDEXADOR_RF_LABEL[ativo.rf_indexador]}${ativo.rf_taxa ? ` · ${ativo.rf_taxa}` : ''}`} />
        )}
        {ativo.rf_emissor && <ItemCaracteristica rotulo="Emissor" valor={ativo.rf_emissor} />}
        {ativo.rf_vencimento && <ItemCaracteristica rotulo="Vencimento" valor={formatData(ativo.rf_vencimento)} />}
        {proj && (
          <ItemCaracteristica rotulo="Valor estimado no vencimento" valor={formatBRL(proj.valor)} cor="#00c896" />
        )}
        <ItemCaracteristica rotulo="Garantia do FGC"
          valor={ativo.rf_garantia_fgc ? 'Sim (até R$ 250 mil)' : ativo.rf_subtipo === 'TESOURO' ? 'Não (garantia soberana)' : 'Não'}
          cor={ativo.rf_garantia_fgc || ativo.rf_subtipo === 'TESOURO' ? '#00c896' : '#f0b429'} />
        <ItemCaracteristica rotulo="Imposto de Renda"
          valor={ativo.rf_isento_ir ? 'Isento' : (ativo.rf_subtipo ? SUBTIPO_RF_INFO[ativo.rf_subtipo].obsIR : 'Tabela regressiva')}
          cor={ativo.rf_isento_ir ? '#00c896' : undefined} />
      </div>
      {ativo.rf_indexador && (
        <p className="text-[12px] mt-3" style={{ color: MUTED }}>
          {INDEXADOR_RF_DESCRICAO[ativo.rf_indexador]}
        </p>
      )}
      {proj && (
        <p className="text-[12px] mt-1.5" style={{ color: MUTED }}>
          Projeção pela taxa contratada sobre o custo de aquisição, sem considerar novos aportes/resgates.
          {ativo.rf_indexador === 'HIBRIDO' && ' Como a taxa do IPCA+ é real, o valor está em poder de compra de hoje — não prevê a inflação até lá.'}
        </p>
      )}
    </section>
  )
}

function CardMini({ icone, titulo, valor, cor, sub }: {
  icone: React.ReactNode; titulo: string; valor: string; cor?: string; sub?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-[13px]" style={{ color: MUTED }}>{icone}{titulo}</div>
      <p className="mt-1.5 text-[18px] font-bold" style={{ color: cor ?? '#fff' }}>{valor}</p>
      {sub && <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>{sub}</p>}
    </div>
  )
}

// ── Drawer: questionário de avaliação (deriva a nota) ───────────

function DrawerQuestionario({ ativo, onClose, onToast }: {
  ativo: InvestimentoAtivo; onClose: () => void; onToast: (m: string) => void
}) {
  const { editar } = useInvestimentosAtivos()
  const { perfil } = useInvPerfil()
  const { pesos: pesosGlobais } = useInvPesos()
  const { questionarioEfetivo } = useInvQuestionarios()
  // Questionário efetivo (perguntas custom/padrão do tipo) + pesos GLOBAIS.
  const ef = questionarioEfetivo(ativo.tipo_ativo, perfil?.perfil ?? null, pesosGlobais)
  const perguntas = ef.perguntas
  const [respostas, setRespostas] = useState<QuestionarioRespostas>(ativo.questionario_respostas ?? {})
  const [salvando, setSalvando] = useState(false)

  const nota = calcularNota(perguntas, ef.pesos, respostas)
  const respondidas = perguntas.filter((p) => respostas[p.id] != null).length

  // Agrupa por critério para exibir junto do peso de cada bloco.
  const porCriterio = Object.fromEntries(
    CRITERIOS_QUESTAO.map((c) => [c, [] as PerguntaAvaliacao[]]),
  ) as Record<CriterioQuestao, PerguntaAvaliacao[]>
  for (const p of perguntas) (porCriterio[p.criterio] ?? porCriterio.FUNDAMENTOS).push(p)

  async function salvar() {
    if (nota == null) { onToast('Responda pelo menos uma pergunta'); return }
    setSalvando(true)
    const res = await editar(ativo.id, { nota_usuario: nota, questionario_respostas: respostas })
    setSalvando(false)
    if (res.ok) { onToast(`Avaliação salva — nota ${nota}.`); onClose() }
    else onToast(res.erro ?? 'Erro ao salvar avaliação')
  }

  return (
    <Drawer open onClose={onClose} titulo={`Avaliar · ${ativo.ticker}`}
      subtitulo={`Questionário de ${TIPO_ATIVO_LABEL[ativo.tipo_ativo]} — a nota é a média ponderada por critério`}
      rodape={<><BtnCancelar onClick={onClose} /><BtnSalvar editando onClick={salvar} salvando={salvando} labelSalvar="Salvar avaliação" /></>}>

      {/* Nota ao vivo */}
      <div className="rounded-lg border border-white/10 p-3 flex items-center justify-between">
        <span className="text-[13px]" style={{ color: MUTED }}>
          {respondidas}/{perguntas.length} respondidas
        </span>
        <span className="text-[18px] font-bold" style={{ color: nota != null && nota >= 7 ? '#00c896' : nota != null && nota < 5 ? '#ff5c7a' : '#f0b429' }}>
          {nota != null ? `Nota ${nota}` : 'Sem nota'}
        </span>
      </div>

      {CRITERIOS_QUESTAO.map((c) => porCriterio[c].length === 0 ? null : (
        <div key={c} className="space-y-2">
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-[13.5px] font-semibold text-white">{CRITERIO_LABEL[c]}</h3>
            <span className="text-[11.5px]" style={{ color: MUTED }}>peso {ef.pesos[c] ?? 0}%</span>
          </div>
          {porCriterio[c].map((p) => (
            <div key={p.id} className="space-y-1.5">
              <p className="text-[13px] font-medium text-white">{p.texto}</p>
              <div className="space-y-1">
                {p.opcoes.map((opcao, idx) => {
                  const ativa = respostas[p.id] === idx
                  return (
                    <button key={idx} type="button"
                      onClick={() => setRespostas({ ...respostas, [p.id]: idx })}
                      className={`w-full text-left px-3 py-1.5 rounded-md border text-[13px] transition-colors ${
                        ativa ? 'border-blue-400/60 bg-blue-500/15 text-white' : 'border-white/10 text-white/70 hover:border-white/25'
                      }`}>
                      {opcao}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </Drawer>
  )
}
