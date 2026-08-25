import { Fragment, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  Sparkles, RefreshCw, Bot, AlertTriangle, Settings, ChevronDown, CheckCircle2,
  Trophy, Medal, ShieldCheck, TrendingUp, Coins, Scale, Star, CalendarClock,
  ArrowUp, ArrowDown, Minus, X, CircleStop, Clock, Info, type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useInvestimentosRanking } from '../hooks/useInvestimentosDashboard'
import { useInvestimentosHistorico } from '../hooks/useInvestimentosHistorico'
import QuadroSobreposicao from '../components/ui/QuadroSobreposicao'
import QuadroCorrelacao from '../components/ui/QuadroCorrelacao'
import { useInvAvaliacoes } from '../hooks/useInvAvaliacoes'
import { useInvQuestionarios } from '../hooks/useInvQuestionarios'
import { useInvPerfil } from '../hooks/useInvPerfil'
import { useInvPesos } from '../hooks/useInvPesos'
import { useIAPreferencia } from '../hooks/useIAPreferencia'
import { useMascotePreferido } from '../hooks/useMascotePreferido'
import { useInvAvaliacaoAgenda, FREQUENCIA_LABEL, DIAS_FREQUENCIA } from '../hooks/useInvAvaliacaoAgenda'
import { useAuth } from '../hooks/useAuth'
import { useLembretes } from '../hooks/useLembretes'
import { provedorPorId } from '../lib/iaProvedores'
import { SelectDark } from '../components/ui/shared'
import Mascote, { type MascoteNome } from '../components/ui/Mascote'
import LoadingMascote from '../components/ui/LoadingMascote'
import InvestimentosNav from '../components/ui/InvestimentosNav'
import TutorialTour from '../components/ui/TutorialTour'
import { TUTORIAL_INVESTIMENTOS_AVALIACOES } from '../lib/tutoriaisPaginas'
import { useRegistrarContextoIA } from '../context/ContextoIAContext'
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR, TIPOS_ATIVO_INV, CRITERIOS_QUESTAO, CRITERIO_LABEL } from '../lib/constants'
import type { InvAvaliacao, InvAvaliacaoMentor, InvestimentoAtivo, CriterioQuestao, TipoAtivoInvestimento, NivelConsenso, FrequenciaAgenda, PerguntaAvaliacao, PesosCriterio } from '../types'

type LinhaRank = { ativo: InvestimentoAtivo; final: number | null; medias: Record<CriterioQuestao, number | null> }
// Questionário efetivo reduzido (o necessário para salvar).
type EfQ = { perguntas: PerguntaAvaliacao[]; pesos: PesosCriterio }
// Detalhe de exibição por ativo (perguntas + médias por critério).
type DetAtivo = { perguntas: { id: string; texto: string; criterio: CriterioQuestao }[]; medias: Record<CriterioQuestao, number | null> }
// Item do log de execução de um mentor durante a rodada. Em caso de
// sucesso, guarda a nota dada e quantas perguntas foram respondidas
// (para validar que a IA de fato produziu algo).
interface LogEntry { ticker: string; ok: boolean; erro?: string; nota?: number | null; respostas?: number }
// Decisão pendente: mentores pausados por erros repetidos, com seu log.
interface DecisaoPendente { mentores: { configId: string; nome: string; log: LogEntry[]; erros: number }[] }
// Snapshot, gravado ao concluir uma avaliação, das IAs que participaram e do
// tempo que cada uma levou — exibido antes da listagem de ativos.
interface ResumoExecucao {
  geradoEm: string
  mentores: { configId: string; nome: string | null; provedor: string; modelo: string | null; tempoMs: number }[]
}

const MUTED = '#8b92a8'

// Mascotes usados para representar os mentores "secundários" (os demais que
// o ativo orquestra). O mentor ATIVO usa o mascote preferido do usuário.
const MASCOTES_POOL: MascoteNome[] = ['arquiteta', 'gato', 'raposa', 'sabio']

// Escolhe um mascote para o i-ésimo mentor secundário, evitando repetir o
// mascote do orquestrador (mentor ativo).
function mascoteSecundario(i: number, excluir: MascoteNome): MascoteNome {
  const pool = MASCOTES_POOL.filter((m) => m !== excluir)
  return pool[i % pool.length]
}

// Rótulos curtos dos critérios (cabeçalhos da lista ordenável).
const CRITERIO_ABBR: Record<CriterioQuestao, string> = {
  FUNDAMENTOS: 'Fundam.',
  CRESCIMENTO: 'Cresc.',
  DIVIDENDOS:  'Renda',
  VALUATION:   'Valuat.',
}

// Ícone próprio de cada critério (ranking, cabeçalhos).
const CRITERIO_ICON: Record<CriterioQuestao, LucideIcon> = {
  FUNDAMENTOS: ShieldCheck,
  CRESCIMENTO: TrendingUp,
  DIVIDENDOS:  Coins,
  VALUATION:   Scale,
}

// Cor por nível de consenso entre as IAs.
const COR_CONSENSO: Record<NivelConsenso, string> = {
  ALTO:  '#00c896',
  MEDIO: '#f0b429',
  BAIXO: '#ff5c7a',
}
const LABEL_CONSENSO: Record<NivelConsenso, string> = { ALTO: 'Alto', MEDIO: 'Médio', BAIXO: 'Baixo' }

// Nível de consenso do ativo: usa o salvo; se ausente (avaliação antiga),
// recalcula pela dispersão das notas dos mentores.
function nivelConsensoDe(av: InvAvaliacao): NivelConsenso {
  if (av.consenso.nivel_consenso) return av.consenso.nivel_consenso
  const notas = av.consenso.mentores.map((m) => m.nota).filter((v): v is number => v != null)
  if (notas.length < 2) return 'ALTO'
  const m = notas.reduce((s, v) => s + v, 0) / notas.length
  const dp = Math.sqrt(notas.reduce((s, v) => s + (v - m) ** 2, 0) / notas.length)
  return dp < 1 ? 'ALTO' : dp < 2 ? 'MEDIO' : 'BAIXO'
}

// Botão (logo abaixo do mentor) para validar se ele fará a busca nesta rodada.
function BotaoMentorAtivo({ ativo, desabilitado, onToggle }: { ativo: boolean; desabilitado?: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      disabled={desabilitado}
      title={ativo ? 'Este mentor fará a busca — clique para desativar' : 'Mentor desativado — clique para ativar'}
      className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border disabled:opacity-50"
      style={ativo
        ? { borderColor: 'rgba(0,200,150,0.4)', color: '#00c896', background: 'rgba(0,200,150,0.1)' }
        : { borderColor: 'rgba(255,255,255,0.15)', color: MUTED }}>
      {ativo ? <><CheckCircle2 size={11} /> Participa</> : <><X size={11} /> Desativado</>}
    </button>
  )
}

// Selo exibido abaixo do mentor quando ele JÁ concluiu sua parte da rodada
// (avaliou todos os ativos pedidos, sem ser abortado/parado).
function SeloParticipou() {
  return (
    <span
      title="Este mentor concluiu sua avaliação nesta rodada"
      className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
      style={{ borderColor: 'rgba(59,130,246,0.45)', color: '#3b82f6', background: 'rgba(59,130,246,0.12)' }}>
      <CheckCircle2 size={11} /> Participou
    </span>
  )
}

// Ícone (i) ao lado do mascote do mentor com o nome do modelo no hint.
function IconeModelo({ modelo }: { modelo: string }) {
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      title={`Modelo: ${modelo}`}
      className="absolute top-0 right-0 inline-flex items-center justify-center w-4 h-4 rounded-full border cursor-help"
      style={{ background: '#141929', borderColor: 'rgba(255,255,255,0.2)', color: '#8b5cf6' }}>
      <Info size={11} />
    </span>
  )
}

// Tempo de execução real do mentor (abaixo do botão).
function TempoExecucao({ ms }: { ms: number }) {
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-[10.5px]" style={{ color: MUTED }}
      title="Tempo que esta IA levou pesquisando (não conta reaproveitamento de cache)">
      <Clock size={10} /> {formatDuracao(ms)}
    </span>
  )
}

