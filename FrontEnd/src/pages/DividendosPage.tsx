import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { Plus, Trash2, Settings, ArrowLeft, Coins, CheckCircle2, Link2, ChevronDown, ChevronRight, Layers, AlertTriangle, RefreshCw } from 'lucide-react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip as ChartTooltip, type Plugin, type ChartType } from 'chart.js'
import { Link } from 'react-router-dom'
import { useDividendos, type CriarDividendoInput } from '../hooks/useDividendos'
import { useObjetivos } from '../hooks/useObjetivos'
import { useTiposDividendo } from '../hooks/useTiposDividendo'
import { useAvisosDividendos, type AvisoTipoDividendo } from '../hooks/useAvisosDividendos'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useCategorias } from '../hooks/useCategorias'
import { useContas } from '../hooks/useContas'
import { apiFetch, extrairLista } from '../lib/api'
import {
  Drawer, Field, Input, SelectDark, SearchableSelect, BtnSalvar, BtnCancelar,
  Toast, ModalExcluir, Segmented,
} from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import { MonthPicker } from '../components/ui/MonthPicker'
import { formatBRL, formatData, hojeLocal, mesAtual, mesLabel, MESES_ABREV } from '../lib/utils'
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR, TIPO_OBJETIVO_LABEL } from '../lib/constants'
import type { InvestimentoDividendo, InvestimentoTipoDividendo, TipoAtivoInvestimento } from '../types'

ChartJS.register(ArcElement, ChartTooltip)

// Opção customizada do gráfico de dividendos: dados que o plugin de rótulos
// lê de chart.options (em vez de closure, que o react-chartjs-2 não recria).
interface CfgRotulos {
  externos: { label: string; pct: number; cor: string }[]
  tiposVis: { tipo: TipoAtivoInvestimento; pct: number }[]
  corTexto: string
  corLinha: string
}
declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    rotulosDividendos?: CfgRotulos
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

// Lista de meses (YYYY-MM) de `ini` até `fim`, inclusive.
function gerarMeses(ini: string, fim: string): string[] {
  const out: string[] = []
  let [a, m] = ini.split('-').map(Number)
  const [af, mf] = fim.split('-').map(Number)
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; a++ }
  }
  return out
}
function mesMenos(m: string, n: number): string {
  const [a, mo] = m.split('-').map(Number)
  let a2 = a, m2 = mo - n
  while (m2 <= 0) { m2 += 12; a2-- }
  return `${a2}-${String(m2).padStart(2, '0')}`
}

