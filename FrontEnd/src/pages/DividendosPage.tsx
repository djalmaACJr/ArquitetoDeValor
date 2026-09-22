import { useState, useMemo, useEffect } from 'react'
import { Plus, Trash2, Settings, ArrowLeft, Coins, CheckCircle2, ChevronDown, ChevronRight, Layers, AlertTriangle, RefreshCw, Clock } from 'lucide-react'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Legend,
  Tooltip as ChartTooltip, type Plugin, type ChartType,
} from 'chart.js'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useDividendos, type CriarDividendoInput } from '../hooks/useDividendos'
import { useObjetivos } from '../hooks/useObjetivos'
import { useTiposDividendo } from '../hooks/useTiposDividendo'
import { useAvisosDividendos, type AvisoTipoDividendo } from '../hooks/useAvisosDividendos'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useContas } from '../hooks/useContas'
import {
  Drawer, Field, Input, SelectDark, SearchableSelect, BtnSalvar, BtnCancelar,
  Toast, ModalExcluir,
} from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import InvestimentosNav from '../components/ui/InvestimentosNav'
import TutorialTour from '../components/ui/TutorialTour'
import { TUTORIAL_INVESTIMENTOS_PROVENTOS } from '../lib/tutoriaisPaginas'
import { useRegistrarContextoIA } from '../context/ContextoIAContext'
import { MonthPicker } from '../components/ui/MonthPicker'
import { formatBRL, formatData, hojeLocal, mesAtual, mesLabel, MESES_ABREV } from '../lib/utils'
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR, TIPO_OBJETIVO_LABEL } from '../lib/constants'
import type { InvestimentoDividendo, TipoAtivoInvestimento, PeriodoRanking } from '../types'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Legend, ChartTooltip)

// Opção customizada do gráfico de dividendos: dados que o plugin de rótulos
// lê de chart.options (em vez de closure, que o react-chartjs-2 não recria).
interface CfgRotulos {
  externos: { label: string; pct: number; cor: string }[]
  tiposVis: { tipo: TipoAtivoInvestimento; pct: number }[]
  corTexto: string
  corLinha: string
}
// Idem para o rótulo de valor acima da barra (quadro "Evolução dos recebimentos").
interface CfgValorBarra {
  valores: number[]
  cor: string
}
declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    rotulosDividendos?: CfgRotulos
    valorBarra?: CfgValorBarra
  }
}

const MUTED = '#8b92a8'

// Rótulo padrão do tipo de provento quando o registro não tem tipo vinculado
// (ex.: dividendos importados/associados antes do auto-preenchimento).
const TIPO_DEFAULT_LABEL = (t: TipoAtivoInvestimento): string =>
  t === 'FII' ? 'Aluguel de FII' : 'Dividendos'

// "Provisionado/futuro" = ainda não recebido = transação no extrato com
// status PROJECAO. Independe da data (uma projeção do mês corrente também
// é futura). Sem transação vinculada → tratado como recebido (histórico).
const ehProvisionado = (d: InvestimentoDividendo): boolean =>
  d.transacoes?.status === 'PROJECAO'

// Barra de participação (% sobre o total) usada nos cards de proventos.
function Barra({ pct, cor }: { pct: number; cor: string }) {
  return (
    <div className="relative h-5 rounded-full bg-white/10 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: cor }} />
      <span className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-white"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,.55)' }}>
        {pct}%
      </span>
    </div>
  )
}

export default function DividendosPage() {
  const [drawerNovo,   setDrawerNovo]   = useState(false)
  const [excluindo,    setExcluindo]    = useState<InvestimentoDividendo | null>(null)
  const [confirmando,  setConfirmando]  = useState<InvestimentoDividendo | null>(null)
  const [salvando,     setSalvando]     = useState(false)
  const [buscando,     setBuscando]     = useState(false)
  const [toast,        setToast]        = useState<string | null>(null)

  const { dividendos, loading, excluir, buscarBrl, buscarUsd, buscarTesouro } = useDividendos()

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(null), 6000) }

  // Busca proventos nas três fontes: B3 (ativos BRL), Polygon (ativos USD) e
  // Tesouro Transparente (cupom semestral do Tesouro Direto).
  async function buscarProventos() {
    setBuscando(true)
    const [br, usd, tesouro] = await Promise.all([buscarBrl(), buscarUsd(), buscarTesouro()])
    setBuscando(false)
    if (!br.ok && !usd.ok && !tesouro.ok) { showToast(br.erro ?? usd.erro ?? tesouro.erro ?? 'Erro ao buscar proventos'); return }

    const soma = (k: 'processados' | 'criados' | 'atualizados' | 'pulados' | 'falhas_fonte' | 'erros') =>
      (br.dados?.[k] ?? 0) + (usd.dados?.[k] ?? 0) + (tesouro.dados?.[k] ?? 0)
    const criados = soma('criados'), atualizados = soma('atualizados')
    const pulados = soma('pulados'), falhas = soma('falhas_fonte')
    const processados = soma('processados'), errosGravar = soma('erros')
    const erroExemplo = br.dados?.erro_exemplo ?? usd.dados?.erro_exemplo ?? tesouro.dados?.erro_exemplo ?? null
    const tickersFalha = [...(br.dados?.fontes_falha ?? []), ...(usd.dados?.fontes_falha ?? []), ...(tesouro.dados?.fontes_falha ?? [])]

    const partes: string[] = []
    if (criados + atualizados > 0) partes.push(`Busca concluída — ${criados} novo(s), ${atualizados} atualizado(s).`)
    else if (processados === 0 && falhas === 0) partes.push('Busca concluída — nenhum ativo elegível com posição ativa foi processado. Veja "Diagnóstico" em Configurações → Manutenção de proventos para o motivo.')
    else partes.push('Busca concluída — nenhum provento novo. Veja "Diagnóstico" em Configurações → Manutenção de proventos para o que cada fonte devolveu.')
    if (falhas > 0) partes.push(`Fonte indisponível para ${falhas} ativo(s)${tickersFalha.length ? ` (${tickersFalha.slice(0, 5).join(', ')}${tickersFalha.length > 5 ? '…' : ''})` : ''} — tente de novo mais tarde.`)
    if (pulados > 0) partes.push(`${pulados} provento(s) pulado(s) por tipo sem categoria — veja "Tipos de dividendo" em Configurações.`)
    if (errosGravar > 0) partes.push(`${errosGravar} erro(s) ao gravar no banco${erroExemplo ? ` (${erroExemplo})` : ''}.`)
    if (!usd.ok && usd.erro) partes.push(`Internacionais: ${usd.erro}`)
    if (!br.ok && br.erro) partes.push(`B3: ${br.erro}`)
    showToast(partes.join(' '))
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    setSalvando(true)
    const res = await excluir(excluindo.id)
    setSalvando(false)
    if (res.ok) showToast('Dividendo excluído (e removido do extrato).')
    else showToast(res.erro ?? 'Erro ao excluir')
    setExcluindo(null)
  }

  // ── Snapshot pra IA ───────────────────────────────────────────────────────
  useRegistrarContextoIA(useMemo(() => {
    if (loading || dividendos.length === 0) return null
    const porTipo = new Map<TipoAtivoInvestimento, { recebido: number; provisionado: number }>()
    let totalRecebido = 0, totalProvisionado = 0
    for (const d of dividendos) {
      const agg = porTipo.get(d.tipo_ativo) ?? { recebido: 0, provisionado: 0 }
      if (ehProvisionado(d)) { agg.provisionado += d.valor; totalProvisionado += d.valor }
      else                   { agg.recebido += d.valor;     totalRecebido     += d.valor }
      porTipo.set(d.tipo_ativo, agg)
    }
    return {
      titulo:    'Investimentos · Proventos',
      descricao: 'Dividendos e proventos recebidos/provisionados, por tipo de ativo',
      dados: {
        total_recebido:     totalRecebido,
        total_provisionado: totalProvisionado,
        por_tipo: [...porTipo.entries()].map(([tipo, v]) => ({
          tipo, recebido: v.recebido, provisionado: v.provisionado,
        })),
      },
    }
  }, [loading, dividendos]))

  if (loading) return <LoadingMascote fullPage />

  return (
    <div className="p-5">
      <InvestimentosNav />
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white">Proventos</h1>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>Proventos recebidos, integrados ao extrato</p>
        </div>
        <div className="flex items-center gap-2" data-tutorial="proventos-header">
          <button onClick={buscarProventos} disabled={buscando}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25 disabled:opacity-60"
            title="Busca proventos na B3 (ações, ETFs e FIIs em BRL) e na Polygon (ativos internacionais em USD): provisiona os futuros e lança os pagos nos últimos 30 dias">
            <RefreshCw size={15} className={buscando ? 'animate-spin' : ''} /> {buscando ? 'Buscando…' : 'Buscar proventos'}
          </button>
          <button onClick={() => setDrawerNovo(true)} data-tutorial="proventos-novo"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white" style={{ background: '#3b82f6' }}>
            <Plus size={15} /> Novo dividendo
          </button>
        </div>
      </div>

      <Toast msg={toast} />

      <AvisoMapeamento />

      <div data-tutorial="proventos-resumo">
        <ProventosPorCategoria dividendos={dividendos} />
        <AtivosPorCategoria dividendos={dividendos} />
        <ObjetivosAtivos />
      </div>

      {/* Lista */}
      <div data-tutorial="proventos-lista">
        {dividendos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
            <Coins size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
            <p className="text-white font-medium">Nenhum dividendo lançado</p>
            <p className="text-[13px] mt-1" style={{ color: MUTED }}>
              Cada dividendo gera uma receita no extrato, na categoria do seu tipo.
            </p>
          </div>
        ) : (
          <ListaDividendos dividendos={dividendos} onExcluir={setExcluindo} onConfirmar={setConfirmando} />
        )}
      </div>

      {drawerNovo   && <DrawerNovoDividendo onClose={() => setDrawerNovo(false)} onToast={showToast} />}
      {confirmando  && <DrawerConfirmar dividendo={confirmando} onClose={() => setConfirmando(null)} onToast={showToast} />}

      {excluindo && (
        <ModalExcluir nome={`${excluindo.inv_ativos?.ticker ?? 'Dividendo'} · ${formatBRL(excluindo.valor)}`}
          mensagem="A transação vinculada no extrato também será removida."
          onConfirmar={confirmarExclusao} onCancelar={() => setExcluindo(null)} salvando={salvando} />
      )}

      <TutorialTour pageKey="investimentos-proventos-v1" passos={TUTORIAL_INVESTIMENTOS_PROVENTOS} />
    </div>
  )
}