// Aviso de decisão quando uma ou mais IAs são pausadas por erros repetidos.
// Mostra o LOG COMPLETO de execução de cada IA (não só o último erro) e
// deixa o usuário ignorar a IA e concluir, ou esperar e tentar depois.
function AvisoDecisao({ decisao, processando, onRetomar, onIgnorar, onEsperar }: {
  decisao: DecisaoPendente
  processando: boolean
  onRetomar: () => void
  onIgnorar: () => void
  onEsperar: () => void
}) {
  const [abertoId, setAbertoId] = useState<string | null>(decisao.mentores[0]?.configId ?? null)
  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-start gap-2 mb-3">
        <AlertTriangle size={18} style={{ color: '#ffb74d' }} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-[14px] font-semibold text-white">IA(s) pausada(s) por erros repetidos</p>
          <p className="text-[12.5px]" style={{ color: MUTED }}>
            Retome agora pra tentar de novo na hora, ignore esta(s) IA(s) e conclua agora, ou
            esperar e tentar mais tarde (os ativos sem avaliação completa ficam pendentes).
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {decisao.mentores.map((m) => {
          const aberto = abertoId === m.configId
          return (
            <div key={m.configId} className="rounded-lg border border-white/10 bg-black/20">
              <button onClick={() => setAbertoId(aberto ? null : m.configId)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left">
                <span className="flex items-center gap-1.5 text-[13px] text-white">
                  <ChevronDown size={14} style={{ color: MUTED }} className={`transition-transform ${aberto ? '' : '-rotate-90'}`} />
                  {m.nome}
                </span>
                <span className="text-[12px]" style={{ color: '#ffb74d' }}>{m.erros} erro(s)</span>
              </button>
              {aberto && (
                <div className="max-h-52 overflow-y-auto px-3 pb-2 space-y-1 text-[12px] font-mono">
                  {m.log.map((e, i) => (
                    <div key={i} className="flex gap-2">
                      <span style={{ color: e.ok ? '#00c896' : '#ff5c7a' }}>{e.ok ? '✓' : '✕'}</span>
                      <span className="text-white/80 shrink-0">{e.ticker}</span>
                      {e.ok
                        ? <span style={{ color: MUTED }}>nota {e.nota ?? '—'} · {e.respostas ?? 0} respostas</span>
                        : e.erro && <span style={{ color: MUTED }}>{e.erro}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={onRetomar} disabled={processando}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#00a37a' }}>
          <RefreshCw size={14} /> Retomar agora
        </button>
        <button onClick={onIgnorar} disabled={processando}
          className="px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#8b5cf6' }}>
          Ignorar esta(s) IA(s) e concluir
        </button>
        <button onClick={onEsperar} disabled={processando}
          className="px-3 py-2 rounded-lg text-[13px] font-medium border border-white/15 text-white/90 hover:border-white/30 disabled:opacity-50">
          Esperar e tentar depois
        </button>
        {processando && <span className="text-[12px] self-center" style={{ color: MUTED }}>Concluindo…</span>}
      </div>
    </div>
  )
}

// Tendência da nota entre a avaliação anterior e a atual (do histórico).
function tendenciaDe(av: InvAvaliacao): { dir: 'subiu' | 'desceu' | 'manteve'; delta: number; anterior: number } | null {
  const h = av.historico
  if (!h || h.length < 2) return null
  const atual = h[h.length - 1]?.nota_final
  const anterior = h[h.length - 2]?.nota_final
  if (atual == null || anterior == null) return null
  const delta = Math.round((atual - anterior) * 10) / 10
  const dir = Math.abs(delta) < 0.05 ? 'manteve' : delta > 0 ? 'subiu' : 'desceu'
  return { dir, delta, anterior }
}

// Indicador visual de subiu/desceu/manteve a nota desde a última avaliação.
function Tendencia({ av }: { av: InvAvaliacao }) {
  const t = tendenciaDe(av)
  if (!t) return null
  const cor = t.dir === 'subiu' ? '#00c896' : t.dir === 'desceu' ? '#ff5c7a' : MUTED
  const Icon = t.dir === 'subiu' ? ArrowUp : t.dir === 'desceu' ? ArrowDown : Minus
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px]" style={{ color: cor }}
      title={`Anterior: ${t.anterior} → atual (${t.dir})`}>
      <Icon size={12} />{t.dir !== 'manteve' && (t.delta > 0 ? `+${t.delta.toFixed(1)}` : t.delta.toFixed(1))}
    </span>
  )
}

// Ícone de posição no ranking: troféu (1º) e medalhas (2º/3º).
function IconePosicao({ pos }: { pos: number }) {
  if (pos === 0) return <Trophy size={14} style={{ color: '#f0b429' }} />
  if (pos === 1) return <Medal size={14} style={{ color: '#c0c4cc' }} />
  if (pos === 2) return <Medal size={14} style={{ color: '#cd7f32' }} />
  return <span className="text-[11px] w-[14px] text-center inline-block" style={{ color: MUTED }}>{pos + 1}</span>
}

// Card de ranking compacto (melhores ou piores de um tipo): lista ticker + nota.
function MiniRankAtivos({ titulo, Icon, cor, itens, medalhas = true }: {
  titulo: string
  Icon: LucideIcon
  cor: string
  itens: { ticker: string; nota: number }[]
  /** Mostra troféu/medalha (melhores) ou só a posição numérica (piores). */
  medalhas?: boolean
}) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={15} style={{ color: cor }} />
        <h4 className="text-[12px] font-semibold text-white leading-tight">{titulo}</h4>
      </div>
      <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {itens.map((d, i) => (
          <li key={d.ticker} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="flex items-center gap-1.5 min-w-0">
              {medalhas
                ? <IconePosicao pos={i} />
                : <span className="text-[11px] w-[14px] text-center inline-block" style={{ color: MUTED }}>{i + 1}</span>}
              <span className="text-white/90 truncate">{d.ticker}</span>
            </span>
            <span className="font-semibold shrink-0" style={{ color: corNota(d.nota) }}>{d.nota.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Ranking do topo: top 5 ativos por critério + nota final ──────
function RankingTopo({ dados }: { dados: LinhaRank[] }) {
  const colunas: { key: CriterioQuestao | 'final'; label: string; Icon: LucideIcon }[] = [
    { key: 'final', label: 'Nota final', Icon: Star },
    ...CRITERIOS_QUESTAO.map((cr) => ({ key: cr, label: CRITERIO_LABEL[cr], Icon: CRITERIO_ICON[cr] })),
  ]
  const valor = (d: LinhaRank, key: CriterioQuestao | 'final') => key === 'final' ? d.final : d.medias[key]

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
      <h2 className="text-[13px] font-semibold text-white mb-3 flex items-center gap-1.5">
        <Trophy size={15} style={{ color: '#f0b429' }} /> Ranking dos ativos
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {colunas.map((col) => {
          const Icon = col.Icon
          const top = [...dados]
            .filter((d) => valor(d, col.key) != null)
            .sort((a, b) => (valor(b, col.key)! - valor(a, col.key)!))
            .slice(0, 5)
          return (
            <div key={col.key} className="rounded-lg border border-white/10 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Icon size={15} style={{ color: '#8b5cf6' }} />
                <h3 className="text-[12px] font-semibold text-white leading-tight">{col.label}</h3>
              </div>
              {top.length === 0 ? (
                <p className="text-[12px]" style={{ color: MUTED }}>—</p>
              ) : (
                <ol className="space-y-1">
                  {top.map((d, i) => (
                    <li key={d.ativo.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <IconePosicao pos={i} />
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[d.ativo.tipo_ativo] }} />
                        <span className="text-white/90 truncate">{d.ativo.ticker}</span>
                      </span>
                      <span className="font-semibold shrink-0" style={{ color: corNota(valor(d, col.key)) }}>
                        {valor(d, col.key)!.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// Resumo de qualidade de uma carteira (grupo de um tipo de ativo).
function resumoQualidade(
  lista: InvestimentoAtivo[],
  avalPorAtivo: Map<string, InvAvaliacao>,
  detalhePorAtivo: Map<string, { medias: Record<CriterioQuestao, number | null> }>,
): { label: string; cor: string; texto: string } | null {
  const comNota = lista
    .map((a) => ({ a, nota: avalPorAtivo.get(a.id)?.nota_final ?? null }))
    .filter((x): x is { a: InvestimentoAtivo; nota: number } => x.nota != null)
  if (comNota.length === 0) return null

  const media = comNota.reduce((s, x) => s + x.nota, 0) / comNota.length
  const label = media >= 8 ? 'Excelente' : media >= 7 ? 'Boa' : media >= 5 ? 'Regular' : 'Fraca'
  const cor = media >= 7 ? '#00c896' : media >= 5 ? '#f0b429' : '#ff5c7a'
  const best = comNota.reduce((p, c) => (c.nota > p.nota ? c : p))
  const worst = comNota.reduce((p, c) => (c.nota < p.nota ? c : p))

  let pior: CriterioQuestao | null = null
  let piorVal = Infinity
  for (const cr of CRITERIOS_QUESTAO) {
    const vs = lista.map((a) => detalhePorAtivo.get(a.id)?.medias[cr]).filter((v): v is number => typeof v === 'number')
    if (!vs.length) continue
    const mv = vs.reduce((s, v) => s + v, 0) / vs.length
    if (mv < piorVal) { piorVal = mv; pior = cr }
  }

  const partes = [`Qualidade ${label} — nota média ${media.toFixed(1)} em ${comNota.length} ativo${comNota.length === 1 ? '' : 's'}.`]
  partes.push(`Destaque: ${best.a.ticker} (${best.nota}).`)
  if (worst.a.id !== best.a.id) partes.push(`Atenção: ${worst.a.ticker} (${worst.nota}).`)
  if (pior) partes.push(`Critério mais frágil: ${CRITERIO_LABEL[pior]} (${piorVal.toFixed(1)}).`)
  return { label, cor, texto: partes.join(' ') }
}

// Média (0..10) de cada critério para um ativo: média das notas por pergunta
// (consenso) dentro de cada critério.
function mediasPorCriterio(
  av: InvAvaliacao,
  perguntas: { id: string; criterio: CriterioQuestao }[],
): Record<CriterioQuestao, number | null> {
  const notaPorId = new Map(av.consenso.perguntas.map((p) => [p.id, p.media_nota]))
  const out = {} as Record<CriterioQuestao, number | null>
  for (const cr of CRITERIOS_QUESTAO) {
    const vals = perguntas
      .filter((p) => p.criterio === cr)
      .map((p) => notaPorId.get(p.id))
      .filter((v): v is number => typeof v === 'number')
    out[cr] = vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null
  }
  return out
}

function corNota(n: number | null): string {
  if (n == null) return MUTED
  return n >= 7 ? '#00c896' : n < 5 ? '#ff5c7a' : '#f0b429'
}

// Rótulo de exibição do mentor: apelido informado ou o provedor.
function rotuloMentor(nome: string | null, provedor: string): string {
  if (nome && nome.trim()) return nome.trim()
  return provedorPorId(provedor)?.label ?? provedor
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Formata uma duração (ms) de execução de um mentor: "45s" ou "1m 05s".
function formatDuracao(ms: number): string {
  const seg = Math.max(0, Math.round(ms / 1000))
  if (seg < 60) return `${seg}s`
  const m = Math.floor(seg / 60)
  const s = seg % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

// Modal com o log individual de execução de um mentor (clicável na lista).
function ModalLogMentor({ nome, log, onClose }: { nome: string; log: LogEntry[]; onClose: () => void }) {
  const erros = log.filter((e) => !e.ok).length

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/60 z-[200]" onClick={onClose} />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed z-[201] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[min(560px,calc(100vw-32px))] rounded-2xl border border-white/10 flex flex-col"
        style={{ background: '#1a1f2e' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <Bot size={15} style={{ color: '#8b5cf6' }} />
            <span className="text-[18px] font-semibold truncate" style={{ color: '#e8eaf0' }}>
              Log · {nome}
            </span>
            {erros > 0 && <span className="text-[13px]" style={{ color: '#ffb74d' }}>{erros} erro(s)</span>}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center
              transition-all hover:border-white/30"
            style={{ color: '#8b92a8' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {log.length === 0 ? (
            <p className="text-[15px]" style={{ color: MUTED }}>Sem execução registrada nesta rodada.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-1.5 text-[13.5px] font-mono">
              {log.map((e, i) => (
                <div key={i} className="flex gap-2">
                  <span style={{ color: e.ok ? '#00c896' : '#ff5c7a' }}>{e.ok ? '✓' : '✕'}</span>
                  <span className="text-white/85 shrink-0">{e.ticker}</span>
                  {e.ok
                    ? <span style={{ color: MUTED }}>nota {e.nota ?? '—'} · {e.respostas ?? 0} respostas</span>
                    : e.erro && <span style={{ color: MUTED }}>{e.erro}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// Progresso de um mentor durante a avaliação (1 barra por mentor).
interface ProgMentor {
  configId: string; nome: string; feito: number; total: number; erros: number
  abortado?: boolean
  /** Pausado pelo usuário (só este mentor) — pode ser retomado. */
  pausado?: boolean
  /** Segundos restantes até a próxima tentativa automática (backoff). */
  aguardandoSeg?: number
}

// Botão (abaixo do mentor) para PAUSAR só aquele mentor durante a rodada.
function BotaoPararMentor({ onParar }: { onParar: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onParar() }}
      title="Parar este mentor (pode continuar depois — não afeta os demais)"
      className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
      style={{ borderColor: 'rgba(255,92,122,0.4)', color: '#ff5c7a', background: 'rgba(255,92,122,0.1)' }}>
      <CircleStop size={11} /> Parar
    </button>
  )
}

// Botão (abaixo do mentor) para CONTINUAR um mentor pausado.
function BotaoContinuarMentor({ onContinuar }: { onContinuar: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onContinuar() }}
      title="Continuar este mentor de onde parou"
      className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
      style={{ borderColor: 'rgba(0,200,150,0.4)', color: '#00c896', background: 'rgba(0,200,150,0.1)' }}>
      <Sparkles size={11} /> Continuar
    </button>
  )
}

// Botão (fora da rodada) p/ um mentor que avaliou SÓ PARTE dos pendentes — ao
// continuar, fará apenas os ativos que ainda faltam para ele.
function BotaoContinuarPendente({ faltam, desabilitado, onContinuar }: { faltam: number; desabilitado?: boolean; onContinuar: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onContinuar() }}
      disabled={desabilitado}
      title={`Faltam ${faltam} ativo(s) para este mentor — continuar faz só os que faltam`}
      className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border disabled:opacity-50"
      style={{ borderColor: 'rgba(240,180,41,0.45)', color: '#f0b429', background: 'rgba(240,180,41,0.12)' }}>
      <Sparkles size={11} /> Continuar ({faltam} restante{faltam === 1 ? '' : 's'})
    </button>
  )
}

// Barra de progresso de um mentor — exibida logo abaixo do mascote dele.
function BarraMentor({ prog }: { prog?: ProgMentor }) {
  if (!prog) return null
  const pct = prog.total > 0 ? Math.round((prog.feito / prog.total) * 100) : 0
  const completo = prog.feito >= prog.total
  const aguardando = prog.aguardandoSeg != null && prog.aguardandoSeg > 0
  const cor = prog.abortado ? '#ff5c7a' : prog.pausado ? '#ffb74d' : aguardando ? '#ffb74d' : completo ? '#00c896' : '#8b5cf6'
  const corTexto = prog.abortado ? '#ff5c7a' : (prog.pausado || aguardando) ? '#ffb74d' : MUTED
  return (
    <div className="w-full mt-1.5">
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full transition-all ${aguardando || prog.pausado ? 'animate-pulse' : ''}`} style={{ width: `${pct}%`, background: cor }} />
      </div>
      <div className="text-[10.5px] mt-0.5 text-center" style={{ color: corTexto }}>
        {prog.pausado ? `Pausado (${prog.feito}/${prog.total})`
          : aguardando ? `Nova tentativa em ${prog.aguardandoSeg}s`
          : prog.abortado ? 'Cancelado'
          : `${prog.feito}/${prog.total}`}
        {!aguardando && !prog.pausado && prog.erros > 0 && <span style={{ color: '#ffb74d' }}> · {prog.erros} erro(s)</span>}
      </div>
    </div>
  )
}

export default function AvaliacoesInvestimentosPage() {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const { configs, ativa, carregando: carregandoIA } = useIAPreferencia()
  const { mascote } = useMascotePreferido()
  const { ativos, loading: loadingAtivos } = useInvestimentosAtivos()
  const { ranking, loading: loadingRanking } = useInvestimentosRanking()
  const { avaliacoes, loading: loadingAval, avaliarMentorAtivo, salvarAvaliacao, concluir } = useInvAvaliacoes()
  const { questionarioEfetivo } = useInvQuestionarios()
  const { perfil } = useInvPerfil()
  const { pesos: pesosGlobais } = useInvPesos()
  const { frequencia, salvar: salvarAgenda } = useInvAvaliacaoAgenda()
  // Todos os lembretes — o agendamento vira um lembrete (aparece no calendário).
  const { lembretes: todosLembretes, criar: criarLembrete, editar: editarLembrete, excluir: excluirLembrete } = useLembretes({})
  // Histórico mensal — base da correlação entre ativos.
  const { historico } = useInvestimentosHistorico({})

  const [rodando, setRodando] = useState(false)
  const [progMentores, setProgMentores] = useState<ProgMentor[] | null>(null)
  const [salvandoFase, setSalvandoFase] = useState(false)
  // Resumo exibido ao final de uma rodada (avaliados nesta rodada × restantes).
  const [resumo, setResumo] = useState<{ avaliados: number; faltam: number; erros: number } | null>(null)
  // Decisão pendente quando uma IA é pausada por erros repetidos.
  const [pendenteDecisao, setPendenteDecisao] = useState<DecisaoPendente | null>(null)
  // Log de execução por mentor (config_id → entradas) — clicável para ver.
  const [logsMentor, setLogsMentor] = useState<Record<string, LogEntry[]>>({})
  const [logAberto, setLogAberto] = useState<string | null>(null)
  // Mentores desativados para a rodada (não fazem a busca). Default: todos ativos.
  const [mentoresDesativados, setMentoresDesativados] = useState<Set<string>>(new Set())
  const toggleMentorAtivo = (id: string) => setMentoresDesativados((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  // Mentores PAUSADOS pelo usuário no meio da rodada (só eles). Ref (não
  // estado) p/ os loops assíncronos lerem o valor mais recente. Pausar não
  // encerra o mentor: o loop dele aguarda até ser retomado (ou o usuário sair).
  const pausadosRef = useRef<Set<string>>(new Set())
  const pausarMentor = (configId: string) => {
    pausadosRef.current.add(configId)
    setProgMentores((prev) => prev?.map((p) =>
      p.configId === configId ? { ...p, pausado: true, aguardandoSeg: undefined } : p) ?? prev)
  }
  const retomarMentor = (configId: string) => {
    pausadosRef.current.delete(configId)
    setProgMentores((prev) => prev?.map((p) =>
      p.configId === configId ? { ...p, pausado: false } : p) ?? prev)
  }
  // Lista a retomar automaticamente assim que a decisão pendente terminar de
  // ser finalizada. Não dá pra chamar avaliar() direto no clique de "Retomar
  // agora": a função lê `rodando`/`pendenteDecisao` do closure do render ATUAL
  // (ainda com o painel aberto), e `finalizarDecisao` só atualiza esses
  // estados de forma assíncrona — chamar avaliar() em seguida, na mesma
  // função, ainda veria pendenteDecisao != null e abortaria. Guardando a
  // lista numa ref e dependendo do useEffect abaixo, avaliar() só roda no
  // PRÓXIMO render, quando os estados já refletem o painel fechado.
  const retomarListaRef = useRef<InvestimentoAtivo[] | null>(null)
  // Guarda de montagem — encerra loops/esperas de mentores pausados se o
  // usuário sair da tela (evita polling infinito após desmontar).
  const montadoRef = useRef(true)
  useEffect(() => {
    montadoRef.current = true
    return () => { montadoRef.current = false }
  }, [])

  // Cache de resultados bem-sucedidos por (ativo, mentor), PERSISTIDO em
  // localStorage por usuário. Quando a rodada é interrompida (uma IA deu erro)
  // e o usuário CONTINUA depois — inclusive após sair e voltar à tela — os
  // mentores que já avaliaram um ativo o reaproveitam (não pesquisam de novo)
  // e exibem "Participou". Limpo em reavaliação forçada (tudo / 1 ativo) e
  // podado conforme os ativos vão sendo salvos.
  const chaveCache = (ativoId: string, configId: string) => `${ativoId}::${configId}`
  const cacheStorageKey = uid ? `inv-aval-cache:${uid}` : null
  const temposStorageKey = uid ? `inv-aval-tempos:${uid}` : null
  const resumoStorageKey = uid ? `inv-aval-resumo:${uid}` : null
  // Snapshot das IAs que participaram da última avaliação concluída + tempos.
  const [resumoExec, setResumoExec] = useState<ResumoExecucao | null>(null)
  const cacheMentorRef = useRef<Map<string, InvAvaliacaoMentor>>(new Map())
  // Tempo de execução real (ms de chamadas de IA) acumulado por mentor —
  // também persistido, para exibir "quanto a IA demorou" mesmo após voltar.
  const temposMentorRef = useRef<Map<string, number>>(new Map())
  // Bump para forçar recálculo dos derivados / re-render quando os dados mudam.
  const [cacheTick, setCacheTick] = useState(0)
  // Carrega cache + tempos persistidos ao montar / trocar de usuário.
  useEffect(() => {
    let m = new Map<string, InvAvaliacaoMentor>()
    let t = new Map<string, number>()
    if (cacheStorageKey) {
      try {
        const raw = localStorage.getItem(cacheStorageKey)
        if (raw) m = new Map(Object.entries(JSON.parse(raw) as Record<string, InvAvaliacaoMentor>))
      } catch { /* cache corrompido — ignora */ }
    }
    if (temposStorageKey) {
      try {
        const raw = localStorage.getItem(temposStorageKey)
        if (raw) t = new Map(Object.entries(JSON.parse(raw) as Record<string, number>))
      } catch { /* ignora */ }
    }
    let r: ResumoExecucao | null = null
    if (resumoStorageKey) {
      try {
        const raw = localStorage.getItem(resumoStorageKey)
        if (raw) r = JSON.parse(raw) as ResumoExecucao
      } catch { /* ignora */ }
    }
    cacheMentorRef.current = m
    temposMentorRef.current = t
    setResumoExec(r)
    setCacheTick((tk) => tk + 1)
  }, [cacheStorageKey, temposStorageKey, resumoStorageKey])
  // Persiste o cache atual e dispara recálculo dos derivados.
  const persistCache = () => {
    if (cacheStorageKey) {
      try { localStorage.setItem(cacheStorageKey, JSON.stringify(Object.fromEntries(cacheMentorRef.current))) }
      catch { /* quota / indisponível — segue só em memória */ }
    }
    setCacheTick((t) => t + 1)
  }
  // Persiste os tempos de execução por mentor.
  const persistTempos = () => {
    if (temposStorageKey) {
      try { localStorage.setItem(temposStorageKey, JSON.stringify(Object.fromEntries(temposMentorRef.current))) }
      catch { /* ignora */ }
    }
    setCacheTick((t) => t + 1)
  }

  // Dados da rodada guardados para finalizar após a decisão do usuário.
  const decisaoRef = useRef<{
    lista: InvestimentoAtivo[]
    efPorAtivo: Map<string, EfQ>
    resultadosPorAtivo: Map<string, InvAvaliacaoMentor[]>
    abortados: Set<string>
    configsRun: string[]
  } | null>(null)

  // Mapa ativo_id → avaliação salva, e ativo_id → metadado do ativo.
  const avalPorAtivo = useMemo(() => {
    const m = new Map<string, InvAvaliacao>()
    for (const a of avaliacoes) m.set(a.ativo_id, a)
    return m
  }, [avaliacoes])
  const ativoPorId = useMemo(() => {
    const m = new Map<string, InvestimentoAtivo>()
    for (const a of ativos) m.set(a.id, a)
    return m
  }, [ativos])

  // Ativos com SALDO (quantidade em carteira) maior que zero — só eles são
  // avaliados pelas IAs (posição encerrada não interessa para a avaliação).
  const comSaldo = useMemo(
    () => new Set((ranking?.ativos ?? []).filter((a) => a.quantidade > 0).map((a) => a.ativo_id)),
    [ranking],
  )
  // Universo avaliável: ativos com saldo > 0.
  const ativosAvaliaveis = useMemo(() => ativos.filter((a) => comSaldo.has(a.id)), [ativos, comSaldo])

  // Linhas do ranking com saldo > 0 — base dos quadros de sobreposição e
  // correlação (trazem ticker, tipo, valor de mercado e ativo_id).
  const ativosComSaldo = useMemo(
    () => (ranking?.ativos ?? []).filter((a) => a.quantidade > 0),
    [ranking],
  )

  // Ativos avaliáveis ainda SEM avaliação salva — base para "continuar"
  // (retomar) após um erro: a avaliação só persiste por ativo ao final, então
  // os já salvos são pulados e o processo retoma de onde parou.
  const pendentes = useMemo(() => ativosAvaliaveis.filter((a) => !avalPorAtivo.has(a.id)), [ativosAvaliaveis, avalPorAtivo])

  // Mentores que vão de fato fazer a busca (não desativados pelo usuário).
  const configsAtivos = useMemo(() => configs.filter((c) => !mentoresDesativados.has(c.id)), [configs, mentoresDesativados])

  // Tipos de ativo avaliáveis (saldo > 0) presentes na carteira.
  const tiposPresentes = useMemo(() => {
    const set = new Set<TipoAtivoInvestimento>(ativosAvaliaveis.map((a) => a.tipo_ativo))
    return TIPOS_ATIVO_INV.filter((t) => set.has(t))
  }, [ativosAvaliaveis])
  // Tipos que o usuário DESMARCOU. Guardamos o que está desligado (não o que
  // está ligado) para que, por padrão, TODOS os tipos venham marcados — e
  // tipos novos que surjam depois também já entrem marcados.
  const [tiposDesmarcados, setTiposDesmarcados] = useState<Set<TipoAtivoInvestimento>>(new Set())
  const tipoMarcado = (t: TipoAtivoInvestimento) => !tiposDesmarcados.has(t)
  const toggleTipo = (t: TipoAtivoInvestimento) => setTiposDesmarcados((prev) => {
    const n = new Set(prev)
    if (n.has(t)) n.delete(t); else n.add(t)
    return n
  })
  // Filtra uma lista pelos tipos marcados.
  const filtrarTipos = (lista: InvestimentoAtivo[]) => lista.filter((a) => tipoMarcado(a.tipo_ativo))

  // Computa, a partir do cache persistido, QUANTOS dos ativos pendentes cada
  // mentor JÁ avaliou (sobrevive a sair/voltar). É a "conta" feita ao carregar
  // a tela: quem terminou (feitos === total) e quem ainda falta (feitos < total
  // → ao continuar, faz só os que ainda não fez).
  const statusPorMentor = useMemo(() => {
    void cacheTick  // recalcula quando o cache muda
    const total = pendentes.length
    const m = new Map<string, { feitos: number; total: number }>()
    for (const c of configs) {
      const feitos = pendentes.reduce((n, a) => n + (cacheMentorRef.current.has(chaveCache(a.id, c.id)) ? 1 : 0), 0)
      m.set(c.id, { feitos, total })
    }
    return m
  }, [configs, pendentes, cacheTick])
  // Mentores que JÁ concluíram todos os pendentes → exibem "Participou".
  const mentoresConcluidos = useMemo(() => {
    const s = new Set<string>()
    for (const [id, st] of statusPorMentor) if (st.total > 0 && st.feitos >= st.total) s.add(id)
    return s
  }, [statusPorMentor])
  // Há ativo pendente com ao menos um mentor já avaliado em cache? Então dá
  // para "Concluir agora" (salvar o que já foi coletado, sem rodar mais).
  const temCacheParaConcluir = useMemo(() => {
    void cacheTick
    return pendentes.some((a) => configs.some((c) => cacheMentorRef.current.has(chaveCache(a.id, c.id))))
  }, [pendentes, configs, cacheTick])

  // Perguntas (com critério) + médias por critério de cada ativo avaliado
  // (avaliação ATUAL) — alimenta o detalhamento e o snapshot de histórico.
  const detalhePorAtivo = useMemo(() => {
    const m = new Map<string, DetAtivo>()
    for (const a of ativos) {
      const av = avalPorAtivo.get(a.id)
      if (!av) continue
      const ef = questionarioEfetivo(a.tipo_ativo, perfil?.perfil ?? null, pesosGlobais)
      m.set(a.id, { perguntas: ef.perguntas, medias: mediasPorCriterio(av, ef.perguntas) })
    }
    return m
  }, [ativos, avalPorAtivo, questionarioEfetivo, perfil, pesosGlobais])

  // ── Seletor de avaliações anteriores (snapshots do histórico) ──────
  // Datas (YYYY-MM-DD) disponíveis no histórico, mais recentes primeiro.
  const roundsDisponiveis = useMemo(() => {
    const set = new Set<string>()
    for (const a of avaliacoes) for (const h of a.historico ?? []) if (h.gerado_em) set.add(h.gerado_em.slice(0, 10))
    return [...set].sort((x, y) => (x < y ? 1 : -1))
  }, [avaliacoes])
  const [roundSelecionado, setRoundSelecionado] = useState<string | null>(null)
  const modoHistorico = roundSelecionado != null

  // Mapas de EXIBIÇÃO: avaliação atual (default) ou snapshot de um round.
  const avalView = useMemo(() => {
    if (!roundSelecionado) return avalPorAtivo
    const m = new Map<string, InvAvaliacao>()
    for (const [id, cur] of avalPorAtivo) {
      const doDia = (cur.historico ?? []).filter((h) => h.gerado_em?.slice(0, 10) === roundSelecionado)
      const entry = doDia[doDia.length - 1]
      if (!entry) continue
      m.set(id, { ...cur, nota_final: entry.nota_final, consenso: { ...cur.consenso, criterios: entry.criterios ?? undefined } })
    }
    return m
  }, [roundSelecionado, avalPorAtivo])

  const detalheView = useMemo(() => {
    if (!roundSelecionado) return detalhePorAtivo
    const m = new Map<string, DetAtivo>()
    for (const [id, cur] of detalhePorAtivo) {
      const av = avalView.get(id)
      if (!av) continue
      m.set(id, { perguntas: cur.perguntas, medias: (av.consenso.criterios ?? {}) as Record<CriterioQuestao, number | null> })
    }
    return m
  }, [roundSelecionado, detalhePorAtivo, avalView])

  // Ativos exibidos, agrupados por tipo (usam a visão atual ou o snapshot).
  const gruposAvaliados = useMemo(() => {
    const porTipo = new Map<TipoAtivoInvestimento, InvestimentoAtivo[]>()
    for (const a of ativos) {
      if (!avalView.has(a.id)) continue
      const arr = porTipo.get(a.tipo_ativo) ?? []
      arr.push(a)
      porTipo.set(a.tipo_ativo, arr)
    }
    return [...porTipo.entries()].sort((x, y) => TIPOS_ATIVO_INV.indexOf(x[0]) - TIPOS_ATIVO_INV.indexOf(y[0]))
  }, [ativos, avalView])

  // Avaliação da carteira COMO UM TODO (antes da quebra por tipo): qualidade
  // média de todos os ativos avaliados na visão atual / snapshot.
  const resumoCarteira = useMemo(() => {
    const todos = ativos.filter((a) => avalView.has(a.id))
    return resumoQualidade(todos, avalView, detalheView)
  }, [ativos, avalView, detalheView])

  // Linhas do ranking do topo (refletem a visão atual ou o snapshot).
  const dadosRank = useMemo<LinhaRank[]>(() => {
    const out: LinhaRank[] = []
    for (const a of ativos) {
      const av = avalView.get(a.id)
      const det = detalheView.get(a.id)
      if (!av || !det) continue
      out.push({ ativo: a, final: av.nota_final, medias: det.medias })
    }
    return out
  }, [ativos, avalView, detalheView])

  // Agenda de reavaliação: deriva a última avaliação e a próxima data.
  const ultimaEm = useMemo(() => {
    let max = 0
    for (const a of avaliacoes) { const t = Date.parse(a.gerado_em); if (t > max) max = t }
    return max ? new Date(max) : null
  }, [avaliacoes])
  const proximaEm = useMemo(() => {
    if (frequencia === 'NENHUMA' || !ultimaEm) return null
    const d = new Date(ultimaEm)
    d.setDate(d.getDate() + DIAS_FREQUENCIA[frequencia])
    return d
  }, [frequencia, ultimaEm])
  // "Agora" capturado uma vez (montagem) — comparação estável no render.
  const [agoraTs] = useState(() => Date.now())
  const agendaVencida = proximaEm ? agoraTs > proximaEm.getTime() : false

  // Marca usada para localizar o lembrete da agenda no calendário.
  const PREFIXO_LEMBRETE_AGENDA = 'Reavaliar carteira'
  const fmtDataLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // Cria/atualiza/remove o lembrete da agenda (data = base + período). Ele
  // aparece no calendário do Dashboard como qualquer outro lembrete.
  async function sincronizarLembreteAgenda(freq: FrequenciaAgenda, base: Date) {
    const existente = todosLembretes.find((l) => l.descricao.startsWith(PREFIXO_LEMBRETE_AGENDA))
    if (freq === 'NENHUMA') {
      if (existente) await excluirLembrete(existente.id)
      return
    }
    const d = new Date(base)
    d.setDate(d.getDate() + DIAS_FREQUENCIA[freq])
    const data = fmtDataLocal(d)
    const descricao = `${PREFIXO_LEMBRETE_AGENDA} (${FREQUENCIA_LABEL[freq].toLowerCase()})`
    if (existente) await editarLembrete(existente.id, { data, descricao, status: 'PENDENTE' })
    else await criarLembrete({ data, descricao })
  }

  // Troca de frequência: salva a preferência e reflete no calendário.
  async function mudarAgenda(freq: FrequenciaAgenda) {
    await salvarAgenda(freq)
    await sincronizarLembreteAgenda(freq, ultimaEm ?? new Date())
  }

  // Coluna/sentido de ordenação da lista (qualquer critério ou a nota final).
  const [ordenar, setOrdenar] = useState<{ key: CriterioQuestao | 'final'; dir: 'asc' | 'desc' }>({ key: 'final', dir: 'desc' })

  // Nº de erros SEGUIDOS (sem nenhum acerto no meio) de uma IA que dispara a
  // pausa daquela IA. A contagem ZERA a cada chamada bem-sucedida. Após a
  // pausa há novas tentativas automáticas (backoff) antes de desistir.
  const LIMITE_ERROS_SEGUIDOS = 9
  const ESPERAS_SEG = [20, 45]          // backoff por ciclo de retentativa
  const MAX_CICLOS_RETRY = ESPERAS_SEG.length

  // Enquanto a rodada roda, avisa se o usuário tentar fechar/recarregar a aba
  // (o processo vive no JS desta aba — sair interrompe a avaliação).
  useEffect(() => {
    if (!rodando) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [rodando])

  // Espera com contagem regressiva visível na barra do mentor.
  async function esperarCountdown(configId: string, segundos: number) {
    for (let s = segundos; s > 0; s--) {
      setProgMentores((prev) => prev?.map((p) => p.configId === configId ? { ...p, aguardandoSeg: s } : p) ?? prev)
      await sleep(1000)
    }
    setProgMentores((prev) => prev?.map((p) => p.configId === configId ? { ...p, aguardandoSeg: undefined } : p) ?? prev)
  }

  // Bloqueia o loop do mentor enquanto ele estiver PAUSADO, liberando assim que
  // o usuário clicar em "Continuar". Mantém o mentor vivo na rodada. Para de
  // aguardar se a tela for desmontada (evita polling infinito).
  async function aguardarSePausado(configId: string) {
    while (pausadosRef.current.has(configId) && montadoRef.current) {
      setProgMentores((prev) => prev?.map((p) => p.configId === configId ? { ...p, pausado: true } : p) ?? prev)
      await sleep(400)
    }
  }

  // Consolida e persiste o consenso dos ativos, conforme o modo:
  //  - 'todos'   : salva todos (sem IA pausada);
  //  - 'ignorar' : descarta as IAs pausadas e salva o que der;
  //  - 'esperar' : salva só os ativos cobertos por TODAS as IAs (os demais
  //                ficam pendentes para uma próxima tentativa).
  async function finalizarSalvando(
    lista: InvestimentoAtivo[],
    efPorAtivo: Map<string, EfQ>,
    resultadosPorAtivo: Map<string, InvAvaliacaoMentor[]>,
    modo: 'todos' | 'ignorar' | 'esperar',
    abortados: Set<string>,
    configsRun: string[],
  ) {
    setSalvandoFase(true)
    const jaAvaliados = new Set(avalPorAtivo.keys())
    const participantes = new Set<string>()   // mentores que de fato avaliaram
    let salvos = 0
    let errosSalvar = 0
    for (const a of lista) {
      let mentores = resultadosPorAtivo.get(a.id) ?? []
      if (modo === 'ignorar') {
        mentores = mentores.filter((m) => !abortados.has(m.config_id))
        if (mentores.length === 0) continue
      } else if (modo === 'esperar') {
        const cobertos = new Set(mentores.map((m) => m.config_id))
        if (!configsRun.every((id) => cobertos.has(id))) continue  // incompleto → fica pendente
      }
      const ef = efPorAtivo.get(a.id)!
      const res = await salvarAvaliacao(a.id, ef.perguntas, ef.pesos, mentores)
      if (res.ok) {
        salvos++; jaAvaliados.add(a.id)
        for (const m of mentores) if (!m.erro) participantes.add(m.config_id)
        // Ativo salvo no banco → não é mais pendente; remove do cache local.
        for (const c of configs) cacheMentorRef.current.delete(chaveCache(a.id, c.id))
      } else errosSalvar++
    }
    persistCache()

    // Snapshot das IAs que participaram desta avaliação + tempo de cada uma.
    if (salvos > 0 && participantes.size > 0) {
      const snapshot: ResumoExecucao = {
        geradoEm: new Date().toISOString(),
        mentores: [...participantes].map((id) => {
          const c = configs.find((x) => x.id === id)
          return {
            configId: id,
            nome: c?.nome ?? null,
            provedor: c?.provedor ?? '',
            modelo: c?.modelo ?? null,
            tempoMs: temposMentorRef.current.get(id) ?? 0,
          }
        }),
      }
      setResumoExec(snapshot)
      if (resumoStorageKey) {
        try { localStorage.setItem(resumoStorageKey, JSON.stringify(snapshot)) } catch { /* ignora */ }
      }
    }

    await concluir()
    setRodando(false)
    setSalvandoFase(false)
    setPendenteDecisao(null)
    decisaoRef.current = null
    setTimeout(() => setProgMentores(null), 1000)
    const faltam = ativos.filter((a) => !jaAvaliados.has(a.id)).length
    setResumo({ avaliados: salvos, faltam, erros: errosSalvar })
    if (frequencia !== 'NENHUMA' && salvos > 0) {
      await sincronizarLembreteAgenda(frequencia, new Date())
    }
  }

  // Decisão do usuário sobre as IAs pausadas.
  async function finalizarDecisao(modo: 'ignorar' | 'esperar') {
    const d = decisaoRef.current
    if (!d) { setPendenteDecisao(null); return }
    await finalizarSalvando(d.lista, d.efPorAtivo, d.resultadosPorAtivo, modo, d.abortados, d.configsRun)
  }

  // "Retomar agora": mesmo efeito de "Esperar e tentar depois" (persiste o
  // que já foi concluído; os ativos que o(s) mentor(es) pausado(s) não
  // terminaram ficam pendentes) — só que já dispara uma nova rodada na hora,
  // sem o usuário precisar sair do painel e clicar em "Continuar avaliação"
  // à parte. Reusa o cache: mentores que já avaliaram não pesquisam de novo,
  // só o(s) que abortou(aram) tenta(m) de novo os ativos que faltaram.
  async function retomarAgora() {
    const d = decisaoRef.current
    if (!d) return
    retomarListaRef.current = d.lista
    await finalizarDecisao('esperar')
  }
  useEffect(() => {
    if (pendenteDecisao || rodando) return
    const lista = retomarListaRef.current
    if (!lista) return
    retomarListaRef.current = null
    void avaliar(lista)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendenteDecisao, rodando])

  // CONCLUIR agora: salva os ativos pendentes com o que já está em cache (sem
  // rodar mais nada). Ativos com ao menos um mentor avaliado são consolidados;
  // os sem nenhum resultado continuam pendentes.
  async function concluirAgora() {
    if (rodando || pendenteDecisao) return
    const lista: InvestimentoAtivo[] = []
    const efPorAtivo = new Map<string, EfQ>()
    const resultadosPorAtivo = new Map<string, InvAvaliacaoMentor[]>()
    for (const a of pendentes) {
      const mentores: InvAvaliacaoMentor[] = []
      for (const c of configs) {
        const r = cacheMentorRef.current.get(chaveCache(a.id, c.id))
        if (r) mentores.push(r)
      }
      if (mentores.length === 0) continue
      const ef = questionarioEfetivo(a.tipo_ativo, perfil?.perfil ?? null, pesosGlobais)
      efPorAtivo.set(a.id, { perguntas: ef.perguntas, pesos: ef.pesos })
      resultadosPorAtivo.set(a.id, mentores)
      lista.push(a)
    }
    if (lista.length === 0) return
    await finalizarSalvando(lista, efPorAtivo, resultadosPorAtivo, 'ignorar', new Set(), [])
  }

  // Avalia uma lista de ativos. Cada MENTOR roda em paralelo (loop próprio
  // sobre os ativos, com barra de progresso individual). Uma IA que acumula
  // erros seguidos é PAUSADA (não é martelada nos demais ativos) e a rodada
  // espera o usuário decidir o que fazer. Sem pausas, consolida e persiste.
  // `fresh` força nova pesquisa (limpa o cache dos ativos da lista) — usado em
  // "reavaliar tudo" e "reavaliar 1 ativo". Em "continuar" (fresh=false) o
  // cache é reaproveitado: mentores que já concluíram não pesquisam de novo.
  async function avaliar(lista: InvestimentoAtivo[], fresh = false) {
    if (rodando || pendenteDecisao || lista.length === 0 || configsAtivos.length === 0) return
    if (fresh) {
      for (const a of lista) for (const c of configs) cacheMentorRef.current.delete(chaveCache(a.id, c.id))
      for (const c of configsAtivos) temposMentorRef.current.delete(c.id)
      persistCache()
      persistTempos()
    }
    const reusarCache = !fresh
    setRodando(true)
    setSalvandoFase(false)
    setResumo(null)
    setPendenteDecisao(null)
    setRoundSelecionado(null)
    decisaoRef.current = null
    pausadosRef.current = new Set()
    const total = lista.length
    const participantes = configsAtivos          // mentores que farão a busca nesta rodada
    const idsParticipantes = participantes.map((c) => c.id)

    setProgMentores(participantes.map((c) => ({
      configId: c.id, nome: rotuloMentor(c.nome ?? null, c.provedor), feito: 0, total, erros: 0,
    })))

    // Questionário efetivo por ativo (resolvido uma vez).
    const efPorAtivo = new Map<string, EfQ>(lista.map((a) => {
      const ef = questionarioEfetivo(a.tipo_ativo, perfil?.perfil ?? null, pesosGlobais)
      return [a.id, { perguntas: ef.perguntas, pesos: ef.pesos }]
    }))
    const resultadosPorAtivo = new Map<string, InvAvaliacaoMentor[]>()
    const logsPorMentor = new Map<string, LogEntry[]>()
    const abortados = new Set<string>()
    setLogsMentor({})

    // Um loop por mentor, todos em paralelo. Dentro de cada mentor, os ativos
    // são sequenciais. Se a IA acumula erros seguidos, ela PAUSA, espera
    // (backoff) e tenta de novo SÓ os ativos que faltaram — até
    // MAX_CICLOS_RETRY vezes. Persistindo a falha, é abortada e a rodada
    // pede a decisão do usuário.
    await Promise.all(participantes.map(async (c) => {
      const log: LogEntry[] = []
      logsPorMentor.set(c.id, log)
      const atribuidos = new Map<string, InvAvaliacaoMentor>()
      const tentados = new Set<string>()
      let msExecucao = 0   // tempo real gasto em chamadas de IA por este mentor
      const registrarLog = () => setLogsMentor((prev) => ({ ...prev, [c.id]: [...log] }))
      const atualizarProg = () => {
        const erros = [...atribuidos.values()].filter((x) => x.erro).length
        setProgMentores((prev) => prev?.map((p) => p.configId === c.id ? { ...p, feito: tentados.size, erros } : p) ?? prev)
      }

      let fila = [...lista]
      let ciclo = 0
      let abortou = false
      // Erros SEGUIDOS sem nenhum acerto — zera a cada sucesso (inclusive
      // reaproveitamento de cache). Persiste entre ciclos de retentativa.
      let consecutivos = 0
      while (fila.length > 0) {
        await aguardarSePausado(c.id)
        if (!montadoRef.current) return     // saiu da tela: encerra este mentor
        const aindaFalhou: InvestimentoAtivo[] = []
        // Bateu o limite de erros seguidos NESTE ciclo? Então pausa/aborta.
        let atingiuLimite = false
        for (let idx = 0; idx < fila.length; idx++) {
          await aguardarSePausado(c.id)   // bloqueia aqui enquanto pausado
          if (!montadoRef.current) return  // saiu da tela: encerra este mentor
          const a = fila[idx]
          const ef = efPorAtivo.get(a.id)!
          // Reaproveita resultado já obtido (rodada anterior interrompida).
          const cacheado = reusarCache ? cacheMentorRef.current.get(chaveCache(a.id, c.id)) : undefined
          const r: InvAvaliacaoMentor = cacheado ?? await (async () => {
            const t0 = performance.now()
            const res = await avaliarMentorAtivo(a.id, c.id, ef.perguntas, ef.pesos)
            msExecucao += performance.now() - t0
            const rr: InvAvaliacaoMentor = res.ok && res.dados
              ? res.dados
              : { config_id: c.id, nome: c.nome ?? null, provedor: c.provedor, modelo: c.modelo ?? null, nota: null, respostas: {}, erro: res.erro ?? 'falha' }
            if (!rr.erro) { cacheMentorRef.current.set(chaveCache(a.id, c.id), rr); persistCache() }
            return rr
          })()
          atribuidos.set(a.id, r)
          tentados.add(a.id)
          log.push({
            ticker: cacheado ? `${a.ticker} (reaproveitado)` : ciclo > 0 ? `${a.ticker} (tentativa ${ciclo + 1})` : a.ticker,
            ok: !r.erro,
            erro: r.erro ?? undefined,
            nota: r.erro ? undefined : r.nota,
            respostas: r.erro ? undefined : Object.keys(r.respostas ?? {}).length,
          })
          registrarLog()
          atualizarProg()
          if (r.erro) { aindaFalhou.push(a); consecutivos++ } else consecutivos = 0
          if (consecutivos >= LIMITE_ERROS_SEGUIDOS) {
            atingiuLimite = true
            for (let j = idx + 1; j < fila.length; j++) aindaFalhou.push(fila[j])
            break
          }
        }
        if (aindaFalhou.length === 0) break  // mentor concluiu sem pendências
        const resolvidosNoCiclo = fila.length - aindaFalhou.length
        if (atingiuLimite) {
          // Bateu o limite de erros SEGUIDOS: pausa com backoff e re-tenta.
          // Persistindo após MAX_CICLOS_RETRY, aborta e pede decisão.
          ciclo++
          if (ciclo > MAX_CICLOS_RETRY) { abortou = true; break }
          const seg = ESPERAS_SEG[Math.min(ciclo - 1, ESPERAS_SEG.length - 1)]
          log.push({ ticker: '—', ok: false, erro: `Pausada após ${LIMITE_ERROS_SEGUIDOS} erros seguidos — nova tentativa em ${seg}s (${ciclo + 1}ª de ${MAX_CICLOS_RETRY + 1}).` })
          registrarLog()
          await esperarCountdown(c.id, seg)
        } else if (resolvidosNoCiclo === 0) {
          // Ciclo inteiro sem nenhum acerto e sem bater o limite (poucas falhas
          // esparsas teimosas): para de re-tentar. Ficam como erro do mentor,
          // mas NÃO bloqueiam a rodada (sem fluxo de decisão).
          break
        }
        fila = aindaFalhou
      }

      // Resultados finais deste mentor (1 por ativo tentado) → mapa compartilhado.
      for (const [aid, r] of atribuidos) {
        const arr = resultadosPorAtivo.get(aid) ?? []
        arr.push(r)
        resultadosPorAtivo.set(aid, arr)
      }
      // Persiste o que este mentor obteve (resultados bem-sucedidos já estão no
      // cacheMentorRef) — assim "Participou" e o reaproveitamento sobrevivem a
      // sair/voltar mesmo que a rodada seja interrompida.
      persistCache()
      // Acumula o tempo real gasto em chamadas de IA deste mentor (reaproveitar
      // cache soma 0). Persiste para exibir mesmo após sair/voltar.
      if (msExecucao > 0) {
        temposMentorRef.current.set(c.id, (temposMentorRef.current.get(c.id) ?? 0) + msExecucao)
        persistTempos()
      }
      if (abortou) {
        abortados.add(c.id)
        log.push({ ticker: '—', ok: false, erro: `Execução abortada após ${MAX_CICLOS_RETRY + 1} tentativas com erros.` })
        registrarLog()
        setProgMentores((prev) => prev?.map((p) => p.configId === c.id ? { ...p, abortado: true, aguardandoSeg: undefined } : p) ?? prev)
      }
    }))

    // Alguma IA pausada → guarda o estado e espera a decisão do usuário.
    if (abortados.size > 0) {
      decisaoRef.current = { lista, efPorAtivo, resultadosPorAtivo, abortados, configsRun: idsParticipantes }
      setPendenteDecisao({
        mentores: [...abortados].map((id) => {
          const c = configs.find((x) => x.id === id)
          const log = logsPorMentor.get(id) ?? []
          return {
            configId: id,
            nome: c ? rotuloMentor(c.nome ?? null, c.provedor) : id,
            log,
            erros: log.filter((e) => !e.ok).length,
          }
        }),
      })
      setRodando(false)
      setSalvandoFase(false)
      return
    }

    await finalizarSalvando(lista, efPorAtivo, resultadosPorAtivo, 'todos', abortados, idsParticipantes)
  }

  // ── Snapshot pra IA ───────────────────────────────────────────────────────
  useRegistrarContextoIA(useMemo(() => {
    if (carregandoIA || loadingAtivos || loadingAval || avaliacoes.length === 0) return null
    const tickerDe = (ativoId: string) => ativos.find((a) => a.id === ativoId)?.ticker ?? ativoId
    return {
      titulo:    'Investimentos · Mentor (Avaliações)',
      descricao: 'Notas de avaliação dos ativos pelos mentores de IA configurados',
      dados: {
        qtd_mentores_configurados: configs.length,
        avaliacoes: avaliacoes.map((av) => ({
          ticker:     tickerDe(av.ativo_id),
          nota_final: av.nota_final,
          gerado_em:  av.gerado_em,
          mentores: av.consenso.mentores.map((m) => ({
            nome: rotuloMentor(m.nome, m.provedor), nota: m.nota, erro: m.erro,
          })),
        })),
        // Carteira do usuário — ausente até aqui: sem isso, perguntar ao
        // mentor "e a minha carteira?" não tinha nenhum dado de posição pra
        // responder (achado real do usuário). Vem do mesmo ranking já
        // buscado nesta página (sem requisição nova).
        carteira: (ranking?.ativos ?? []).map((a) => ({
          ticker: a.ticker, tipo_ativo: a.tipo_ativo, quantidade: a.quantidade,
          valor_investido: a.valor_custo, valor_mercado: a.valor_mercado,
          participacao_pct: a.participacao_pct, dividend_yield_pct: a.dividend_yield_pct,
        })),
      },
    }
  }, [carregandoIA, loadingAtivos, loadingAval, avaliacoes, ativos, configs.length, ranking]))

  if (carregandoIA || loadingAtivos || loadingAval || loadingRanking) return <LoadingMascote />

  // Gating: precisa de ≥1 mentor configurado.
  const semMentor = configs.length === 0

  // Listas que de fato vão para a avaliação (saldo > 0 + tipos selecionados).
  const pendentesSel = filtrarTipos(pendentes)
  const avaliaveisSel = filtrarTipos(ativosAvaliaveis)

  return (
    <div className="p-5">
      <InvestimentosNav />
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-white">Avaliações</h1>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
            Seus mentores (IAs) avaliam cada ativo; a nota de cada questão consolida as IAs (média/mediana) e a nota final é a média ponderada dos critérios
          </p>
        </div>
      </div>

      {semMentor ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
          <Bot size={28} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-white font-medium">Nenhum mentor configurado</p>
          <p className="text-[13px] mt-1 max-w-md mx-auto" style={{ color: MUTED }}>
            As avaliações usam as IAs que você cadastrar. Configure ao menos um mentor em
            Perfil → Integração com IA para liberar esta página.
          </p>
          <Link to="/perfil"
            className="inline-flex items-center gap-1.5 mt-4 px-3.5 py-2 rounded-lg text-[13px] font-medium text-white"
            style={{ background: '#3b82f6' }}>
            <Settings size={15} /> Configurar mentores
          </Link>
        </div>
      ) : ativos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
          <p className="text-white font-medium">Nenhum ativo cadastrado</p>
          <p className="text-[13px] mt-1" style={{ color: MUTED }}>Cadastre ativos em “Meus ativos” para avaliá-los.</p>
        </div>
      ) : (
        <>
          {/* Seleção de quais TIPOS de ativo as IAs devem pesquisar. Só os
              tipos com saldo > 0 aparecem; clicar liga/desliga o tipo. */}
          <div data-tutorial="avaliacoes-avaliar">
          {tiposPresentes.length > 1 && (
            <div className="mb-3">
              <p className="text-[12.5px] mb-1.5" style={{ color: MUTED }}>Tipos de ativo a avaliar:</p>
              <div className="flex flex-wrap gap-2">
                {tiposPresentes.map((t) => {
                  const on = tipoMarcado(t)
                  return (
                    <button key={t} onClick={() => toggleTipo(t)} disabled={rodando || !!pendenteDecisao}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border disabled:opacity-50"
                      style={on
                        ? { borderColor: `${TIPO_ATIVO_COR[t]}66`, color: TIPO_ATIVO_COR[t], background: `${TIPO_ATIVO_COR[t]}1a` }
                        : { borderColor: 'rgba(255,255,255,0.15)', color: MUTED }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: on ? TIPO_ATIVO_COR[t] : MUTED }} />
                      {TIPO_ATIVO_LABEL[t]}
                      {on ? <CheckCircle2 size={12} /> : <X size={12} />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Botão avaliar — à esquerda. Avalia só os PENDENTES (retoma de
              onde parou após erro). "Reavaliar tudo" força a carteira inteira. */}
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            <button onClick={() => avaliar(pendentesSel)} disabled={rodando || !!pendenteDecisao || pendentesSel.length === 0 || configsAtivos.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: '#8b5cf6' }}>
              <Sparkles size={15} className={rodando ? 'animate-pulse' : ''} />
              {rodando ? 'Avaliando…'
                : avaliacoes.length > 0
                  ? `Continuar avaliação (${pendentesSel.length} restante${pendentesSel.length === 1 ? '' : 's'})`
                  : 'Avaliar carteira com os mentores'}
            </button>
            {temCacheParaConcluir && (
              <button onClick={() => concluirAgora()} disabled={rodando || !!pendenteDecisao}
                title="Salvar agora os ativos pendentes com o que os mentores já avaliaram (sem rodar mais)"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: '#00a37a' }}>
                <CheckCircle2 size={15} /> Concluir
              </button>
            )}
            {avaliacoes.length > 0 && (
              <button onClick={() => avaliar(avaliaveisSel, true)} disabled={rodando || !!pendenteDecisao || avaliaveisSel.length === 0 || configsAtivos.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border border-white/15 text-white/90 hover:border-white/30 disabled:opacity-50">
                <RefreshCw size={14} className={rodando ? 'animate-spin' : ''} /> Reavaliar tudo
              </button>
            )}
            {!rodando && ativosAvaliaveis.length === 0 && (
              <span className="text-[12.5px]" style={{ color: MUTED }}>
                Nenhum ativo com saldo em carteira para avaliar.
              </span>
            )}
          </div>
          </div>

          {/* Aviso enquanto roda: não trocar/fechar aba, não abrir o sistema
              em outra aba — o processo vive nesta aba e seria interrompido. */}
          {rodando && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={18} style={{ color: '#ffb74d' }} className="mt-0.5 shrink-0" />
              <p className="text-[13px] text-white/90">
                <strong className="text-white">Avaliação em andamento — aguarde o término.</strong>{' '}
                Não feche nem recarregue esta aba e não abra o sistema em outra aba: o processo
                roda aqui e seria interrompido. Você pode acompanhar o progresso de cada mentor abaixo.
              </p>
            </div>
          )}

          {/* Resumo da rodada — avaliados agora × restantes na carteira */}
          {resumo && !rodando && (
            <div className={`mb-4 rounded-lg border px-4 py-2.5 text-[13px] flex items-center gap-2 ${
              resumo.faltam === 0 && resumo.erros === 0
                ? 'border-emerald-500/30 bg-emerald-500/10'
                : 'border-amber-500/30 bg-amber-500/10'}`}>
              {resumo.faltam === 0 && resumo.erros === 0
                ? <CheckCircle2 size={16} style={{ color: '#00c896' }} />
                : <AlertTriangle size={16} style={{ color: '#ffb74d' }} />}
              <span className="text-white/90">
                <strong className="text-white">{resumo.avaliados}</strong> ativo{resumo.avaliados === 1 ? '' : 's'} avaliado{resumo.avaliados === 1 ? '' : 's'} nesta rodada
                {resumo.erros > 0 && <span style={{ color: '#ffb74d' }}> · {resumo.erros} sem consenso</span>}
                {' · '}
                {resumo.faltam === 0
                  ? <span style={{ color: '#00c896' }}>carteira completa</span>
                  : <span><strong className="text-white">{resumo.faltam}</strong> ainda {resumo.faltam === 1 ? 'falta' : 'faltam'}</span>}
              </span>
            </div>
          )}

          {/* Decisão pendente: IA(s) pausada(s) por erros repetidos */}
          {pendenteDecisao && (
            <AvisoDecisao decisao={pendenteDecisao} processando={salvandoFase}
              onRetomar={retomarAgora}
              onIgnorar={() => finalizarDecisao('ignorar')}
              onEsperar={() => finalizarDecisao('esperar')} />
          )}

          {/* Agenda de reavaliação — frequência definida pelo usuário */}
          <section data-tutorial="avaliacoes-agenda" className={`rounded-xl border px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap ${
            agendaVencida ? 'border-amber-500/30 bg-amber-500/10' : 'border-white/10 bg-white/[0.02]'}`}>
            <div className="flex items-center gap-2 min-w-0">
              <CalendarClock size={18} style={{ color: agendaVencida ? '#ffb74d' : '#8b5cf6' }} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-white">Agenda de reavaliação</p>
                <p className="text-[12px]" style={{ color: MUTED }}>
                  {frequencia === 'NENHUMA'
                    ? 'Escolha uma frequência para ser lembrado de reavaliar a carteira.'
                    : proximaEm
                      ? <>Próxima: <span style={{ color: agendaVencida ? '#ffb74d' : '#c5cad8' }}>{proximaEm.toLocaleDateString('pt-BR')}</span>
                          {agendaVencida && ' · reavaliação recomendada'}
                          {ultimaEm && ` · última em ${ultimaEm.toLocaleDateString('pt-BR')}`}</>
                      : 'Avalie a carteira ao menos uma vez para começar a contar a próxima data.'}
                </p>
              </div>
            </div>
            <SelectDark value={frequencia} onChange={(e) => mudarAgenda(e.target.value as FrequenciaAgenda)}
              style={{ width: 'auto' }} className="!text-[13px] !py-2">
              {(Object.keys(FREQUENCIA_LABEL) as FrequenciaAgenda[]).map((f) => (
                <option key={f} value={f}>{FREQUENCIA_LABEL[f]}</option>
              ))}
            </SelectDark>
          </section>

          {/* Mentores que vão opinar — o ativo (mascote preferido) orquestra
              os demais mentores configurados. */}
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-4" data-tutorial="avaliacoes-mentores">
            <h2 className="text-[13px] font-semibold text-white mb-4">
              Mentores ({configs.length})
            </h2>

            {(() => {
              const ativoCfg = ativa ?? configs[0]
              const outros = configs.filter((c) => c.id !== ativoCfg?.id)
              const progPorConfig = new Map((progMentores ?? []).map((p) => [p.configId, p]))
              // Decide o que mostrar abaixo de cada mentor conforme o estado:
              //  - rodando + em andamento  → "Parar" (pausa)
              //  - rodando + pausado       → "Continuar" (retoma o mentor)
              //  - concluiu os pendentes   → "Participou"
              //  - fora da rodada + parcial → "Continuar (N restantes)" (faz só o que falta)
              //  - caso contrário          → liga/desliga participação
              const acaoMentor = (id: string) => {
                const p = progPorConfig.get(id)
                if (rodando && p) {
                  if (p.pausado) return <BotaoContinuarMentor onContinuar={() => retomarMentor(id)} />
                  if (!p.abortado && p.feito < p.total) return <BotaoPararMentor onParar={() => pausarMentor(id)} />
                }
                if (mentoresConcluidos.has(id)) return <SeloParticipou />
                const st = statusPorMentor.get(id)
                if (!rodando && !pendenteDecisao && st && st.total > 0 && st.feitos > 0 && st.feitos < st.total) {
                  return <BotaoContinuarPendente faltam={st.total - st.feitos}
                    desabilitado={configsAtivos.length === 0 || pendentesSel.length === 0}
                    onContinuar={() => avaliar(pendentesSel)} />
                }
                return <BotaoMentorAtivo ativo={!mentoresDesativados.has(id)} desabilitado={rodando || !!pendenteDecisao}
                  onToggle={() => toggleMentorAtivo(id)} />
              }
              return (
                <div className="flex flex-col items-center gap-3">
                  {/* Orquestrador (mentor ativo) — acima dos demais.
                      Altura fixa (!h) p/ casar com os secundários — o Mascote
                      dimensiona por largura, então normalizamos pela altura.
                      A barra de progresso fica logo abaixo do mentor. */}
                  <div className="flex flex-col items-center w-[150px] cursor-pointer rounded-lg hover:bg-white/[0.03] p-1"
                    title="Ver log de execução deste mentor"
                    onClick={() => ativoCfg && setLogAberto(ativoCfg.id)}>
                    <div className="relative">
                      <Mascote nome={mascote} pose="comprimento-inicio"
                        className={`!h-[120px] !w-auto ${ativoCfg && mentoresDesativados.has(ativoCfg.id) ? 'opacity-30 grayscale' : ''}`} />
                      {ativoCfg?.modelo && <IconeModelo modelo={ativoCfg.modelo} />}
                    </div>
                    <span className="mt-1 text-[13px] font-semibold text-white text-center">
                      {ativoCfg ? rotuloMentor(ativoCfg.nome ?? null, ativoCfg.provedor) : '—'}
                    </span>
                    <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}>
                      <Sparkles size={11} /> Orquestrador
                    </span>
                    {ativoCfg && <BarraMentor prog={progPorConfig.get(ativoCfg.id)} />}
                    {ativoCfg && acaoMentor(ativoCfg.id)}
                    {ativoCfg && (temposMentorRef.current.get(ativoCfg.id) ?? 0) > 0 && (
                      <TempoExecucao ms={temposMentorRef.current.get(ativoCfg.id)!} />
                    )}
                  </div>

                  {/* Conector + demais mentores */}
                  {outros.length > 0 && (
                    <>
                      <div className="h-5 w-px" style={{ background: 'rgba(255,255,255,0.15)' }} />
                      <div className="flex flex-wrap justify-center gap-x-6 gap-y-4">
                        {outros.map((c, i) => (
                          <div key={c.id} className="flex flex-col items-center w-[110px] cursor-pointer rounded-lg hover:bg-white/[0.03] p-1"
                            title="Ver log de execução deste mentor"
                            onClick={() => setLogAberto(c.id)}>
                            <div className="relative">
                              <Mascote nome={mascoteSecundario(i, mascote)} pose="sentado"
                                className={`!h-[120px] !w-auto ${mentoresDesativados.has(c.id) ? 'opacity-30 grayscale' : ''}`} />
                              {c.modelo && <IconeModelo modelo={c.modelo} />}
                            </div>
                            <span className="mt-1 text-[12px] font-medium text-white/90 text-center leading-tight">
                              {rotuloMentor(c.nome ?? null, c.provedor)}
                            </span>
                            <BarraMentor prog={progPorConfig.get(c.id)} />
                            {acaoMentor(c.id)}
                            {(temposMentorRef.current.get(c.id) ?? 0) > 0 && (
                              <TempoExecucao ms={temposMentorRef.current.get(c.id)!} />
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {salvandoFase && (
                    <span className="text-[12px] mt-1" style={{ color: MUTED }}>Consolidando consenso…</span>
                  )}
                </div>
              )
            })()}
          </section>

          {/* Seletor de avaliações anteriores — logo abaixo dos mentores */}
          {roundsDisponiveis.length > 0 && (
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px]" style={{ color: MUTED }}>Visualizar avaliação:</span>
              <SelectDark value={roundSelecionado ?? ''} onChange={(e) => setRoundSelecionado(e.target.value || null)}
                style={{ width: 'auto' }} className="!text-[13px] !py-2">
                <option value="">Atual</option>
                {roundsDisponiveis.map((d) => (
                  <option key={d} value={d}>{new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR')}</option>
                ))}
              </SelectDark>
              {modoHistorico && (
                <span className="text-[12px]" style={{ color: '#ffb74d' }}>
                  Somente leitura — snapshot do histórico (sem detalhe por mentor).
                </span>
              )}
            </div>
          )}

          {/* Avaliação da carteira COMO UM TODO + IAs que participaram —
              exibida antes da listagem (por tipo) de ativos. */}
          {gruposAvaliados.length > 0 && (
            <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
              <h2 className="text-[13px] font-semibold text-white mb-2 flex items-center gap-1.5">
                <Sparkles size={15} style={{ color: '#8b5cf6' }} /> Avaliação da carteira
              </h2>
              {resumoCarteira ? (
                <div className="rounded-lg border px-3 py-2 text-[12.5px]"
                  style={{ borderColor: `${resumoCarteira.cor}55`, background: `${resumoCarteira.cor}14` }}>
                  <span className="font-semibold" style={{ color: resumoCarteira.cor }}>{resumoCarteira.label}.</span>{' '}
                  <span className="text-white/85">{resumoCarteira.texto.replace(/^Qualidade \w+ — /, '')}</span>
                </div>
              ) : (
                <p className="text-[12.5px]" style={{ color: MUTED }}>Sem ativos avaliados ainda.</p>
              )}

              {/* IAs que participaram da última avaliação concluída + tempos */}
              {!modoHistorico && resumoExec && resumoExec.mentores.length > 0 && (
                <div className="mt-3">
                  <p className="text-[12px] font-semibold text-white mb-1.5">
                    IAs que participaram
                    <span className="font-normal" style={{ color: MUTED }}> · {new Date(resumoExec.geradoEm).toLocaleString('pt-BR')}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {resumoExec.mentores.map((m) => (
                      <span key={m.configId} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/10 text-[12px]">
                        <Bot size={13} style={{ color: '#8b5cf6' }} />
                        <span className="text-white/90">{rotuloMentor(m.nome, m.provedor)}</span>
                        {m.modelo && <span style={{ color: MUTED }}>({m.modelo})</span>}
                        {m.tempoMs > 0 && (
                          <span className="inline-flex items-center gap-1" style={{ color: MUTED }}>
                            <Clock size={11} /> {formatDuracao(m.tempoMs)}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Ranking geral dos ativos — logo após a avaliação da carteira */}
          {dadosRank.length > 0 && <RankingTopo dados={dadosRank} />}

          {/* Concentração de risco da carteira: sobreposição de ETFs e
              correlação entre ativos (independem do modo histórico). */}
          {!modoHistorico && ativosComSaldo.length > 0 && (
            <QuadroSobreposicao ativosCarteira={ativosComSaldo} ativoPorId={ativoPorId} />
          )}
          {!modoHistorico && ativosComSaldo.length > 0 && (
            <QuadroCorrelacao historico={historico} ativosCarteira={ativosComSaldo} ativoPorId={ativoPorId} />
          )}

          {avaliacoes.length === 0 && !progMentores ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center text-[13px]" style={{ color: MUTED }}>
              Nenhuma avaliação ainda. Clique em “Avaliar carteira com os mentores”.
            </div>
          ) : (
            <div className="space-y-5">
              {gruposAvaliados.map(([tipo, lista]) => (
                <GrupoTipoAvaliacao key={tipo} tipo={tipo} ativos={lista}
                  avalPorAtivo={avalView} detalhePorAtivo={detalheView}
                  ordenar={ordenar} setOrdenar={setOrdenar} modoHistorico={modoHistorico}
                  rodando={rodando} onReavaliar={(id) => avaliar([ativoPorId.get(id)!], true)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Log individual do mentor clicado */}
      {logAberto && (() => {
        const c = configs.find((x) => x.id === logAberto)
        return (
          <ModalLogMentor
            nome={c ? rotuloMentor(c.nome ?? null, c.provedor) : 'Mentor'}
            log={logsMentor[logAberto] ?? []}
            onClose={() => setLogAberto(null)} />
        )
      })()}

      <TutorialTour pageKey="investimentos-avaliacoes-v1" passos={TUTORIAL_INVESTIMENTOS_AVALIACOES} />
    </div>
  )
}

// Coluna/sentido de ordenação da lista de ativos avaliados.
type Ordenacao = { key: CriterioQuestao | 'final'; dir: 'asc' | 'desc' }

// Cabeçalho de coluna clicável para ordenar a lista.
function ThSort({ col, label, icon: Icon, ordenar, setOrdenar, className }: {
  col: CriterioQuestao | 'final'
  label: string
  icon?: LucideIcon
  ordenar: Ordenacao
  setOrdenar: Dispatch<SetStateAction<Ordenacao>>
  className?: string
}) {
  const ativa = ordenar.key === col
  const seta = ativa ? (ordenar.dir === 'desc' ? '▼' : '▲') : ''
  return (
    <th onClick={() => setOrdenar((o) => o.key === col ? { key: col, dir: o.dir === 'desc' ? 'asc' : 'desc' } : { key: col, dir: 'desc' })}
      title={col === 'final' ? 'Ordenar pela nota final' : `Ordenar por ${CRITERIO_LABEL[col]}`}
      className={`font-medium py-2 px-2 whitespace-nowrap cursor-pointer select-none hover:text-white ${className ?? ''}`}
      style={{ color: ativa ? '#fff' : MUTED }}>
      <span className="inline-flex items-center gap-1 justify-center">
        {Icon && <Icon size={13} />}
        {label}{seta && <span className="text-[10px]">{seta}</span>}
      </span>
    </th>
  )
}

// ── Grupo de um tipo de ativo: lista ordenável (médias por critério + nota
//    final), com cada ativo expansível para a planilha mentor × pergunta. ──
function GrupoTipoAvaliacao({ tipo, ativos, avalPorAtivo, detalhePorAtivo, ordenar, setOrdenar, rodando, onReavaliar, modoHistorico }: {
  tipo: TipoAtivoInvestimento
  ativos: InvestimentoAtivo[]
  avalPorAtivo: Map<string, InvAvaliacao>
  detalhePorAtivo: Map<string, DetAtivo>
  ordenar: Ordenacao
  setOrdenar: Dispatch<SetStateAction<Ordenacao>>
  rodando: boolean
  onReavaliar: (id: string) => void
  /** Visualizando um snapshot do histórico (só leitura, sem detalhe). */
  modoHistorico?: boolean
}) {
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const [grupoAberto, setGrupoAberto] = useState(true)
  const toggle = (id: string) => setAberto((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const linhas = useMemo(() => {
    const val = (id: string): number | null =>
      ordenar.key === 'final' ? (avalPorAtivo.get(id)?.nota_final ?? null)
        : (detalhePorAtivo.get(id)?.medias[ordenar.key] ?? null)
    return [...ativos].sort((a, b) => {
      const va = val(a.id), vb = val(b.id)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return ordenar.dir === 'desc' ? vb - va : va - vb
    })
  }, [ativos, avalPorAtivo, detalhePorAtivo, ordenar])

  const resumo = useMemo(
    () => resumoQualidade(ativos, avalPorAtivo, detalhePorAtivo),
    [ativos, avalPorAtivo, detalhePorAtivo],
  )

  // Melhores e piores do tipo (por nota final). O quadro de ranking só faz
  // sentido para tipos com mais de 10 ativos avaliados — abaixo disso a própria
  // tabela já dá a visão completa. Os "piores" nunca repetem os "melhores".
  const NRANK = 5
  const MIN_PARA_RANK = 10
  const { melhores, piores } = useMemo(() => {
    const ranked = ativos
      .map((a) => ({ ticker: a.ticker, nota: avalPorAtivo.get(a.id)?.nota_final ?? null }))
      .filter((x): x is { ticker: string; nota: number } => x.nota != null)
      .sort((a, b) => b.nota - a.nota)
    if (ranked.length <= MIN_PARA_RANK) return { melhores: [], piores: [] }
    const best = ranked.slice(0, NRANK)
    const worst = ranked.slice(Math.max(NRANK, ranked.length - NRANK)).reverse()  // piores primeiro
    return { melhores: best, piores: worst }
  }, [ativos, avalPorAtivo])

  // Posição (1..N) de cada ativo do tipo pela nota final — coluna "Ranking".
  const rankPorAtivo = useMemo(() => {
    const ranked = ativos
      .map((a) => ({ id: a.id, nota: avalPorAtivo.get(a.id)?.nota_final ?? null }))
      .filter((x): x is { id: string; nota: number } => x.nota != null)
      .sort((a, b) => b.nota - a.nota)
    const m = new Map<string, number>()
    ranked.forEach((x, i) => m.set(x.id, i + 1))
    return m
  }, [ativos, avalPorAtivo])

  return (
    <div>
      {/* Cabeçalho do tipo — clicável para colapsar/expandir o grupo. Fica
          fixo no topo (sticky) enquanto a lista daquele tipo estiver em tela. */}
      <button onClick={() => setGrupoAberto((o) => !o)}
        className="w-full flex items-center gap-2 mb-2 text-left sticky top-0 z-10 py-1.5"
        style={{ background: 'var(--bg-page, #0a0f1a)' }}>
        <ChevronDown size={15} style={{ color: MUTED }} className={`shrink-0 transition-transform ${grupoAberto ? '' : '-rotate-90'}`} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: TIPO_ATIVO_COR[tipo] }} />
        <span className="text-[14px] font-semibold text-white">{TIPO_ATIVO_LABEL[tipo]}</span>
        <span className="text-[12px] font-normal" style={{ color: MUTED }}>({linhas.length})</span>
        {resumo && !grupoAberto && (
          <span className="text-[12px] font-semibold ml-1" style={{ color: resumo.cor }}>· {resumo.label}</span>
        )}
      </button>

      {grupoAberto && (<>
      {/* Resumo da qualidade desta carteira (tipo) */}
      {resumo && (
        <div className="mb-2 rounded-lg border px-3 py-2 text-[12.5px]"
          style={{ borderColor: `${resumo.cor}55`, background: `${resumo.cor}14` }}>
          <span className="font-semibold" style={{ color: resumo.cor }}>{resumo.label}.</span>{' '}
          <span className="text-white/85">{resumo.texto.replace(/^Qualidade \w+ — /, '')}</span>
        </div>
      )}

      {/* Rankings do tipo — melhores e (abaixo) piores. */}
      {melhores.length > 0 && (
        <div className="mb-2 space-y-2">
          <MiniRankAtivos titulo="Melhores" Icon={Trophy} cor="#f0b429" itens={melhores} />
          {piores.length > 0 && (
            <MiniRankAtivos titulo="Piores" Icon={ArrowDown} cor="#ff5c7a" itens={piores} medalhas={false} />
          )}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-x-auto">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr style={{ color: MUTED }}>
              <th className="font-medium py-2 pl-3 pr-2 text-center whitespace-nowrap">Ranking</th>
              <th className="font-medium py-2 pl-2 pr-2 text-left min-w-[200px]">Ativo</th>
              {CRITERIOS_QUESTAO.map((cr) => (
                <ThSort key={cr} col={cr} label={CRITERIO_ABBR[cr]} icon={CRITERIO_ICON[cr]} ordenar={ordenar} setOrdenar={setOrdenar} />
              ))}
              <ThSort col="final" label="Nota" icon={Star} ordenar={ordenar} setOrdenar={setOrdenar} />
              {!modoHistorico && <th className="font-medium py-2 px-2 text-center whitespace-nowrap">Consenso</th>}
              {!modoHistorico && <th className="py-2 px-2 w-8" />}
            </tr>
          </thead>
          <tbody>
            {linhas.map((a) => {
              const av = avalPorAtivo.get(a.id)!
              const det = detalhePorAtivo.get(a.id)
              const temErro = !modoHistorico && av.consenso.mentores.some((m) => m.erro !== null)
              const estaAberto = aberto.has(a.id)
              return (
                <Fragment key={a.id}>
                  <tr onClick={() => !modoHistorico && toggle(a.id)}
                    className={`border-t border-white/5 ${modoHistorico ? '' : 'cursor-pointer hover:bg-white/[0.02]'}`}>
                    <td className="py-2 pl-3 pr-2 text-center">
                      {(() => {
                        const pos = rankPorAtivo.get(a.id)
                        return pos
                          ? <span className="inline-flex items-center justify-center"><IconePosicao pos={pos - 1} /></span>
                          : <span style={{ color: MUTED }}>—</span>
                      })()}
                    </td>
                    <td className="py-2 pl-2 pr-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {!modoHistorico && <ChevronDown size={14} style={{ color: MUTED }} className={`shrink-0 transition-transform ${estaAberto ? '' : '-rotate-90'}`} />}
                        <span className="font-semibold text-white">{a.ticker}</span>
                        <span className="text-[11.5px] truncate" style={{ color: MUTED }}>{a.nome}</span>
                        {temErro && <AlertTriangle size={13} style={{ color: '#ffb74d' }} aria-label="Algum mentor falhou" />}
                      </div>
                    </td>
                    {CRITERIOS_QUESTAO.map((cr) => {
                      const v = det?.medias[cr] ?? null
                      return (
                        <td key={cr} className="py-2 px-2 text-center" style={{ color: corNota(v) }}>
                          {v != null ? v.toFixed(1) : '—'}
                        </td>
                      )
                    })}
                    <td className="py-2 px-2 text-center font-bold" style={{ color: corNota(av.nota_final) }}>
                      <div className="flex flex-col items-center leading-none gap-0.5">
                        <span>{av.nota_final ?? '—'}</span>
                        {!modoHistorico && <Tendencia av={av} />}
                      </div>
                    </td>
                    {!modoHistorico && (
                      <td className="py-2 px-2 text-center">
                        {(() => {
                          const nivel = nivelConsensoDe(av)
                          return (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium"
                              title={av.consenso.dispersao != null ? `Dispersão das notas: ${av.consenso.dispersao}` : undefined}
                              style={{ background: `${COR_CONSENSO[nivel]}22`, color: COR_CONSENSO[nivel] }}>
                              {LABEL_CONSENSO[nivel]}
                            </span>
                          )
                        })()}
                      </td>
                    )}
                    {!modoHistorico && (
                      <td className="py-2 px-2 text-center">
                        <button onClick={(e) => { e.stopPropagation(); onReavaliar(a.id) }} disabled={rodando}
                          title="Reavaliar este ativo com os mentores"
                          className="w-7 h-7 rounded-md border border-white/10 inline-flex items-center justify-center hover:border-white/30 disabled:opacity-50" style={{ color: MUTED }}>
                          <RefreshCw size={13} className={rodando ? 'animate-spin' : ''} />
                        </button>
                      </td>
                    )}
                  </tr>
                  {!modoHistorico && estaAberto && det && (
                    <tr className="bg-black/20">
                      <td colSpan={CRITERIOS_QUESTAO.length + 5} className="p-0">
                        <div className="px-3 py-3">
                          <PlanilhaDetalhe avaliacao={av} perguntasTexto={det.perguntas} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  )
}

// ── Planilha de um ativo: perguntas (linhas) × mentores (colunas) ──
function PlanilhaDetalhe({ avaliacao, perguntasTexto }: {
  avaliacao: InvAvaliacao
  perguntasTexto: { id: string; texto: string; criterio: CriterioQuestao }[]
}) {
  const mentores = avaliacao.consenso.mentores
  const mediaPorPergunta = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const p of avaliacao.consenso.perguntas) m.set(p.id, p.media_nota)
    return m
  }, [avaliacao])

  const textoPorId = useMemo(() => {
    const m = new Map<string, { texto: string; criterio: CriterioQuestao }>()
    for (const p of perguntasTexto) m.set(p.id, { texto: p.texto, criterio: p.criterio })
    return m
  }, [perguntasTexto])

  const mentoresOk = mentores.filter((m) => m.erro === null)

  const historico = avaliacao.historico ?? []

  return (
    <>
      {/* Histórico de avaliações — evolução da nota entre reavaliações */}
      {historico.length >= 2 && (
        <div className="mb-3">
          <p className="text-[12px] font-semibold text-white mb-1.5">Histórico de avaliações</p>
          <div className="flex flex-wrap gap-2">
            {historico.slice(-8).map((h, i, arr) => {
              const prev = i > 0 ? arr[i - 1].nota_final : null
              const delta = (prev != null && h.nota_final != null) ? Math.round((h.nota_final - prev) * 10) / 10 : null
              return (
                <span key={`${h.gerado_em}-${i}`} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/10 text-[11.5px]">
                  <span style={{ color: MUTED }}>{new Date(h.gerado_em).toLocaleDateString('pt-BR')}</span>
                  <span className="font-semibold" style={{ color: corNota(h.nota_final) }}>{h.nota_final ?? '—'}</span>
                  {delta != null && delta !== 0 && (
                    <span style={{ color: delta > 0 ? '#00c896' : '#ff5c7a' }}>{delta > 0 ? `+${delta}` : delta}</span>
                  )}
                </span>
              )
            })}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="text-left" style={{ color: MUTED }}>
              <th className="font-medium py-1.5 pr-3 min-w-[260px]">Pergunta</th>
              {mentoresOk.map((m) => (
                <th key={m.config_id} className="font-medium py-1.5 px-2 text-center whitespace-nowrap">
                  {rotuloMentor(m.nome, m.provedor)}
                </th>
              ))}
              <th className="font-medium py-1.5 pl-2 text-center">Média</th>
            </tr>
          </thead>
          <tbody>
            {CRITERIOS_QUESTAO.map((criterio) => {
              const doCriterio = perguntasTexto.filter((p) => p.criterio === criterio)
              if (doCriterio.length === 0) return null
              return (
                <FragmentoCriterio key={criterio} criterio={criterio} perguntas={doCriterio}
                  mentoresOk={mentoresOk} mediaPorPergunta={mediaPorPergunta} textoPorId={textoPorId} />
              )
            })}
            {/* Linha de notas dos mentores */}
            <tr className="border-t border-white/15">
              <td className="py-2 pr-3 font-semibold text-white">Nota do mentor</td>
              {mentoresOk.map((m) => (
                <td key={m.config_id} className="py-2 px-2 text-center font-bold" style={{ color: corNota(m.nota) }}>
                  {m.nota ?? '—'}
                </td>
              ))}
              <td className="py-2 pl-2 text-center font-bold" style={{ color: corNota(avaliacao.nota_final) }}>
                {avaliacao.nota_final ?? '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

function FragmentoCriterio({ criterio, perguntas, mentoresOk, mediaPorPergunta, textoPorId }: {
  criterio: CriterioQuestao
  perguntas: { id: string; texto: string }[]
  mentoresOk: InvAvaliacao['consenso']['mentores']
  mediaPorPergunta: Map<string, number | null>
  textoPorId: Map<string, { texto: string; criterio: CriterioQuestao }>
}) {
  return (
    <>
      <tr>
        <td colSpan={mentoresOk.length + 2} className="pt-3 pb-1 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: '#8b5cf6' }}>
          {CRITERIO_LABEL[criterio]}
        </td>
      </tr>
      {perguntas.map((p) => {
        const texto = textoPorId.get(p.id)?.texto ?? p.texto
        const media = mediaPorPergunta.get(p.id)
        return (
          <tr key={p.id} className="border-t border-white/5">
            <td className="py-1.5 pr-3 text-white/85 align-top">{texto}</td>
            {mentoresOk.map((m) => {
              const idx = m.respostas[p.id]
              return (
                <td key={m.config_id} className="py-1.5 px-2 text-center align-top text-white/70">
                  {Number.isInteger(idx) ? (idx * 2.5).toFixed(1) : '—'}
                </td>
              )
            })}
            <td className="py-1.5 pl-2 text-center align-top font-semibold" style={{ color: corNota(media ?? null) }}>
              {media != null ? media.toFixed(1) : '—'}
            </td>
          </tr>
        )
      })}
    </>
  )
}