export default function DividendosPage() {
  const [drawerNovo,   setDrawerNovo]   = useState(false)
  const [drawerConfig, setDrawerConfig] = useState(false)
  const [drawerAssoc,  setDrawerAssoc]  = useState(false)
  const [excluindo,    setExcluindo]    = useState<InvestimentoDividendo | null>(null)
  const [confirmando,  setConfirmando]  = useState<InvestimentoDividendo | null>(null)
  const [salvando,     setSalvando]     = useState(false)
  const [buscando,     setBuscando]     = useState(false)
  const [backfilling,  setBackfilling]  = useState(false)
  const [associando,   setAssociando]   = useState(false)
  const [toast,        setToast]        = useState<string | null>(null)

  const { dividendos, loading, excluir, buscarBrl, backfillRate, associarMassa } = useDividendos()

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(null), 4000) }

  async function buscarProventos() {
    setBuscando(true)
    const res = await buscarBrl()
    setBuscando(false)
    if (!res.ok) { showToast(res.erro ?? 'Erro ao buscar proventos'); return }
    const d = res.dados
    const mudou = (d?.criados ?? 0) + (d?.atualizados ?? 0)
    if (mudou === 0) showToast('Busca concluída — nenhum provento novo na B3.')
    else showToast(`Busca concluída — ${d?.criados ?? 0} novo(s), ${d?.atualizados ?? 0} atualizado(s).`)
  }

  async function backfillYoc() {
    setBackfilling(true)
    const res = await backfillRate()
    setBackfilling(false)
    if (!res.ok) { showToast(res.erro ?? 'Erro ao preencher dividendo por cota'); return }
    const d = res.dados
    showToast(`Backfill concluído — ${d?.preenchidos ?? 0} provento(s) atualizado(s) com o dividendo por cota da B3.`)
  }

  async function associarDoExtrato() {
    setAssociando(true)
    const res = await associarMassa()
    setAssociando(false)
    if (!res.ok) { showToast(res.erro ?? 'Erro ao associar do extrato'); return }
    const d = res.dados
    showToast((d?.associados ?? 0) === 0
      ? 'Nenhum provento do extrato para associar.'
      : `${d?.associados} provento(s) do extrato associado(s) aos investimentos.`)
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

  if (loading) return <LoadingMascote />

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/investimentos" className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="text-[22px] font-bold text-white">Proventos</h1>
            <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>Proventos recebidos, integrados ao extrato</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={buscarProventos} disabled={buscando}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25 disabled:opacity-60"
            title="Busca proventos na B3 e provisiona os futuros (ações e FIIs em BRL)">
            <RefreshCw size={15} className={buscando ? 'animate-spin' : ''} /> {buscando ? 'Buscando…' : 'Buscar proventos'}
          </button>
          <button onClick={backfillYoc} disabled={backfilling}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25 disabled:opacity-60"
            title="Re-busca da B3 o dividendo por cota dos proventos antigos — corrige DY e Yield on Cost no padrão investidor10">
            <Coins size={15} className={backfilling ? 'animate-spin' : ''} /> {backfilling ? 'Atualizando…' : 'Atualizar DY/YoC'}
          </button>
          <button onClick={associarDoExtrato} disabled={associando}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25 disabled:opacity-60"
            title="Vincula em lote proventos que já estão no extrato (ex.: projeções de FII lançadas na mão) aos investimentos">
            <Link2 size={15} className={associando ? 'animate-spin' : ''} /> {associando ? 'Associando…' : 'Associar extrato (lote)'}
          </button>
          <button onClick={() => setDrawerConfig(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
            <Settings size={15} /> Configurar tipos
          </button>
          <button onClick={() => setDrawerAssoc(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
            <Link2 size={15} /> Associar do extrato
          </button>
          <button onClick={() => setDrawerNovo(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white" style={{ background: '#3b82f6' }}>
            <Plus size={15} /> Novo dividendo
          </button>
        </div>
      </div>

      <Toast msg={toast} />

      <AvisoMapeamento onConfigurar={() => setDrawerConfig(true)} />

      <ProventosPorCategoria dividendos={dividendos} />
      <AtivosPorCategoria dividendos={dividendos} />
      <ObjetivosAtivos />

      {/* Lista */}
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

      {drawerNovo   && <DrawerNovoDividendo onClose={() => setDrawerNovo(false)} onToast={showToast} />}
      {drawerConfig && <DrawerConfigTipos   onClose={() => setDrawerConfig(false)} onToast={showToast} />}
      {drawerAssoc  && <DrawerAssociar      onClose={() => setDrawerAssoc(false)} onToast={showToast} />}
      {confirmando  && <DrawerConfirmar dividendo={confirmando} onClose={() => setConfirmando(null)} onToast={showToast} />}

      {excluindo && (
        <ModalExcluir nome={`${excluindo.inv_ativos?.ticker ?? 'Dividendo'} · ${formatBRL(excluindo.valor)}`}
          mensagem="A transação vinculada no extrato também será removida."
          onConfirmar={confirmarExclusao} onCancelar={() => setExcluindo(null)} salvando={salvando} />
      )}
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

function AvisoMapeamento({ onConfigurar }: { onConfigurar: () => void }) {
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
        <button onClick={onConfigurar}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] text-white hover:border-white/40"
          style={{ borderColor: 'rgba(255,183,77,0.5)' }}>
          <Settings size={15} /> Configurar tipos
        </button>
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

type PeriodoGraf = '6m' | '12m' | '24m' | 'todos' | 'prov'
const PERIODOS_GRAF: { value: PeriodoGraf; label: string }[] = [
  { value: '6m',    label: 'Últ. 6 meses' },
  { value: '12m',   label: 'Últ. 12 meses' },
  { value: '24m',   label: 'Últ. 24 meses' },
  { value: 'todos', label: 'Todos recebidos' },
  { value: 'prov',  label: 'Provisionado' },
]
const IDX_GRAF: Record<PeriodoGraf, number> = { '6m': 0, '12m': 1, '24m': 2, prov: 3, todos: 4 }
const COLS_GRAF = ['Total últ. 6 meses', 'Total últ. 12 meses', 'Total últ. 24 meses', 'Provisionado', 'Total recebido']
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
  totais: number[]                                   // [6m, 12m, 24m, prov, todos recebidos]
  ativos: { ticker: string; totais: number[] }[]
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
  const [periodo, setPeriodo] = useState<PeriodoGraf>('12m')
  // Ordenação do resumo por categoria: 'nome' ou o índice de uma coluna de
  // total (0..4). Default acompanha o período escolhido (sincronizado abaixo).
  const [sortResumo, setSortResumo] = useState<{ key: 'nome' | number; dir: 'asc' | 'desc' }>(
    { key: IDX_GRAF['12m'], dir: 'desc' })
  // Drill-down: clicar numa categoria foca o gráfico só nela
  const [tipoFoco, setTipoFoco] = useState<TipoAtivoInvestimento | null>(null)
  const [abertos, setAbertos] = useState<Set<TipoAtivoInvestimento>>(new Set())
  const toggleAberto = (t: TipoAtivoInvestimento) => setAbertos((s) => {
    const n = new Set(s)
    if (n.has(t)) n.delete(t); else n.add(t)
    return n
  })

  const linhas = useMemo<LinhaGraf[]>(() => {
    const mesA = mesAtual()
    const ini6  = `${mesMenos(mesA, 5)}-01`
    const ini12 = `${mesMenos(mesA, 11)}-01`
    const ini24 = `${mesMenos(mesA, 23)}-01`

    const porTipo = new Map<TipoAtivoInvestimento, Map<string, number[]>>()
    for (const d of dividendos) {
      const dt = d.data_pagamento
      // buckets em que o registro entra (6m ⊂ 12m ⊂ 24m; prov à parte).
      // Provisionado = projeção (status PROJECAO), independe da data.
      const idxs: number[] = []
      if (ehProvisionado(d)) idxs.push(3)
      else {
        idxs.push(4) // "Todos recebidos": todo provento recebido, sem corte de data
        if (dt >= ini6)  idxs.push(0)
        if (dt >= ini12) idxs.push(1)
        if (dt >= ini24) idxs.push(2)
      }
      if (idxs.length === 0) continue
      const ticker = d.inv_ativos?.ticker ?? '—'
      if (!porTipo.has(d.tipo_ativo)) porTipo.set(d.tipo_ativo, new Map())
      const porAtivo = porTipo.get(d.tipo_ativo)!
      if (!porAtivo.has(ticker)) porAtivo.set(ticker, [0, 0, 0, 0, 0])
      const tot = porAtivo.get(ticker)!
      for (const i of idxs) tot[i] += d.valor
    }
    return [...porTipo.entries()].map(([tipo, porAtivo]) => {
      const ativos = [...porAtivo.entries()].map(([ticker, totais]) => ({ ticker, totais }))
      const totais = [0, 1, 2, 3, 4].map((i) => ativos.reduce((s, a) => s + a.totais[i], 0))
      return { tipo, totais, ativos }
    })
  }, [dividendos])

  const sel = IDX_GRAF[periodo]
  // Trocar o período reordena o resumo pela coluna correspondente (mantém o
  // gráfico e a tabela coerentes); o usuário ainda pode clicar outro cabeçalho.
  useEffect(() => { setSortResumo({ key: sel, dir: 'desc' }) }, [sel])
  // Tipos/ativos com valor no período escolhido, do maior p/ o menor
  const tipos = useMemo(() =>
    linhas.filter((l) => l.totais[sel] > 0)
      .map((l) => ({ ...l, ativos: l.ativos.filter((a) => a.totais[sel] > 0).sort((a, b) => b.totais[sel] - a.totais[sel]) }))
      .sort((a, b) => b.totais[sel] - a.totais[sel]),
  [linhas, sel])
  const tiposVis = useMemo(() =>
    (tipoFoco ? tipos.filter((t) => t.tipo === tipoFoco) : tipos), [tipos, tipoFoco])
  // Total do período exibido — base para os percentuais dos rótulos.
  const totalSel = useMemo(() => tiposVis.reduce((s, t) => s + t.totais[sel], 0), [tiposVis, sel])
  const pctDe = (v: number) => (totalSel > 0 ? Math.round((v / totalSel) * 100) : 0)
  // No 1º nível, cada categoria exibe os maiores ~60% dos ativos; o restante
  // (a partir de 2 itens) é somado numa fatia "Outros". No drill-down mostra todos.
  const externos = useMemo(() => tiposVis.flatMap((t) => {
    const limite = Math.ceil(t.ativos.length * 0.6)
    const agregar = tipoFoco == null && t.ativos.length - limite >= 2
    const itens = agregar
      ? [
          ...t.ativos.slice(0, limite).map((a) => ({ label: a.ticker, valor: a.totais[sel] })),
          { label: 'Outros', valor: t.ativos.slice(limite).reduce((s, a) => s + a.totais[sel], 0) },
        ]
      : t.ativos.map((a) => ({ label: a.ticker, valor: a.totais[sel] }))
    return itens.map((it, i) => ({
      ...it, tipo: t.tipo, pct: totalSel > 0 ? Math.round((it.valor / totalSel) * 100) : 0,
      cor: escalaTom(COR_SUAVE[t.tipo], FATORES_TOM[i % FATORES_TOM.length]),
    }))
  }), [tiposVis, sel, tipoFoco, totalSel])

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
      : a.totais[sortResumo.key] - b.totais[sortResumo.key]
    return sortResumo.dir === 'asc' ? c : -c
  })
  const clickSortResumo = (k: 'nome' | number) =>
    setSortResumo((s) => (s.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: k === 'nome' ? 'asc' : 'desc' }))
  const setaR = (k: 'nome' | number) =>
    sortResumo.key === k ? (sortResumo.dir === 'asc' ? ' ▲' : ' ▼') : ''
  // Cabeçalho clicável. A coluna do período selecionado aparece também no
  // mobile; as demais só em telas ≥ sm (como antes).
  const ThR = ({ k, label, cls }: { k: 'nome' | number; label: string; cls?: string }) => (
    <th onClick={() => clickSortResumo(k)}
      className={`px-3 py-2.5 font-medium cursor-pointer select-none hover:text-white ${cls ?? ''}`}>
      {label}{setaR(k)}
    </th>
  )

  return (
    <div className="rounded-xl border border-white/10 p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-[15px] font-semibold text-white">Ativos por categoria</h2>
        {/* trocar o período mantém o tipo focado (drill-down) */}
        <Segmented value={periodo} onChange={(v) => setPeriodo(v as PeriodoGraf)} opcoes={PERIODOS_GRAF} />
      </div>

      {/* Voltar do drill-down: abaixo do label, em linha própria */}
      {tipoFoco && (
        <button onClick={() => setTipoFoco(null)}
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
                  data: tiposVis.map((t) => t.totais[sel]),
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
              // Drill-down: clique numa categoria (ou num ativo dela) foca o tipo
              onClick: (_evt, els) => {
                if (tipoFoco || !els.length) return
                const el = els[0]
                const t = el.datasetIndex === 1 ? tiposVis[el.index]?.tipo : externos[el.index]?.tipo
                if (t) setTipoFoco(t)
              },
              onHover: (_evt, els, chart) => {
                chart.canvas.style.cursor = els.length && !tipoFoco ? 'pointer' : 'default'
              },
              plugins: {
                // dados lidos pelo nosso plugin pluginRotulos (atualizam no drill-down)
                rotulosDividendos: {
                  externos,
                  tiposVis: tiposVis.map((t) => ({ tipo: t.tipo, pct: pctDe(t.totais[sel]) })),
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
                        : pctDe(tiposVis[ctx.dataIndex].totais[sel])
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
              <ThR k="nome" label="Categoria" cls="text-left" />
              {COLS_GRAF.map((c, i) => (
                <ThR key={i} k={i} label={c}
                  cls={`text-right ${i === sel ? 'table-cell' : 'hidden sm:table-cell'}`} />
              ))}
              <th className="px-2 py-2.5 w-6"></th>
            </tr>
          </thead>
          {linhasOrd.map((l) => {
            const aberto = abertos.has(l.tipo)
            // Detalhamento e % usam a coluna ordenada (ou o período, se for por nome)
            const colAtivo = typeof sortResumo.key === 'number' ? sortResumo.key : sel
            return (
              <tbody key={l.tipo}>
                <tr onClick={() => toggleAberto(l.tipo)}
                  className="border-t border-white/10 cursor-pointer select-none hover:bg-white/[0.03]">
                  <td className="px-3 py-3 font-semibold text-[14px]" style={{ color: COR_SUAVE[l.tipo] }}>
                    {TIPO_ATIVO_LABEL[l.tipo]}
                  </td>
                  {l.totais.map((v, i) => (
                    <td key={i}
                      className={`px-3 py-3 text-right font-semibold text-white ${i === sel ? 'table-cell' : 'hidden sm:table-cell'}`}>
                      {formatBRL(v)}
                    </td>
                  ))}
                  <td className="px-2 py-3 text-right">
                    {aberto ? <ChevronDown size={15} style={{ color: MUTED }} /> : <ChevronRight size={15} style={{ color: MUTED }} />}
                  </td>
                </tr>
                {aberto && [...l.ativos]
                  .sort((a, b) => b.totais[colAtivo] - a.totais[colAtivo])
                  .map((a) => (
                    <tr key={a.ticker} className="border-t border-white/5">
                      <td className="px-3 py-1.5">
                        <span className="text-[13px] font-medium text-white">{a.ticker}</span>
                        <span className="text-[11px] ml-2" style={{ color: MUTED }}>
                          {l.totais[colAtivo] > 0 ? Math.round((a.totais[colAtivo] / l.totais[colAtivo]) * 100) : 0}% da categoria
                        </span>
                      </td>
                      {a.totais.map((v, i) => (
                        <td key={i}
                          className={`px-3 py-1.5 text-[12px] text-right ${i === sel ? 'table-cell' : 'hidden sm:table-cell'}`}
                          style={{ color: v > 0 ? 'rgba(255,255,255,.8)' : MUTED }}>
                          {formatBRL(v)}
                        </td>
                      ))}
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
        <SelectDark value={filtroTipoAtivo} onChange={(e) => mudarTipoAtivo(e.target.value as '' | TipoAtivoInvestimento)} className="!py-1.5 !text-[13px] min-w-[130px]">
          <option value="">Todos os tipos</option>
          {tiposAtivo.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
        </SelectDark>
        <SelectDark value={filtroTicker} onChange={(e) => setFiltroTicker(e.target.value)} className="!py-1.5 !text-[13px] min-w-[130px]">
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
        {semTipos && <p className="text-[12px] mt-1" style={{ color: '#ffb74d' }}>Nenhum tipo configurado. Use "Configurar tipos".</p>}
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

// ── Drawer: configurar tipos de dividendo (mapa → categoria) ────

function DrawerConfigTipos({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const { tipos, criar: criarTipo } = useTiposDividendo()
  const [novoNome, setNovoNome] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function adicionarTipo() {
    const nome = novoNome.trim()
    if (!nome) return
    setSalvando(true)
    const res = await criarTipo({ nome })
    setSalvando(false)
    if (res.ok) { setNovoNome(''); onToast('Tipo adicionado.') }
    else onToast(res.erro ?? 'Erro ao adicionar tipo')
  }

  return (
    <Drawer open onClose={onClose} titulo="Tipos de dividendo" subtitulo="Cada tipo é lançado na sua categoria do extrato">
      <div className="space-y-3">
        {tipos.map((t) => <MapRow key={t.id} tipo={t} onToast={onToast} />)}
      </div>

      {/* Adicionar novo tipo */}
      <div className="rounded-lg border border-dashed border-white/15 p-3 mt-2">
        <Field label="Novo tipo de dividendo">
          <div className="flex gap-2">
            <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Bonificação" maxLength={40}
              onKeyDown={(e) => { if (e.key === 'Enter') adicionarTipo() }} />
            <button onClick={adicionarTipo} disabled={salvando || !novoNome.trim()}
              className="px-3 rounded-lg text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>
              <Plus size={15} />
            </button>
          </div>
        </Field>
      </div>
    </Drawer>
  )
}

// Linha de mapeamento de um tipo → categoria, com as 2 opções:
// usar categoria existente OU criar nova (informando pai ou como pai).
function MapRow({ tipo, onToast }: { tipo: InvestimentoTipoDividendo; onToast: (m: string) => void }) {
  const { editar, excluir } = useTiposDividendo()
  const { categorias, criar: criarCategoria } = useCategorias()

  const [modo, setModo] = useState<'existente' | 'nova'>('existente')
  const [catId, setCatId] = useState(tipo.categoria_id ?? '')
  const [novaDesc, setNovaDesc] = useState('')
  const [novoPai, setNovoPai] = useState('')   // '' = será categoria-pai
  const [salvando, setSalvando] = useState(false)

  const catsOpcoes = categorias.map((c) => ({
    id: c.id, label: c.descricao,
    sublabel: c.id_pai ? categorias.find((p) => p.id === c.id_pai)?.descricao : undefined,
    idPai: c.id_pai ?? undefined,
  }))
  const paiOpcoes = categorias.filter((c) => !c.id_pai)
  const catAtual = categorias.find((c) => c.id === tipo.categoria_id)

  async function salvar() {
    setSalvando(true)
    let categoriaId = catId
    if (modo === 'nova') {
      const desc = novaDesc.trim()
      if (!desc) { onToast('Informe a descrição da nova categoria'); setSalvando(false); return }
      const resCat = await criarCategoria({ descricao: desc, id_pai: novoPai || null })
      if (!resCat.ok || !resCat.dados) { onToast(resCat.erro ?? 'Erro ao criar categoria'); setSalvando(false); return }
      categoriaId = resCat.dados.id
    }
    if (!categoriaId) { onToast('Selecione ou crie uma categoria'); setSalvando(false); return }
    const res = await editar(tipo.id, { categoria_id: categoriaId })
    setSalvando(false)
    if (res.ok) { onToast(`"${tipo.nome}" mapeado.`); setModo('existente'); setNovaDesc('') }
    else onToast(res.erro ?? 'Erro ao mapear')
  }

  async function remover() {
    const res = await excluir(tipo.id)
    onToast(res.ok ? 'Tipo removido.' : (res.erro ?? 'Erro ao remover'))
  }

  return (
    <div className="rounded-lg border border-white/10 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <p className="text-white font-medium text-[14px]">{tipo.nome}</p>
          <p className="text-[12px]" style={{ color: catAtual ? '#00c896' : '#ffb74d' }}>
            {catAtual ? `→ ${catAtual.descricao}` : 'sem categoria mapeada'}
          </p>
        </div>
        <button onClick={remover} title="Remover tipo"
          className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-red-400/40" style={{ color: '#ff5c7a' }}>
          <Trash2 size={13} />
        </button>
      </div>

      <Segmented value={modo} onChange={(v) => setModo(v as 'existente' | 'nova')}
        opcoes={[{ value: 'existente', label: 'Usar existente' }, { value: 'nova', label: 'Criar nova' }]} />

      <div className="mt-2 space-y-2">
        {modo === 'existente' ? (
          <SearchableSelect value={catId} onChange={setCatId} placeholder="Buscar categoria..." opcoes={catsOpcoes} />
        ) : (
          <>
            <Input value={novaDesc} onChange={(e) => setNovaDesc(e.target.value)} placeholder="Nome da categoria (até 20)" maxLength={20} />
            <SelectDark value={novoPai} onChange={(e) => setNovoPai(e.target.value)}>
              <option value="">Será categoria-pai (sem pai)</option>
              {paiOpcoes.map((p) => <option key={p.id} value={p.id}>Sob: {p.descricao}</option>)}
            </SelectDark>
          </>
        )}
        <button onClick={salvar} disabled={salvando}
          className="w-full py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>
          {salvando ? 'Salvando...' : 'Salvar mapeamento'}
        </button>
      </div>
    </div>
  )
}

// ── Drawer: associar proventos já lançados no extrato ───────────
// Caso de uso: o usuário já registrava dividendos/aluguéis como receitas
// no extrato antes de existir o módulo de investimentos. Aqui vinculamos
// esses lançamentos a um ativo (cria inv_dividendos apontando para a
// transação existente, SEM criar lançamento novo → sem duplicar).
interface LinhaAssoc {
  transacao_id: string
  data: string
  descricao: string
  valor: number
  ativo_id: string
  tipo_dividendo_id: string
  importar: boolean
}
interface TxAssoc {
  id: string; data: string; descricao?: string; valor: number; tipo: string
  categoria_id?: string; categoria_nome?: string
}

function DrawerAssociar({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const { ativos } = useInvestimentosAtivos()
  const { tipos }  = useTiposDividendo()
  const { categorias } = useCategorias()
  const { dividendos, associar, invalidar } = useDividendos()

  const [categoriaId, setCategoriaId] = useState('')
  const [de,  setDe]  = useState(mesMenos(mesAtual(), 11))
  const [ate, setAte] = useState(mesAtual())
  const [etapa, setEtapa] = useState<'config' | 'revisando'>('config')
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [linhas, setLinhas] = useState<LinhaAssoc[]>([])

  // Só categorias já associadas a um tipo de provento (Configurar tipos):
  // é o mapeamento que define em qual tipo o provento será gravado.
  const catsMapeadas = new Set(tipos.map((t) => t.categoria_id).filter(Boolean))
  const catsOpcoes = categorias.filter((c) => catsMapeadas.has(c.id)).map((c) => ({
    id: c.id, label: c.descricao,
    sublabel: c.id_pai ? categorias.find((p) => p.id === c.id_pai)?.descricao : undefined,
  }))
  // Tickers do mais longo p/ o mais curto, evitando casar um prefixo curto
  const tickersOrd = [...ativos].sort((a, b) => b.ticker.length - a.ticker.length)
  // Raiz (letras) → ativos: casa variantes como "MXRF13" (recibo de
  // subscrição que depois vira 11) e "ALUGUEL MXRF" (sem o sufixo
  // numérico) com MXRF11 — só quando a raiz aponta para UM único ativo.
  const porRaiz = new Map<string, string[]>()
  for (const a of ativos) {
    const raiz = a.ticker.toUpperCase().replace(/\d+[A-Z]?$/, '')
    if (raiz.length < 4) continue
    porRaiz.set(raiz, [...(porRaiz.get(raiz) ?? []), a.id])
  }
  const detectarAtivo = (desc: string): string => {
    const d = desc.toUpperCase()
    const exato = tickersOrd.find((a) => d.includes(a.ticker.toUpperCase()))
    if (exato) return exato.id
    for (const token of d.split(/[^A-Z0-9]+/)) {
      const m = token.match(/^([A-Z]{4,})(\d{0,4}[A-Z]?)$/)
      if (!m) continue
      const ids = porRaiz.get(m[1])
      if (ids?.length === 1) return ids[0]
    }
    return ''
  }
  const tipoPorCategoria = (catId: string): string => tipos.find((t) => t.categoria_id === catId)?.id ?? ''
  // Sugere o tipo: primeiro pelo mapeamento tipo ↔ categoria escolhida;
  // fallback pelo tipo do ativo (FII → Aluguel de FII; demais → Dividendos)
  const sugerirTipo = (ativoId: string): string => {
    const porCategoria = tipoPorCategoria(categoriaId)
    if (porCategoria) return porCategoria
    const at = ativos.find((a) => a.id === ativoId)
    const ehFii = at?.tipo_ativo === 'FII'
    return tipos.find((x) => (ehFii ? /aluguel|fii/i : /dividend/i).test(x.nome))?.id ?? ''
  }
  const setLinha = (idx: number, patch: Partial<LinhaAssoc>) =>
    setLinhas((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  // Ordenação clicando no cabeçalho (mantém o índice original p/ edição)
  type CampoOrd = 'sel' | 'data' | 'descricao' | 'valor' | 'ativo' | 'tipo'
  const [ordCampo, setOrdCampo] = useState<CampoOrd>('data')
  const [ordDir, setOrdDir] = useState<1 | -1>(-1)
  const ordenarPor = (campo: CampoOrd) => {
    if (campo === ordCampo) setOrdDir((d) => (d === 1 ? -1 : 1))
    else { setOrdCampo(campo); setOrdDir(campo === 'data' || campo === 'valor' ? -1 : 1) }
  }
  const tickerDe   = (id: string) => ativos.find((a) => a.id === id)?.ticker ?? ''
  const nomeTipoDe = (id: string) => tipos.find((t) => t.id === id)?.nome ?? ''
  const valorOrd = (l: LinhaAssoc): string | number | boolean => {
    switch (ordCampo) {
      case 'sel':       return l.importar
      case 'valor':     return l.valor
      case 'descricao': return l.descricao
      case 'ativo':     return tickerDe(l.ativo_id)
      case 'tipo':      return nomeTipoDe(l.tipo_dividendo_id)
      default:          return l.data
    }
  }
  const linhasOrd = linhas.map((l, idx) => ({ l, idx })).sort((a, b) => {
    const va = valorOrd(a.l), vb = valorOrd(b.l)
    let cmp: number
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
    else if (typeof va === 'boolean' && typeof vb === 'boolean') cmp = Number(va) - Number(vb)
    else cmp = String(va).localeCompare(String(vb), 'pt-BR')
    return cmp * ordDir
  })
  const ThOrd = ({ campo, className, children }: { campo: CampoOrd; className?: string; children: ReactNode }) => (
    <th className={`px-2 py-2 cursor-pointer select-none hover:text-white ${className ?? ''}`}
      onClick={() => ordenarPor(campo)} title="Ordenar">
      {children}{ordCampo === campo ? (ordDir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )

  async function buscar() {
    if (!categoriaId) { onToast('Selecione a categoria onde os proventos foram lançados'); return }
    setCarregando(true); setProgresso(0)
    try {
      const meses = gerarMeses(de, ate)
      let concluidos = 0
      const resArr = await Promise.all(meses.map(async (mm) => {
        const r = await apiFetch(`/transacoes?mes=${mm}&per_page=1000`)
        concluidos++
        setProgresso(Math.round((concluidos / meses.length) * 100))
        return r
      }))
      const txs = resArr.flatMap((r) => extrairLista<TxAssoc>(r.dados))
      const linkados = new Set(dividendos.map((d) => d.transacao_extrato_id).filter(Boolean) as string[])
      const catDesc = (categorias.find((c) => c.id === categoriaId)?.descricao ?? '').toLowerCase()
      const vistos = new Set<string>()
      const ls: LinhaAssoc[] = []
      for (const t of txs) {
        if (!t.id || vistos.has(t.id) || t.tipo !== 'RECEITA') continue
        const casa = t.categoria_id === categoriaId ||
          (!!catDesc && (t.categoria_nome ?? '').toLowerCase() === catDesc)
        if (!casa || linkados.has(t.id) || !(Number(t.valor) > 0)) continue
        vistos.add(t.id)
        const ativoId = detectarAtivo(String(t.descricao ?? ''))
        ls.push({
          transacao_id: t.id, data: t.data, descricao: String(t.descricao ?? ''),
          valor: Number(t.valor), ativo_id: ativoId,
          tipo_dividendo_id: ativoId ? sugerirTipo(ativoId) : '', importar: !!ativoId,
        })
      }
      ls.sort((a, b) => (a.data < b.data ? 1 : -1))
      setLinhas(ls)
      setEtapa('revisando')
      if (ls.length === 0) onToast('Nenhuma receita não associada encontrada nesse período/categoria.')
    } catch (e) {
      onToast(`Erro ao buscar: ${(e as Error).message}`)
    } finally { setCarregando(false) }
  }

  async function confirmar() {
    const sel = linhas.filter((l) => l.importar && l.ativo_id)
    if (sel.length === 0) { onToast('Defina o ativo e marque ao menos uma linha.'); return }
    setSalvando(true); setProgresso(0)
    let ok = 0, erros = 0
    for (let i = 0; i < sel.length; i++) {
      const l = sel[i]
      // skipInvalidar: evita refetch (gráfico/página de fundo) a cada item;
      // invalidamos uma única vez ao final do lote.
      const res = await associar({
        transacao_extrato_id: l.transacao_id, ativo_id: l.ativo_id,
        tipo_dividendo_id: l.tipo_dividendo_id || null,
      }, { skipInvalidar: true })
      if (res.ok) ok++; else erros++
      setProgresso(Math.round(((i + 1) / sel.length) * 100))
    }
    if (ok > 0) await invalidar()
    setSalvando(false)
    onToast(`${ok} provento(s) associado(s)${erros ? `, ${erros} com erro` : ''}.`)
    onClose()
  }

  const selCount = linhas.filter((l) => l.importar && l.ativo_id).length

  return (
    <Drawer open onClose={onClose} largura="larga" titulo="Associar proventos do extrato"
      subtitulo="Vincula dividendos/aluguéis já lançados aos investimentos (sem duplicar)"
      rodape={etapa === 'revisando'
        ? <>
            <button onClick={() => setEtapa('config')}
              className="px-4 py-2.5 rounded-lg border border-white/10 text-[16px] font-semibold text-white/80 hover:border-white/25">
              Voltar
            </button>
            <BtnSalvar editando={false} onClick={confirmar} salvando={salvando} labelSalvar={`Associar ${selCount}`} />
          </>
        : <><BtnCancelar onClick={onClose} /><BtnSalvar editando={false} onClick={buscar} salvando={carregando} labelSalvar="Buscar" /></>}>
      {etapa === 'config' ? (
        <>
          <p className="text-[13px]" style={{ color: MUTED }}>
            Escolha a categoria onde você lança os proventos no extrato e o período. Listaremos as
            receitas ainda não associadas para você vincular a cada ativo — sem criar lançamentos novos.
          </p>
          <Field label="Categoria dos proventos">
            <SearchableSelect value={categoriaId} onChange={setCategoriaId} placeholder="Buscar categoria..." opcoes={catsOpcoes} />
          </Field>
          {catsOpcoes.length === 0 && (
            <p className="text-[12px]" style={{ color: '#ffb74d' }}>
              Nenhuma categoria associada a um tipo de provento. Abra "Configurar tipos" e mapeie
              cada tipo (Dividendos, JSCP, Aluguel de FII…) para a categoria usada no extrato.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="De"><Input type="month" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
            <Field label="Até"><Input type="month" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
          </div>
          {carregando && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[12px] mb-1" style={{ color: MUTED }}>
                <span>Buscando lançamentos…</span><span>{progresso}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${progresso}%`, background: '#00c896' }} />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[13px] mb-2" style={{ color: MUTED }}>
            {linhas.length} lançamento(s) encontrado(s). Confira o ativo detectado pela descrição e o tipo de provento.
          </p>
          <div className="overflow-auto rounded-lg border border-white/10 max-h-[50vh]">
            <table className="w-full text-[13px]">
              {/* fundo sólido (drawer #1a1f2e + leve clareada) — translúcido deixava
                  as linhas aparecerem através do cabeçalho fixo ao rolar */}
              <thead className="sticky top-0 z-10 bg-[#232938]">
                <tr className="text-left" style={{ color: MUTED }}>
                  <ThOrd campo="sel" className="w-8 text-center">✓</ThOrd>
                  <ThOrd campo="data">Data</ThOrd>
                  <ThOrd campo="descricao">Descrição</ThOrd>
                  <ThOrd campo="valor" className="text-right">Valor</ThOrd>
                  <ThOrd campo="ativo">Ativo</ThOrd>
                  <ThOrd campo="tipo">Tipo</ThOrd>
                </tr>
              </thead>
              <tbody>
                {linhasOrd.map(({ l, idx: i }) => (
                  <tr key={l.transacao_id} className="border-t border-white/5" style={{ opacity: l.importar ? 1 : 0.5 }}>
                    <td className="px-2 py-1 text-center">
                      <input type="checkbox" checked={l.importar} onChange={(e) => setLinha(i, { importar: e.target.checked })} className="accent-av-green" />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-white/80">{formatData(l.data)}</td>
                    <td className="px-2 py-1 text-white/70 max-w-[160px] truncate" title={l.descricao}>{l.descricao}</td>
                    <td className="px-2 py-1 text-right" style={{ color: '#00c896' }}>{formatBRL(l.valor)}</td>
                    <td className="px-1 py-1">
                      <SelectDark value={l.ativo_id} onChange={(e) => setLinha(i, { ativo_id: e.target.value, importar: !!e.target.value, tipo_dividendo_id: e.target.value ? sugerirTipo(e.target.value) : '' })} className="!py-1 !text-[12px] min-w-[88px]">
                        <option value="">— ativo —</option>
                        {ativos.map((a) => <option key={a.id} value={a.id}>{a.ticker}</option>)}
                      </SelectDark>
                    </td>
                    <td className="px-1 py-1">
                      <SelectDark value={l.tipo_dividendo_id} onChange={(e) => setLinha(i, { tipo_dividendo_id: e.target.value })} className="!py-1 !text-[12px] min-w-[130px]">
                        <option value="">—</option>
                        {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                      </SelectDark>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {linhas.some((l) => !l.ativo_id) && (
            <p className="text-[12px] mt-2" style={{ color: '#ffb74d' }}>Linhas sem ativo não serão associadas — selecione o ativo para incluí-las.</p>
          )}
          {salvando && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[12px] mb-1" style={{ color: MUTED }}>
                <span>Associando proventos…</span><span>{progresso}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${progresso}%`, background: '#00c896' }} />
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}