// ── Banner: proventos não provisionados por falta de mapeamento ──
// Alimentado pelo job de proventos BRL (dividendos-cron-br), que registra
// em usuarios.inv_dividendos_avisos os tipos sem categoria mapeada. Ao
// mapear (botão "Configurar tipos"), a próxima execução do job limpa o
// aviso automaticamente.

const MOTIVO_AVISO: Record<AvisoTipoDividendo['motivo'], string> = {
  sem_categoria:    'sem categoria mapeada',
  tipo_inexistente: 'tipo não encontrado',
}

function AvisoMapeamento() {
  const { avisos } = useAvisosDividendos()
  if (!avisos) return null

  return (
    <div className="rounded-xl border p-4 mb-4" style={{ borderColor: 'rgba(255,183,77,0.4)', background: 'rgba(255,183,77,0.06)' }}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: '#ffb74d' }} />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white">Proventos não provisionados</p>
          <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
            A busca automática encontrou proventos futuros, mas não pôde lançá-los por falta de
            mapeamento. Mapeie a categoria de cada tipo e eles entram na próxima execução.
          </p>
          <ul className="mt-2 space-y-1">
            {avisos.tipos.map((t) => (
              <li key={t.tipo} className="text-[13px] text-white">
                <span className="font-medium">{t.tipo}</span>
                <span style={{ color: '#ffb74d' }}> — {MOTIVO_AVISO[t.motivo]}</span>
                {t.tickers.length > 0 && (
                  <span style={{ color: MUTED }}> · {t.tickers.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <Link to="/investimentos/configuracoes"
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] text-white hover:border-white/40"
          style={{ borderColor: 'rgba(255,183,77,0.5)' }}>
          <Settings size={15} /> Configurar tipos
        </Link>
      </div>
    </div>
  )
}

// ── Quadro "Proventos por categoria" (topo da página) ───────────
// Top 4 tipos de ativo por valor recebido (até o fim do mês atual) com
// barra de participação; o restante é agregado em "Demais", com hint
// listando cada categoria no hover.

function ProventosPorCategoria({ dividendos }: { dividendos: InvestimentoDividendo[] }) {
  const { cards, demais, totalDemais, totalGeral } = useMemo(() => {
    const porTipo = new Map<TipoAtivoInvestimento, number>()
    let totalGeral = 0
    for (const d of dividendos) {
      if (ehProvisionado(d)) continue // só recebidos
      porTipo.set(d.tipo_ativo, (porTipo.get(d.tipo_ativo) ?? 0) + d.valor)
      totalGeral += d.valor
    }
    const ordenado = [...porTipo.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tipo, valor]) => ({ tipo, valor }))
    const demais = ordenado.slice(4)
    return {
      cards: ordenado.slice(0, 4),
      demais,
      totalDemais: demais.reduce((s, c) => s + c.valor, 0),
      totalGeral,
    }
  }, [dividendos])

  if (totalGeral <= 0) return null

  const pct = (v: number) => Math.round((v / totalGeral) * 100)

  return (
    <div className="rounded-xl border border-white/10 p-4 mb-4">
      <h2 className="text-[15px] font-semibold text-white mb-3">Proventos por categoria</h2>
      {/* flex fluido: os cards crescem p/ ocupar a linha inteira, sem sobrar
          espaço vazio quando há menos de 5 tipos */}
      <div className="flex flex-wrap gap-3">
        {cards.map((c) => (
          <div key={c.tipo} className="flex-1 min-w-[160px] rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[c.tipo] }} />
              <span className="text-[13px] font-medium text-white truncate">{TIPO_ATIVO_LABEL[c.tipo]}</span>
            </div>
            <p className="text-[16px] font-bold text-white mb-2">{formatBRL(c.valor)}</p>
            <Barra pct={pct(c.valor)} cor={TIPO_ATIVO_COR[c.tipo]} />
          </div>
        ))}

        {demais.length > 0 && (
          <div className="relative group flex-1 min-w-[160px] rounded-lg border border-white/10 bg-white/[0.02] p-3 cursor-help">
            <div className="flex items-center gap-1.5 mb-1">
              <Layers size={13} className="shrink-0" style={{ color: MUTED }} />
              <span className="text-[13px] font-medium text-white">Demais</span>
            </div>
            <p className="text-[16px] font-bold text-white mb-2">{formatBRL(totalDemais)}</p>
            <Barra pct={pct(totalDemais)} cor="#e5e7eb" />

            {/* Hint com o detalhamento das categorias agregadas */}
            <div className="absolute right-0 top-full mt-2 z-20 hidden group-hover:block rounded-xl border border-white/10 shadow-2xl px-4 py-3 min-w-[210px]"
              style={{ background: '#1a1f2e' }}>
              <p className="text-[13px] font-semibold text-white">Demais categorias:</p>
              {demais.map((c) => (
                <div key={c.tipo} className="flex items-center justify-between gap-4 border-t border-white/5 mt-2 pt-2">
                  <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[c.tipo] }} />
                    {TIPO_ATIVO_LABEL[c.tipo]}
                  </span>
                  <span className="text-[13px] font-semibold text-white whitespace-nowrap">{formatBRL(c.valor)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Quadro "Ativos por categoria" (donut de 2 anéis) ────────────
// Anel interno = tipos de ativo; anel externo = ativos de cada tipo
// (tons da cor do tipo). Períodos: últimos 6/12/24 meses (recebidos)
// e Provisionado (projeções ainda não recebidas). As linhas abaixo trazem
// os 4 totais por categoria e expandem para o detalhamento por ativo.

// Mesmo modelo de período da página Destaques (PeriodoRanking) — trocado do
// controle anterior (6/12/24 meses fixos + "Provisionado" misturado junto).
// "Provisionado" não é bem um período (é status, não tempo), então virou um
// toggle à parte (`mostrarProvisionado`) em vez de uma opção da lista.
const ANO_ATUAL_LABEL = new Date().getFullYear()
const PERIODOS: { value: PeriodoRanking; label: string }[] = [
  { value: 'SEMANA',    label: 'Semana' },
  { value: 'MES_ATUAL', label: 'Mês atual' },
  { value: 'MES',       label: 'Últimos 30 dias' },
  { value: 'SEMESTRE',  label: 'Semestre' },
  { value: 'ANO_ATUAL', label: `Ano ${ANO_ATUAL_LABEL}` },
  { value: 'ANO',       label: 'Últimos 12 meses' },
  { value: 'DOIS_ANOS',  label: '2 anos' },
  { value: 'CINCO_ANOS', label: '5 anos' },
  { value: 'TUDO',      label: 'Desde o início' },
]
// Data de início do período (ou null p/ "Desde o início") — mesma semântica
// de inicioPeriodoRanking() no backend (shared.ts), calculada aqui porque
// este quadro filtra os dividendos já carregados no cliente, sem round-trip.
function inicioPeriodo(periodo: PeriodoRanking): string | null {
  const hoje = new Date(`${hojeLocal()}T12:00:00`)
  const recuar = (dias?: number, meses?: number) => {
    const d = new Date(hoje)
    if (dias)  d.setDate(d.getDate() - dias)
    if (meses) d.setMonth(d.getMonth() - meses)
    return d.toISOString().slice(0, 10)
  }
  switch (periodo) {
    case 'SEMANA':     return recuar(7)
    case 'MES_ATUAL':  return `${hojeLocal().slice(0, 7)}-01`
    case 'MES':        return recuar(undefined, 1)
    case 'SEMESTRE':   return recuar(undefined, 6)
    case 'ANO_ATUAL':  return `${hojeLocal().slice(0, 4)}-01-01`
    case 'ANO':        return recuar(undefined, 12)
    case 'DOIS_ANOS':  return recuar(undefined, 24)
    case 'CINCO_ANOS': return recuar(undefined, 60)
    case 'TUDO':       return null
  }
}
// Fatores de brilho (sólidos) que diferenciam os ativos dentro da cor do
// tipo. Usamos cor sólida — não alpha — porque alpha sobre fundo escuro/claro
// faz a fatia "sumir" no fundo (some no modo noite e no dia). A faixa é
// limitada [0.62, 1.18] para manter todas visíveis nos dois temas.
const FATORES_TOM = [1.0, 1.18, 0.82, 0.9, 1.1, 0.7, 0.96, 0.62]
// Multiplica o brilho de um hex sólido (#rrggbb) por `fator`, clampando 0..255.
function escalaTom(hex: string, fator: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.round(((n >> 16) & 255) * fator))
  const g = Math.min(255, Math.round(((n >> 8) & 255) * fator))
  const b = Math.min(255, Math.round((n & 255) * fator))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
// Texto escuro ou claro conforme a luminância do fundo (#rrggbb).
function corLegivel(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 150 ? '#10131c' : '#ffffff'
}
// Paleta pastel do gráfico — versão suave de TIPO_ATIVO_COR
const COR_SUAVE: Record<TipoAtivoInvestimento, string> = {
  ACOES:             '#f08da4',
  ETF:               '#7dd6e8',
  FII:               '#7aa7f7',
  REIT:              '#5fcab3',
  STOCKS:            '#b79df5',
  ETF_INTERNACIONAL: '#eda4d4',
  RENDA_FIXA:        '#f2c98a',
  CRIPTOMOEDAS:      '#f5b08c',
  TESOURO_DIRETO:    '#8ad8b0',
}

interface LinhaGraf {
  tipo: TipoAtivoInvestimento
  total: number
  ativos: { ticker: string; total: number; ativoId: string }[]
}

// Observa a classe `.dark` no <html> para re-renderizar no toggle de tema.
// (o useTheme do app guarda estado por instância e não propaga o toggle a
// componentes que só leem cor — o canvas precisa disso para se ajustar.)
function useModoEscuro(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const alvo = document.documentElement
    const obs = new MutationObserver(() => setDark(alvo.classList.contains('dark')))
    obs.observe(alvo, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

function AtivosPorCategoria({ dividendos }: { dividendos: InvestimentoDividendo[] }) {
  const dark = useModoEscuro() // rótulos do canvas precisam contrastar com o fundo
  const [periodo, setPeriodo] = useState<PeriodoRanking>('ANO')
  // "Provisionado" (projeções ainda não recebidas) é um STATUS, não um
  // período — fica de fora da lista acima, num toggle à parte; ligado, o
  // período fica inerte (provisionado não tem "quando recebi", é sempre
  // "tudo que ainda está por vir").
  const [mostrarProvisionado, setMostrarProvisionado] = useState(false)
  // Ordenação do resumo por categoria: nome ou total do período/status atual.
  const [sortResumo, setSortResumo] = useState<{ key: 'nome' | 'total'; dir: 'asc' | 'desc' }>(
    { key: 'total', dir: 'desc' })
  // Drill-down: clicar numa categoria foca o gráfico só nela. Guardado no
  // `location.state` (em vez de useState solto) e empilhado via navigate() a
  // cada entrada no zoom — assim o botão Voltar do NAVEGADOR sai do zoom sem
  // sair da página de Proventos; o botão "Voltar" da própria tela só chama
  // navigate(-1), consumindo essa mesma entrada em vez de zerar o estado
  // direto, então os dois jeitos de voltar ficam consistentes entre si.
  const location = useLocation()
  const navigate = useNavigate()
  const tipoFoco = (location.state as { proventosFoco?: TipoAtivoInvestimento } | null)?.proventosFoco ?? null
  const focarTipo = (tipo: TipoAtivoInvestimento) => navigate(`${location.pathname}${location.search}`, {
    state: { ...(location.state as Record<string, unknown> ?? {}), proventosFoco: tipo },
  })
  const desfocar = () => navigate(-1)
  const [abertos, setAbertos] = useState<Set<TipoAtivoInvestimento>>(new Set())
  const toggleAberto = (t: TipoAtivoInvestimento) => setAbertos((s) => {
    const n = new Set(s)
    if (n.has(t)) n.delete(t); else n.add(t)
    return n
  })

  const linhas = useMemo<LinhaGraf[]>(() => {
    const desde = inicioPeriodo(periodo)
    const porTipo = new Map<TipoAtivoInvestimento, Map<string, { total: number; ativoId: string }>>()
    for (const d of dividendos) {
      const prov = ehProvisionado(d)
      if (mostrarProvisionado ? !prov : prov) continue
      if (!mostrarProvisionado && desde && d.data_pagamento < desde) continue
      const ticker = d.inv_ativos?.ticker ?? '—'
      if (!porTipo.has(d.tipo_ativo)) porTipo.set(d.tipo_ativo, new Map())
      const porAtivo = porTipo.get(d.tipo_ativo)!
      const atual = porAtivo.get(ticker)
      porAtivo.set(ticker, { total: (atual?.total ?? 0) + d.valor, ativoId: d.ativo_id })
    }
    return [...porTipo.entries()].map(([tipo, porAtivo]) => {
      const ativos = [...porAtivo.entries()].map(([ticker, v]) => ({ ticker, total: v.total, ativoId: v.ativoId }))
      const total = ativos.reduce((s, a) => s + a.total, 0)
      return { tipo, total, ativos }
    }).filter((l) => l.total > 0)
  }, [dividendos, periodo, mostrarProvisionado])

  // Trocar o período/toggle reordena o resumo pelo total (mantém gráfico e
  // tabela coerentes); o usuário ainda pode clicar o cabeçalho pra mudar.
  const trocarPeriodo = (v: PeriodoRanking) => {
    setPeriodo(v)
    setSortResumo({ key: 'total', dir: 'desc' })
  }
  // Tipos/ativos com valor no período/status escolhido, do maior p/ o menor
  const tipos = useMemo(() =>
    linhas
      .map((l) => ({ ...l, ativos: [...l.ativos].filter((a) => a.total > 0).sort((a, b) => b.total - a.total) }))
      .sort((a, b) => b.total - a.total),
  [linhas])
  const tiposVis = useMemo(() =>
    (tipoFoco ? tipos.filter((t) => t.tipo === tipoFoco) : tipos), [tipos, tipoFoco])
  // Total do recorte exibido — base para os percentuais dos rótulos.
  const totalSel = useMemo(() => tiposVis.reduce((s, t) => s + t.total, 0), [tiposVis])
  const pctDe = (v: number) => (totalSel > 0 ? Math.round((v / totalSel) * 100) : 0)
  // No 1º nível, cada categoria exibe os maiores ~60% dos ativos; o restante
  // (a partir de 2 itens) é somado numa fatia "Outros". No drill-down mostra todos.
  const externos = useMemo(() => tiposVis.flatMap((t) => {
    const limite = Math.ceil(t.ativos.length * 0.6)
    const agregar = tipoFoco == null && t.ativos.length - limite >= 2
    const itens: { label: string; valor: number; ativoId: string | null }[] = agregar
      ? [
          ...t.ativos.slice(0, limite).map((a) => ({ label: a.ticker, valor: a.total, ativoId: a.ativoId as string | null })),
          { label: 'Outros', valor: t.ativos.slice(limite).reduce((s, a) => s + a.total, 0), ativoId: null },
        ]
      : t.ativos.map((a) => ({ label: a.ticker, valor: a.total, ativoId: a.ativoId as string | null }))
    return itens.map((it, i) => ({
      ...it, tipo: t.tipo, pct: totalSel > 0 ? Math.round((it.valor / totalSel) * 100) : 0,
      cor: escalaTom(COR_SUAVE[t.tipo], FATORES_TOM[i % FATORES_TOM.length]),
    }))
  }), [tiposVis, tipoFoco, totalSel])

  // Plugin: rótulos sempre visíveis apontando para os segmentos (linha-guia
  // com cotovelo, como no app de referência). Tickers fora do anel externo,
  // nome do tipo dentro do anel interno quando a fatia comporta o texto.
  const pluginRotulos = useMemo<Plugin<'doughnut'>>(() => ({
    id: 'rotulosDividendos',
    afterDatasetsDraw(chart) {
      // Lê os rótulos de chart.options (atualizado a cada render). NÃO usar
      // closure: o react-chartjs-2 captura o plugin na criação do gráfico e
      // não o recria no drill-down — o closure ficaria com dados defasados.
      const cfg = chart.options.plugins?.rotulosDividendos as unknown as CfgRotulos | undefined
      if (!cfg) return
      const { externos, tiposVis, corTexto, corLinha } = cfg
      const { ctx, chartArea } = chart
      const metaExt = chart.getDatasetMeta(0)
      const metaInt = chart.getDatasetMeta(1)
      if (!metaExt?.data?.length) return

      ctx.save()
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
      ctx.textBaseline = 'middle'

      // ── rótulos dos ativos ──
      // Cabe na fatia → desenha DENTRO, tangencial (acompanhando o anel), com
      // cor que contrasta com a fatia. Fatia estreita → linha-guia externa curta.
      interface Rotulo { ax: number; ay: number; tx: number; ty: number; side: 1 | -1; label: string }
      const fora: Rotulo[] = []
      metaExt.data.forEach((el, i) => {
        const lab = externos[i] ? `${externos[i].label} ${externos[i].pct}%` : ''
        if (!lab) return
        const p = (el as ArcElement).getProps(['x', 'y', 'startAngle', 'endAngle', 'innerRadius', 'outerRadius'], true) as
          { x: number; y: number; startAngle: number; endAngle: number; innerRadius: number; outerRadius: number }
        const ang = (p.startAngle + p.endAngle) / 2
        const midR = (p.innerRadius + p.outerRadius) / 2
        const w = ctx.measureText(lab).width
        const cabeDentro = (p.endAngle - p.startAngle) * midR >= w + 12 && (p.outerRadius - p.innerRadius) >= 14
        if (cabeDentro) {
          ctx.save()
          ctx.translate(p.x + Math.cos(ang) * midR, p.y + Math.sin(ang) * midR)
          let rot = ang + Math.PI / 2          // tangente ao anel
          if (Math.sin(ang) > 0) rot += Math.PI // metade de baixo: mantém de pé
          ctx.rotate(rot)
          ctx.textAlign = 'center'
          ctx.fillStyle = corLegivel(externos[i].cor)
          ctx.fillText(lab, 0, 0)
          ctx.restore()
        } else {
          const side: 1 | -1 = Math.cos(ang) >= 0 ? 1 : -1
          fora.push({
            ax: p.x + Math.cos(ang) * (p.outerRadius + 3),
            ay: p.y + Math.sin(ang) * (p.outerRadius + 3),
            tx: p.x + side * (p.outerRadius + 22),
            ty: p.y + Math.sin(ang) * (p.outerRadius + 12),
            side, label: lab,
          })
        }
      })

      // Distribui verticalmente os rótulos externos (fatias finas), sempre
      // dentro de [topo, base]; comprime o gap se não couber (não corta).
      const gap = 14
      const topo = chartArea.top + 4
      const base = chartArea.bottom - 4
      for (const side of [1, -1] as const) {
        const ls = fora.filter((l) => l.side === side).sort((a, b) => a.ty - b.ty)
        if (!ls.length) continue
        for (let i = 1; i < ls.length; i++) ls[i].ty = Math.max(ls[i].ty, ls[i - 1].ty + gap)
        const sobra = ls[ls.length - 1].ty - base
        if (sobra > 0) for (const l of ls) l.ty -= sobra
        for (let i = ls.length - 2; i >= 0; i--) ls[i].ty = Math.min(ls[i].ty, ls[i + 1].ty - gap)
        if (ls[0].ty < topo) {
          const g2 = ls.length > 1 ? Math.min(gap, (base - topo) / (ls.length - 1)) : 0
          ls.forEach((l, i) => { l.ty = topo + i * g2 })
        }
      }
      ctx.lineWidth = 1
      ctx.strokeStyle = corLinha
      const margem = 4
      for (const l of fora) {
        const w = ctx.measureText(l.label).width
        if (l.side === 1) l.tx = Math.min(l.tx, chart.width - margem - 4 - w)
        else              l.tx = Math.max(l.tx, margem + 4 + w)
        ctx.beginPath()
        ctx.moveTo(l.ax, l.ay)
        ctx.lineTo(l.tx - l.side * 8, l.ty)
        ctx.lineTo(l.tx, l.ty)
        ctx.stroke()
        ctx.textAlign = l.side === 1 ? 'left' : 'right'
        ctx.fillStyle = corTexto
        ctx.fillText(l.label, l.tx + l.side * 4, l.ty)
      }

      // ── nome do tipo dentro do anel interno ──
      ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#10131c'
      metaInt?.data?.forEach((el, i) => {
        const p = (el as ArcElement).getProps(['x', 'y', 'startAngle', 'endAngle', 'innerRadius', 'outerRadius'], true) as
          { x: number; y: number; startAngle: number; endAngle: number; innerRadius: number; outerRadius: number }
        if (p.endAngle - p.startAngle < 0.35) return // fatia estreita: fica só no tooltip
        const ang = (p.startAngle + p.endAngle) / 2
        const r = (p.innerRadius + p.outerRadius) / 2
        const nome = tiposVis[i] ? `${TIPO_ATIVO_LABEL[tiposVis[i].tipo]} ${tiposVis[i].pct}%` : ''
        if (nome) ctx.fillText(nome, p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r)
      })
      ctx.restore()
    },
  }), [])

  if (linhas.length === 0) return null

  // Resumo abaixo do gráfico, ordenado pela coluna escolhida no cabeçalho.
  const linhasOrd = [...linhas].sort((a, b) => {
    const c = sortResumo.key === 'nome'
      ? TIPO_ATIVO_LABEL[a.tipo].localeCompare(TIPO_ATIVO_LABEL[b.tipo], 'pt-BR')
      : a.total - b.total
    return sortResumo.dir === 'asc' ? c : -c
  })
  const clickSortResumo = (k: 'nome' | 'total') =>
    setSortResumo((s) => (s.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: k === 'nome' ? 'asc' : 'desc' }))
  const setaR = (k: 'nome' | 'total') =>
    sortResumo.key === k ? (sortResumo.dir === 'asc' ? ' ▲' : ' ▼') : ''
  // Cabeçalho clicável. Função helper (não componente): chamada direto no
  // JSX para não criar componente no render.
  const thR = (k: 'nome' | 'total', label: string, cls?: string) => (
    <th onClick={() => clickSortResumo(k)}
      className={`px-3 py-2.5 font-medium cursor-pointer select-none hover:text-white ${cls ?? ''}`}>
      {label}{setaR(k)}
    </th>
  )

  return (
    <div className="rounded-xl border border-white/10 p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-[15px] font-semibold text-white">Ativos por categoria</h2>
        {/* trocar o período mantém o tipo focado (drill-down). "Provisionado"
            é um toggle à parte (status, não período): desativa o dropdown
            enquanto ligado (o recorte "provisionado" ignora data). */}
        <div className="flex items-center gap-2 flex-wrap">
          <SelectDark value={periodo} onChange={(e) => trocarPeriodo(e.target.value as PeriodoRanking)}
            disabled={mostrarProvisionado} style={{ width: 'auto' }} className="!text-[13px] !py-2">
            {PERIODOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </SelectDark>
          <button onClick={() => setMostrarProvisionado((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors"
            style={mostrarProvisionado
              ? { borderColor: 'rgba(240,180,41,.5)', background: 'rgba(240,180,41,.12)', color: '#f0b429' }
              : { borderColor: 'rgba(255,255,255,.1)', color: MUTED }}>
            <Clock size={13} /> Provisionado
          </button>
        </div>
      </div>

      {/* Voltar do drill-down: abaixo do label, em linha própria */}
      {tipoFoco && (
        <button onClick={desfocar}
          className="flex items-center gap-1.5 px-3 py-1.5 mb-3 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
          <ArrowLeft size={13} />
          Voltar
          <span className="font-semibold" style={{ color: COR_SUAVE[tipoFoco] }}>· {TIPO_ATIVO_LABEL[tipoFoco]}</span>
        </button>
      )}

      {tiposVis.length === 0 ? (
        <p className="text-[13px] text-center py-6" style={{ color: MUTED }}>
          Nenhum provento no período selecionado.
        </p>
      ) : (
        <div className="h-[500px] w-full max-w-[760px] mx-auto mb-4">
          <Doughnut
            plugins={[pluginRotulos]}
            data={{
              datasets: [
                { // anel externo: ativos
                  data: externos.map((o) => o.valor),
                  backgroundColor: externos.map((o) => o.cor),
                  borderWidth: 0, spacing: 2, borderRadius: 5, hoverOffset: 5,
                },
                { // anel interno: tipos
                  data: tiposVis.map((t) => t.total),
                  backgroundColor: tiposVis.map((t) => COR_SUAVE[t.tipo]),
                  borderWidth: 0, spacing: 2, borderRadius: 5, hoverOffset: 5,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              cutout: '45%',
              // espaço lateral p/ os rótulos com linha-guia
              layout: { padding: { left: 110, right: 110, top: 18, bottom: 18 } },
              // Sem foco: clique numa categoria (ou num ativo dela) dá zoom no tipo.
              // Já focado: clique num ativo (anel externo) abre a página dele —
              // o anel interno, ali, é só o rótulo do tipo (100% da rosca), não
              // faz nada.
              onClick: (_evt, els) => {
                if (!els.length) return
                const el = els[0]
                if (tipoFoco) {
                  if (el.datasetIndex !== 0) return
                  const ativoId = externos[el.index]?.ativoId
                  if (ativoId) window.open(`/investimentos/ativos/${ativoId}`, '_blank')
                  return
                }
                const t = el.datasetIndex === 1 ? tiposVis[el.index]?.tipo : externos[el.index]?.tipo
                if (t) focarTipo(t)
              },
              onHover: (_evt, els, chart) => {
                const podeClicar = els.length > 0 && (!tipoFoco || els[0].datasetIndex === 0)
                chart.canvas.style.cursor = podeClicar ? 'pointer' : 'default'
              },
              plugins: {
                // dados lidos pelo nosso plugin pluginRotulos (atualizam no drill-down)
                rotulosDividendos: {
                  externos,
                  tiposVis: tiposVis.map((t) => ({ tipo: t.tipo, pct: pctDe(t.total) })),
                  corTexto: dark ? '#dbe2f0' : '#1f2433',
                  corLinha: dark ? 'rgba(255,255,255,.30)' : 'rgba(0,0,0,.30)',
                },
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    title: () => '',
                    label: (ctx) => {
                      const nome = ctx.datasetIndex === 0
                        ? externos[ctx.dataIndex].label
                        : TIPO_ATIVO_LABEL[tiposVis[ctx.dataIndex].tipo]
                      const pct = ctx.datasetIndex === 0
                        ? externos[ctx.dataIndex].pct
                        : pctDe(tiposVis[ctx.dataIndex].total)
                      return ` ${nome}: ${formatBRL(ctx.parsed)} (${pct}%)`
                    },
                  },
                },
              },
            }}
          />
        </div>
      )}

      {/* Resumo por categoria (expansível → detalhamento por ativo).
          Cabeçalho clicável ordena por qualquer coluna. */}
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-[13px] whitespace-nowrap">
          <thead>
            <tr style={{ color: MUTED }}>
              {thR('nome', 'Categoria', 'text-left')}
              {thR('total', 'Total', 'text-right')}
              <th className="px-2 py-2.5 w-6"></th>
            </tr>
          </thead>
          {linhasOrd.map((l) => {
            const aberto = abertos.has(l.tipo)
            return (
              <tbody key={l.tipo}>
                <tr onClick={() => toggleAberto(l.tipo)}
                  className="border-t border-white/10 cursor-pointer select-none hover:bg-white/[0.03]">
                  <td className="px-3 py-3 font-semibold text-[14px]" style={{ color: COR_SUAVE[l.tipo] }}>
                    {TIPO_ATIVO_LABEL[l.tipo]}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-white">{formatBRL(l.total)}</td>
                  <td className="px-2 py-3 text-right">
                    {aberto ? <ChevronDown size={15} style={{ color: MUTED }} /> : <ChevronRight size={15} style={{ color: MUTED }} />}
                  </td>
                </tr>
                {aberto && [...l.ativos].sort((a, b) => b.total - a.total).map((a) => (
                  <tr key={a.ticker} className="border-t border-white/5">
                    <td className="px-3 py-1.5">
                      <span className="text-[13px] font-medium text-white">{a.ticker}</span>
                      <span className="text-[11px] ml-2" style={{ color: MUTED }}>
                        {l.total > 0 ? Math.round((a.total / l.total) * 100) : 0}% da categoria
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[12px] text-right" style={{ color: 'rgba(255,255,255,.8)' }}>
                      {formatBRL(a.total)}
                    </td>
                    <td className="px-2 py-1.5"></td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </div>
    </div>
  )
}

// ── Quadro "Objetivos ativos" ───────────────────────────────────
// Mostra objetivos de Renda Recorrente (tipo interno OBJETIVO) habilitados
// cujo período compreende a data de hoje.

function ObjetivosAtivos() {
  const { objetivos } = useObjetivos({ ativo: true, tipo: 'OBJETIVO' })
  const hoje = hojeLocal()
  const vigentes = objetivos.filter((o) => o.data_inicio <= hoje && hoje <= o.data_fim)

  if (vigentes.length === 0) return null

  return (
    <div className="rounded-xl border border-white/10 p-4 mb-4">
      <h2 className="text-[15px] font-semibold text-white mb-3">Objetivos ativos</h2>
      <div className="flex flex-wrap gap-3">
        {vigentes.map((o) => {
          const pct = Math.min(Math.max(o.percentual, 0), 100)
          return (
            <Link key={o.id} to={`/objetivos/${o.id}`}
              className="flex-1 min-w-[240px] rounded-lg border border-white/10 bg-white/[0.02] p-3 hover:border-white/25 hover:bg-white/[0.04] transition-colors"
              title="Ver detalhes do objetivo">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-white truncate">{o.icone} {o.nome}</span>
                <span className="text-[11px] shrink-0" style={{ color: MUTED }}>{TIPO_OBJETIVO_LABEL[o.tipo]}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1 mb-1.5 text-[11px]" style={{ color: MUTED }}>
                <span>{formatData(o.data_inicio)} – {formatData(o.data_fim)}</span>
                <span className="font-semibold text-white">{o.percentual}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: o.cor }} />
              </div>
              <div className="flex items-center justify-between gap-2 mt-1.5 text-[12px]">
                <span className="font-medium" style={{ color: o.cor }}>{formatBRL(o.valor_atingido)}</span>
                <span style={{ color: MUTED }}>meta {formatBRL(o.valor_meta)}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ── Quadro "Histórico mensal" (ano × mês, com média e total) ────

const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface HintResumo {
  titulo: string                                          // "04/2026"
  itens: { tipo: TipoAtivoInvestimento; valor: number }[] // só tipos com valor
  x: number
  y: number
  acima: boolean
}

// Períodos do quadro de resumo (independentes do filtro da lista)
type PeriodoResumo = 'recebidos' | 'futuros' | 'todos'
const PERIODOS_RESUMO: { value: PeriodoResumo; label: string }[] = [
  { value: 'recebidos', label: 'Recebidos' },
  { value: 'futuros',   label: 'Futuros' },
  { value: 'todos',     label: 'Todos (Recebidos e Futuros)' },
]

function ResumoMensal({ dividendos: todosDividendos }: { dividendos: InvestimentoDividendo[] }) {
  const hoje        = new Date()
  const anoAtual    = hoje.getFullYear()
  const mesCorrente = hoje.getMonth() + 1
  const [periodo, setPeriodo] = useState<PeriodoResumo>('recebidos')
  const [hint, setHint] = useState<HintResumo | null>(null)

  const dividendos = useMemo(() => {
    // Recebidos vs Futuros agora se baseia no status da projeção (PROJECAO),
    // não na data — uma projeção do mês corrente também conta como futura.
    return todosDividendos.filter((d) =>
      periodo === 'todos' ? true
      : periodo === 'futuros' ? ehProvisionado(d)
      : !ehProvisionado(d))
  }, [todosDividendos, periodo])

  const { linhas, totalGeral, porMes } = useMemo(() => {
    const porAno = new Map<number, number[]>()
    // "ano-mes" → soma por tipo de ativo (alimenta o hint da célula)
    const porMes = new Map<string, Map<TipoAtivoInvestimento, number>>()
    let totalGeral = 0
    for (const d of dividendos) {
      const ano = Number(d.data_pagamento.slice(0, 4))
      const mes = Number(d.data_pagamento.slice(5, 7))
      if (!porAno.has(ano)) porAno.set(ano, Array(12).fill(0))
      porAno.get(ano)![mes - 1] += d.valor
      totalGeral += d.valor
      const k = `${ano}-${mes}`
      if (!porMes.has(k)) porMes.set(k, new Map())
      const m = porMes.get(k)!
      m.set(d.tipo_ativo, (m.get(d.tipo_ativo) ?? 0) + d.valor)
    }
    const linhas = [...porAno.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([ano, meses]) => {
        const total = meses.reduce((s, v) => s + v, 0)
        // Média: anos passados dividem por 12; ano atual pelos meses já
        // decorridos (parcial); anos futuros pelos meses com valor.
        const divisor = ano < anoAtual ? 12
          : ano === anoAtual ? mesCorrente
          : Math.max(1, meses.filter((v) => v > 0).length)
        return { ano, meses, total, media: total / divisor, parcial: ano >= anoAtual }
      })
    return { linhas, totalGeral, porMes }
  }, [dividendos, anoAtual, mesCorrente])

  const mostrarHint = (ano: number, mesIdx: number, el: HTMLElement) => {
    const itens = [...(porMes.get(`${ano}-${mesIdx + 1}`)?.entries() ?? [])]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([tipo, valor]) => ({ tipo, valor }))
    if (itens.length === 0) return
    const r = el.getBoundingClientRect()
    const altura = 40 + itens.length * 46 // estimativa p/ decidir abrir acima
    const acima  = r.bottom + altura + 8 > window.innerHeight
    setHint({
      titulo: `${String(mesIdx + 1).padStart(2, '0')}/${ano}`,
      itens,
      x: Math.min(Math.max(r.left + r.width / 2, 110), window.innerWidth - 110),
      y: acima ? r.top - 6 : r.bottom + 6,
      acima,
    })
  }

  if (todosDividendos.length === 0) return null

  return (
    <div className="rounded-xl border border-white/10 mb-4 overflow-hidden">
      <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 border-b border-white/10 bg-white/[0.02]">
        <h2 className="text-[15px] font-semibold text-white">Histórico mensal</h2>
        <div className="flex items-center gap-3">
          <span className="text-[13px]" style={{ color: MUTED }}>
            Total <span className="font-semibold text-[14px]" style={{ color: '#00c896' }}>{formatBRL(totalGeral)}</span>
          </span>
          <SelectDark value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoResumo)} className="!py-1.5 !text-[13px] min-w-[120px]">
            {PERIODOS_RESUMO.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </SelectDark>
        </div>
      </div>
      {linhas.length === 0 && (
        <p className="text-[13px] text-center py-4" style={{ color: MUTED }}>
          Nenhum dividendo no período selecionado.
        </p>
      )}
      <div className="overflow-x-auto" onScroll={() => setHint(null)}>
        <table className="w-full text-[12px] whitespace-nowrap">
          <thead>
            <tr className="text-right" style={{ color: MUTED }}>
              <th className="px-3 py-2 font-medium text-left">Ano</th>
              {MESES_ABREV.map((m) => <th key={m} className="px-2 py-2 font-medium">{m}</th>)}
              <th className="px-3 py-2 font-medium">Média</th>
              <th className="px-3 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.ano} className="border-t border-white/5 text-right">
                <td className="px-3 py-2 text-left font-semibold text-white">{l.ano}</td>
                {l.meses.map((v, i) => (
                  <td key={i} className={v > 0 ? 'px-2 py-2 cursor-help' : 'px-2 py-2'}
                    style={{ color: v > 0 ? 'rgba(255,255,255,.8)' : MUTED, opacity: v > 0 ? 1 : 0.5 }}
                    onMouseEnter={(e) => mostrarHint(l.ano, i, e.currentTarget)}
                    onMouseLeave={() => setHint(null)}>
                    {fmtNum(v)}
                  </td>
                ))}
                <td className="px-3 py-2 font-semibold text-white">
                  <span title={l.parcial ? 'Média parcial: considera os meses até o atual' : undefined}>{fmtNum(l.media)}</span>
                </td>
                <td className="px-3 py-2 font-semibold" style={{ color: '#00c896' }}>{fmtNum(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hint && (
        <div className="fixed z-50 pointer-events-none rounded-xl border border-white/10 shadow-2xl px-4 py-3 min-w-[180px]"
          style={{ left: hint.x, top: hint.y, transform: `translate(-50%, ${hint.acima ? '-100%' : '0'})`, background: '#1a1f2e' }}>
          <p className="text-[13px] font-semibold text-white">{hint.titulo}</p>
          {hint.itens.map((it) => (
            <div key={it.tipo} className="border-t border-white/5 mt-2 pt-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[it.tipo] }} />
                <span className="text-[12px]" style={{ color: MUTED }}>{TIPO_ATIVO_LABEL[it.tipo]}</span>
              </div>
              <p className="text-[13px] font-semibold text-white mt-0.5">{formatBRL(it.valor)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Quadro "Evolução dos recebimentos" (gráfico de barras) ──────
// Só dividendos já RECEBIDOS (exclui provisionado/futuro) — igual ao padrão
// "Recebidos" do quadro Histórico mensal, que é o mesmo dado em tabela.
type GranularidadeEvolucao = 'mensal' | 'anual'
const GRANULARIDADES_EVOLUCAO: { value: GranularidadeEvolucao; label: string }[] = [
  { value: 'mensal', label: 'Mensal' },
  { value: 'anual',  label: 'Anual' },
]

// Desenha o TOTAL em cima da barra (ou do topo da pilha, no modo "por tipo de
// ativo") — o ponto mais alto entre todos os datasets no mesmo índice, já que
// o dataset "de cima" na pilha varia conforme quais tipos têm valor no
// período. Lê os dados de chart.options (não de closure) pelo mesmo motivo do
// pluginRotulos do gráfico de rosca: o react-chartjs-2 captura o plugin na
// criação do gráfico e não o recria quando a série muda (troca de
// granularidade, toggle "por tipo", filtro de tipo/ativo etc.).
const pluginValorBarra: Plugin<'bar'> = {
  id: 'valorBarra',
  afterDatasetsDraw(chart) {
    const cfg = chart.options.plugins?.valorBarra as unknown as CfgValorBarra | undefined
    if (!cfg) return
    const { ctx } = chart
    const nDatasets = chart.data.datasets.length
    ctx.save()
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = cfg.cor
    cfg.valores.forEach((v, i) => {
      if (v == null) return
      let topo: { x: number; y: number } | null = null
      for (let d = 0; d < nDatasets; d++) {
        const el = chart.getDatasetMeta(d)?.data?.[i]
        if (!el) continue
        const p = (el as BarElement).getProps(['x', 'y'], true) as { x: number; y: number }
        if (!topo || p.y < topo.y) topo = p
      }
      if (!topo) return
      ctx.fillText(formatBRL(v), topo.x, topo.y - 4)
    })
    ctx.restore()
  },
}

function EvolucaoRecebimentos({ dividendos }: { dividendos: InvestimentoDividendo[] }) {
  const dark = useModoEscuro()
  const [granularidade, setGranularidade] = useState<GranularidadeEvolucao>('mensal')
  const [porTipo, setPorTipo] = useState(false)
  // Mesmo controle de período do quadro "Ativos por categoria" (PERIODOS/
  // inicioPeriodo, definidos ali em cima) — reaproveitado aqui pra recortar
  // até quando a evolução volta, independente da granularidade do agrupamento.
  const [periodo, setPeriodo] = useState<PeriodoRanking>('ANO')

  const dividendosNoPeriodo = useMemo(() => {
    const desdeBruto = inicioPeriodo(periodo)
    if (!desdeBruto) return dividendos
    // Cada barra representa um mês/ano INTEIRO — arredonda o corte pra baixo
    // até o início do mês (ou do ano, na granularidade anual). Sem isso, um
    // período tipo "Últimos 12 meses" corta o mês-fronteira ao meio (ex.: só
    // as recebidas a partir do dia 21) e a barra daquele mês fica menor que o
    // total real do extrato, sem nenhum aviso.
    const desde = granularidade === 'anual' ? `${desdeBruto.slice(0, 4)}-01-01` : `${desdeBruto.slice(0, 7)}-01`
    return dividendos.filter((d) => d.data_pagamento >= desde)
  }, [dividendos, periodo, granularidade])

  // Totais por mês (YYYY-MM), já detalhados por tipo de ativo — a versão
  // agregada (modo padrão) é só a soma dos tipos de cada mês.
  const porMesDetalhado = useMemo(() => {
    const mapa = new Map<string, Map<TipoAtivoInvestimento, number>>()
    for (const d of dividendosNoPeriodo) {
      if (ehProvisionado(d)) continue
      const ym = d.data_pagamento.slice(0, 7)
      if (!mapa.has(ym)) mapa.set(ym, new Map())
      const m = mapa.get(ym)!
      m.set(d.tipo_ativo, (m.get(d.tipo_ativo) ?? 0) + d.valor)
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [dividendosNoPeriodo])

  const serieDetalhada = useMemo(() => {
    if (granularidade === 'mensal') return porMesDetalhado
    const porAno = new Map<string, Map<TipoAtivoInvestimento, number>>()
    for (const [ym, porTipoAno] of porMesDetalhado) {
      const ano = ym.slice(0, 4)
      if (!porAno.has(ano)) porAno.set(ano, new Map())
      const acc = porAno.get(ano)!
      for (const [tipo, v] of porTipoAno) acc.set(tipo, (acc.get(tipo) ?? 0) + v)
    }
    return [...porAno.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [porMesDetalhado, granularidade])

  // Tipos com total > 0 na janela exibida (soma de todos os períodos), na
  // ordem alfabética do rótulo — cada um vira um dataset (segmento) empilhado
  // e uma entrada na legenda quando "por tipo" está ligado. Um tipo cujo saldo
  // no período zera (ex.: estorno) não aparece nem no gráfico nem na legenda.
  const tiposPresentes = useMemo(() => {
    const totaisPorTipo = new Map<TipoAtivoInvestimento, number>()
    for (const [, porTipoNoPeriodo] of serieDetalhada)
      for (const [tipo, v] of porTipoNoPeriodo) totaisPorTipo.set(tipo, (totaisPorTipo.get(tipo) ?? 0) + v)
    return [...totaisPorTipo.entries()]
      .filter(([, total]) => total > 0)
      .map(([tipo]) => tipo)
      .sort((a, b) => TIPO_ATIVO_LABEL[a].localeCompare(TIPO_ATIVO_LABEL[b], 'pt-BR'))
  }, [serieDetalhada])

  const totais = useMemo(() =>
    serieDetalhada.map(([, porTipoNoPeriodo]) => [...porTipoNoPeriodo.values()].reduce((s, v) => s + v, 0)),
  [serieDetalhada])

  const corTick  = dark ? '#8b92a8' : '#6b7280'
  const corGrid  = dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.08)'
  const corValor = dark ? '#e8eaf0' : '#1f2433'

  if (dividendos.length === 0) return null

  const labels = serieDetalhada.map(([chave]) => granularidade === 'mensal' ? mesLabel(chave) : chave)
  const espessura = granularidade === 'anual' ? 64 : 28

  return (
    <div className="rounded-xl border border-white/10 p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-[15px] font-semibold text-white">Evolução dos recebimentos</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <SelectDark value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoRanking)}
            style={{ width: 'auto' }} className="!text-[13px] !py-1.5">
            {PERIODOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </SelectDark>
          <button onClick={() => setPorTipo((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[13px] font-medium transition-colors"
            style={porTipo
              ? { borderColor: 'rgba(0,200,150,.5)', background: 'rgba(0,200,150,.12)', color: '#00c896' }
              : { borderColor: 'var(--border-subtle)', color: MUTED }}>
            <Layers size={13} /> Por tipo de ativo
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5">
            {GRANULARIDADES_EVOLUCAO.map((g) => (
              <button key={g.value} onClick={() => setGranularidade(g.value)}
                className="px-3 py-1 rounded-md text-[13px] font-medium transition-colors"
                style={granularidade === g.value
                  ? { background: 'rgba(0,200,150,.15)', color: '#00c896' }
                  : { color: MUTED }}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {porMesDetalhado.length === 0 ? (
        <p className="text-[13px] text-center py-6" style={{ color: MUTED }}>
          Nenhum recebimento no período selecionado.
        </p>
      ) : (
      <div className="h-[280px] w-full">
        <Bar
          plugins={[pluginValorBarra]}
          data={{
            labels,
            datasets: porTipo
              ? tiposPresentes.map((tipo) => ({
                  label: TIPO_ATIVO_LABEL[tipo],
                  data: serieDetalhada.map(([, porTipoNoPeriodo]) => Number((porTipoNoPeriodo.get(tipo) ?? 0).toFixed(2))),
                  backgroundColor: COR_SUAVE[tipo],
                  stack: 'total',
                  maxBarThickness: espessura,
                }))
              : [{
                  label: 'Recebido',
                  data: totais.map((v) => Number(v.toFixed(2))),
                  backgroundColor: '#00c896aa',
                  borderRadius: 4,
                  stack: 'total',
                  maxBarThickness: espessura,
                }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 20 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: porTipo
                ? { display: true, position: 'bottom', labels: { color: corTick, boxWidth: 12, padding: 12 } }
                : { display: false },
              tooltip: {
                // Numa pilha por tipo, nem todo tipo tem valor em todo período
                // (ex.: só recebeu FII em setembro) — o dataset continua
                // existindo pra manter a pilha correta nos outros meses, mas
                // o tooltip desse mês não deve listar tipo nenhum com R$ 0,00.
                filter: (item) => (item.parsed.y ?? 0) > 0,
                callbacks: {
                  label: (ctx) => ` ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y ?? 0)}`,
                  footer: porTipo ? (itens) => `Total: ${formatBRL(itens.reduce((s, it) => s + (it.parsed.y ?? 0), 0))}` : undefined,
                },
              },
              valorBarra: { valores: totais, cor: corValor },
            },
            scales: {
              x: { ticks: { color: corTick }, grid: { display: false }, stacked: true },
              y: { ticks: { color: corTick, callback: (v) => formatBRL(Number(v)) }, grid: { color: corGrid }, stacked: true },
            },
          }}
        />
      </div>
      )}
    </div>
  )
}

// ── Lista de dividendos (filtros + ordenação + agrupamento) ─────

type DivSortKey = 'ticker' | 'tipo' | 'data' | 'valor'

function ListaDividendos({ dividendos, onExcluir, onConfirmar }: {
  dividendos: InvestimentoDividendo[]
  onExcluir: (d: InvestimentoDividendo) => void
  onConfirmar: (d: InvestimentoDividendo) => void
}) {
  const [filtroTicker, setFiltroTicker] = useState('')
  const [filtroTipoAtivo, setFiltroTipoAtivo] = useState<'' | TipoAtivoInvestimento>('')
  const [agrupar, setAgrupar] = useState(true)
  const [sort, setSort] = useState<{ key: DivSortKey; dir: 'asc' | 'desc' }>({ key: 'data', dir: 'desc' })

  const tipoLabel = (d: InvestimentoDividendo) => d.inv_tipos_dividendo?.nome ?? TIPO_DEFAULT_LABEL(d.tipo_ativo)

  // Tickers correlatos ao tipo de ativo selecionado (tipo vem antes do ativo)
  const tickers = useMemo(() => {
    const s = new Set<string>()
    for (const d of dividendos) {
      if (filtroTipoAtivo && d.tipo_ativo !== filtroTipoAtivo) continue
      if (d.inv_ativos?.ticker) s.add(d.inv_ativos.ticker)
    }
    return [...s].sort()
  }, [dividendos, filtroTipoAtivo])
  const tiposAtivo = useMemo(() => {
    const s = new Set<TipoAtivoInvestimento>()
    for (const d of dividendos) s.add(d.tipo_ativo)
    return [...s]
  }, [dividendos])

  const mudarTipoAtivo = (t: '' | TipoAtivoInvestimento) => {
    setFiltroTipoAtivo(t)
    setFiltroTicker('') // ticker pode não pertencer ao novo tipo
  }

  // Recorte por tipo/ativo — alimenta o quadro de resumo (que tem período próprio)
  // e o extrato (paginado por mês, sem filtro de período).
  const filtradosBase = useMemo(() => dividendos.filter((d) =>
    (!filtroTipoAtivo || d.tipo_ativo === filtroTipoAtivo) &&
    (!filtroTicker || d.inv_ativos?.ticker === filtroTicker)
  ), [dividendos, filtroTicker, filtroTipoAtivo])

  const filtrados = filtradosBase

  const valorOrd = (d: InvestimentoDividendo): string | number => {
    switch (sort.key) {
      case 'ticker': return d.inv_ativos?.ticker ?? ''
      case 'tipo':   return tipoLabel(d)
      case 'data':   return d.data_pagamento
      case 'valor':  return d.valor
    }
  }
  const ordenados = useMemo(() => {
    const arr = [...filtrados]
    arr.sort((a, b) => {
      const va = valorOrd(a), vb = valorOrd(b)
      const c = typeof va === 'number' && typeof vb === 'number'
        ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
      return sort.dir === 'asc' ? c : -c
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, sort])

  const clickSort = (key: DivSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'valor' || key === 'data' ? 'desc' : 'asc' }))

  // O extrato mostra um mês por vez (via MonthPicker); dentro do mês os
  // lançamentos são opcionalmente agrupados por tipo de ativo.
  // Subgrupos de tipo recolhidos, por chave "YYYY-MM|TIPO"
  const [tiposFechados, setTiposFechados] = useState<Set<string>>(new Set())
  const toggleTipo = (ym: string, tipo: TipoAtivoInvestimento) => setTiposFechados((s) => {
    const k = `${ym}|${tipo}`
    const n = new Set(s)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  const porMesExtrato = useMemo(() => {
    const map = new Map<string, InvestimentoDividendo[]>()
    for (const d of ordenados) {
      const ym = d.data_pagamento.slice(0, 7)
      if (!map.has(ym)) map.set(ym, [])
      map.get(ym)!.push(d)
    }
    // Meses acompanham a direção quando a ordenação é por data
    const dirMes = sort.key === 'data' && sort.dir === 'asc' ? 1 : -1
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]) * dirMes)
      .map(([ym, lista]) => {
        let grupos: { tipo: TipoAtivoInvestimento; lista: InvestimentoDividendo[]; total: number }[] | null = null
        if (agrupar) {
          const porTipo = new Map<TipoAtivoInvestimento, InvestimentoDividendo[]>()
          for (const d of lista) {
            if (!porTipo.has(d.tipo_ativo)) porTipo.set(d.tipo_ativo, [])
            porTipo.get(d.tipo_ativo)!.push(d)
          }
          grupos = [...porTipo.entries()]
            .map(([tipo, ls]) => ({ tipo, lista: ls, total: ls.reduce((s, d) => s + d.valor, 0) }))
            .sort((a, b) => b.total - a.total)
        }
        return { ym, lista, grupos, total: lista.reduce((s, d) => s + d.valor, 0) }
      })
  }, [ordenados, agrupar, sort])

  // Mês exibido no extrato — escolhido pelo calendário padrão (MonthPicker).
  const [mesSel, setMesSel] = useState<string>(mesAtual())
  const mesPagina = porMesExtrato.find((m) => m.ym === mesSel) ?? null

  const total = useMemo(() => filtrados.reduce((s, d) => s + d.valor, 0), [filtrados])

  const seta = (k: DivSortKey) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')
  const Th = ({ k, label, cls }: { k: DivSortKey; label: string; cls?: string }) => (
    <th onClick={() => clickSort(k)}
      className={`px-4 py-2.5 font-medium cursor-pointer select-none hover:text-white ${cls ?? ''}`}>
      {label}{seta(k)}
    </th>
  )

  const linha = (d: InvestimentoDividendo) => (
    <tr key={d.id} className="border-t border-white/5">
      <td className="px-4 py-2.5 font-semibold text-white">{d.inv_ativos?.ticker ?? '—'}</td>
      <td className="px-4 py-2.5">
        {d.inv_tipos_dividendo?.nome
          ? <span className="text-white/80">{d.inv_tipos_dividendo.nome}</span>
          : <span className="italic" style={{ color: MUTED }}>{TIPO_DEFAULT_LABEL(d.tipo_ativo)}</span>}
      </td>
      <td className="px-4 py-2.5 text-white/80">{formatData(d.data_pagamento)}</td>
      <td className="px-4 py-2.5 text-right font-medium" style={{ color: '#00c896' }}>{formatBRL(d.valor)}</td>
      <td className="px-4 py-2.5 text-center">
        {d.transacoes?.status === 'PROJECAO' ? (
          <span className="text-[12px] px-2 py-0.5 rounded-full" style={{ background: '#ffb74d22', color: '#ffb74d' }}>Projetado</span>
        ) : d.transacao_extrato_id ? (
          <span className="text-[12px] px-2 py-0.5 rounded-full" style={{ background: '#00c89622', color: '#00c896' }}>Pago</span>
        ) : (
          <span className="text-[12px]" style={{ color: MUTED }}>—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          {d.transacoes?.status === 'PROJECAO' && (
            <button onClick={() => onConfirmar(d)} title="Confirmar recebimento"
              className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-emerald-400/40" style={{ color: '#00c896' }}>
              <CheckCircle2 size={13} />
            </button>
          )}
          <button onClick={() => onExcluir(d)} className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-red-400/40" style={{ color: '#ff5c7a' }}>
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  )

  return (
    <>
      {/* Filtros — tipo de ativo → ativo (valem p/ quadro e extrato) */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SelectDark value={filtroTipoAtivo} onChange={(e) => mudarTipoAtivo(e.target.value as '' | TipoAtivoInvestimento)}
          style={{ width: 'auto' }} className="!py-1.5 !text-[13px] min-w-[130px]">
          <option value="">Todos os tipos</option>
          {tiposAtivo.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
        </SelectDark>
        <SelectDark value={filtroTicker} onChange={(e) => setFiltroTicker(e.target.value)}
          style={{ width: 'auto' }} className="!py-1.5 !text-[13px] min-w-[130px]">
          <option value="">Todos os ativos</option>
          {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
        </SelectDark>
        {(filtroTicker || filtroTipoAtivo) && (
          <button onClick={() => { setFiltroTicker(''); setFiltroTipoAtivo('') }}
            className="text-[13px] px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-white/25" style={{ color: MUTED }}>
            Limpar
          </button>
        )}
      </div>

      <ResumoMensal dividendos={filtradosBase} />
      <EvolucaoRecebimentos dividendos={filtradosBase} />

      {/* Extrato — mês escolhido pelo calendário padrão (MonthPicker), centralizado */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1" />
        <MonthPicker value={mesSel} onChange={setMesSel} />
        <div className="flex-1 flex items-center justify-end gap-2">
          <button onClick={() => setAgrupar((a) => !a)}
            className="text-[13px] px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-white/25" style={{ color: MUTED }}>
            Agrupar por tipo: {agrupar ? 'ligado' : 'desligado'}
          </button>
          <span className="text-[13px] font-medium" style={{ color: '#00c896' }}>{formatBRL(total)}</span>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left" style={{ color: MUTED }}>
              <Th k="ticker" label="Ativo" />
              <Th k="tipo" label="Tipo" />
              <Th k="data" label="Pagamento" />
              <Th k="valor" label="Valor" cls="text-right" />
              <th className="px-4 py-2.5 font-medium text-center">Extrato</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          {(mesPagina ? [mesPagina] : []).map((m) => (
            <tbody key={m.ym}>
              {m.grupos
                ? m.grupos.flatMap((g) => {
                    const tipoAberto = !tiposFechados.has(`${m.ym}|${g.tipo}`)
                    return [
                      <tr key={`${m.ym}-${g.tipo}`} className="border-t border-white/10 bg-white/[0.02] cursor-pointer select-none hover:bg-white/[0.05]"
                        onClick={() => toggleTipo(m.ym, g.tipo)}>
                        <td colSpan={3} className="px-4 py-1.5">
                          <span className="inline-flex items-center gap-1.5 font-medium text-[12px]" style={{ color: TIPO_ATIVO_COR[g.tipo] }}>
                            {tipoAberto ? <ChevronDown size={12} style={{ color: MUTED }} /> : <ChevronRight size={12} style={{ color: MUTED }} />}
                            {TIPO_ATIVO_LABEL[g.tipo]}
                          </span>
                          <span className="text-[11px] ml-2" style={{ color: MUTED }}>· {g.lista.length}</span>
                        </td>
                        <td className="px-4 py-1.5 text-right font-medium text-[12px]" style={{ color: '#00c896' }}>{formatBRL(g.total)}</td>
                        <td colSpan={2}></td>
                      </tr>,
                      ...(tipoAberto ? g.lista.map(linha) : []),
                    ]
                  })
                : m.lista.map(linha)}
            </tbody>
          ))}
        </table>
      </div>

      {ordenados.length === 0 ? (
        <p className="text-[13px] text-center py-4" style={{ color: MUTED }}>Nenhum dividendo para os filtros selecionados.</p>
      ) : !mesPagina && (
        <p className="text-[13px] text-center py-4" style={{ color: MUTED }}>
          Nenhum dividendo em {mesLabel(mesSel, 'longo')}.
        </p>
      )}
    </>
  )
}

// ── Drawer: novo dividendo ──────────────────────────────────────

function DrawerNovoDividendo({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const { ativos } = useInvestimentosAtivos()
  const { tipos }  = useTiposDividendo()
  const { contas } = useContas()
  const { criar }  = useDividendos()

  const [ativoId,  setAtivoId]  = useState('')
  const [tipoDivId, setTipoDivId] = useState('')
  const [contaId,  setContaId]  = useState('')
  const [valor,    setValor]    = useState('')
  const [data,     setData]     = useState(hojeLocal())
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)

  const ativoSel = ativos.find((a) => a.id === ativoId)

  async function salvar() {
    if (!ativoId)   { onToast('Selecione o ativo'); return }
    if (!tipoDivId) { onToast('Selecione o tipo de dividendo'); return }
    if (!contaId)   { onToast('Selecione a conta'); return }
    const v = Number(valor)
    if (!(v > 0)) { onToast('Informe um valor maior que zero'); return }

    setSalvando(true)
    const payload: CriarDividendoInput = {
      ativo_id: ativoId,
      conta_id: contaId,
      valor: v,
      data_pagamento: data,
      tipo_ativo: (ativoSel?.tipo_ativo ?? 'ACOES') as TipoAtivoInvestimento,
      tipo_dividendo_id: tipoDivId,
      descricao: descricao.trim() || null,
    }
    const res = await criar(payload)
    setSalvando(false)
    if (res.ok) { onToast('Dividendo lançado no extrato!'); onClose() }
    else onToast(res.erro ?? 'Erro ao lançar dividendo')
  }

  const semTipos = tipos.length === 0
  const tipoSemCategoria = tipoDivId && !tipos.find((t) => t.id === tipoDivId)?.categoria_id

  return (
    <Drawer open onClose={onClose} titulo="Novo dividendo" subtitulo="Gera uma receita no extrato"
      rodape={<><BtnCancelar onClick={onClose} /><BtnSalvar editando={false} onClick={salvar} salvando={salvando} labelSalvar="Lançar" /></>}>
      <Field label="Ativo">
        <SearchableSelect value={ativoId} onChange={setAtivoId} placeholder="Buscar ativo..."
          opcoes={ativos.map((a) => ({ id: a.id, label: a.ticker, sublabel: a.nome }))} />
      </Field>
      <Field label="Tipo de dividendo">
        <SelectDark value={tipoDivId} onChange={(e) => setTipoDivId(e.target.value)}>
          <option value="">Selecione...</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}{t.categoria_id ? '' : ' (sem categoria)'}</option>)}
        </SelectDark>
        {semTipos && <p className="text-[12px] mt-1" style={{ color: '#ffb74d' }}>Nenhum tipo configurado. Mapeie em Configurações → Tipos de dividendo.</p>}
        {tipoSemCategoria && <p className="text-[12px] mt-1" style={{ color: '#ffb74d' }}>Este tipo não tem categoria mapeada — configure antes de lançar.</p>}
      </Field>
      <Field label="Conta de recebimento">
        <SelectDark value={contaId} onChange={(e) => setContaId(e.target.value)}>
          <option value="">Selecione...</option>
          {contas.filter((c) => c.tipo === 'INVESTIMENTO' && c.ativa).map((c) => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
        </SelectDark>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor">
          <Input type="number" min={0} step="any" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Data de pagamento">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
      </div>
      {data > hojeLocal() && (
        <p className="text-[12px]" style={{ color: MUTED }}>Data futura → será lançado como projeção (PROJECAO) no extrato.</p>
      )}
      <Field label="Descrição (opcional)">
        <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Observação" />
      </Field>
    </Drawer>
  )
}

// ── Drawer: confirmar dividendo projetado ───────────────────────

function DrawerConfirmar({ dividendo, onClose, onToast }: {
  dividendo: InvestimentoDividendo; onClose: () => void; onToast: (m: string) => void
}) {
  const { confirmar } = useDividendos()
  const [valor,    setValor]    = useState(String(dividendo.valor))
  const [data,     setData]     = useState(hojeLocal())
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    const v = Number(valor)
    if (!(v > 0)) { onToast('Informe o valor recebido'); return }
    setSalvando(true)
    const res = await confirmar(dividendo.id, { valor: v, data_pagamento: data })
    setSalvando(false)
    if (res.ok) { onToast('Recebimento confirmado — extrato atualizado.'); onClose() }
    else onToast(res.erro ?? 'Erro ao confirmar')
  }

  return (
    <Drawer open onClose={onClose} titulo={`Confirmar · ${dividendo.inv_ativos?.ticker ?? 'Dividendo'}`}
      subtitulo="A projeção do extrato vira receita paga"
      rodape={<><BtnCancelar onClick={onClose} /><BtnSalvar editando={false} onClick={salvar} salvando={salvando} labelSalvar="Confirmar" /></>}>
      <p className="text-[13px]" style={{ color: MUTED }}>
        Projetado: {formatBRL(dividendo.valor)} para {formatData(dividendo.data_pagamento)}.
        Ajuste abaixo com o valor e a data reais do recebimento.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor recebido">
          <Input type="number" min={0} step="any" value={valor} onChange={(e) => setValor(e.target.value)} />
        </Field>
        <Field label="Data do recebimento">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  )
}

