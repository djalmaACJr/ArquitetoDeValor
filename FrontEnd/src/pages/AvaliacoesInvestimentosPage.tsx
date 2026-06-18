import { Fragment, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  ArrowLeft, Sparkles, RefreshCw, Bot, AlertTriangle, Settings, ChevronDown, CheckCircle2,
  Trophy, Medal, ShieldCheck, TrendingUp, Coins, Scale, Star, CalendarClock,
  ArrowUp, ArrowDown, Minus, X, CircleStop, type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useInvAvaliacoes } from '../hooks/useInvAvaliacoes'
import { useInvQuestionarios } from '../hooks/useInvQuestionarios'
import { useInvPerfil } from '../hooks/useInvPerfil'
import { useInvPesos } from '../hooks/useInvPesos'
import { useIAPreferencia } from '../hooks/useIAPreferencia'
import { useMascotePreferido } from '../hooks/useMascotePreferido'
import { useInvAvaliacaoAgenda, FREQUENCIA_LABEL, DIAS_FREQUENCIA } from '../hooks/useInvAvaliacaoAgenda'
import { useLembretes } from '../hooks/useLembretes'
import { provedorPorId } from '../lib/iaProvedores'
import { SelectDark } from '../components/ui/shared'
import Mascote, { type MascoteNome } from '../components/ui/Mascote'
import LoadingMascote from '../components/ui/LoadingMascote'
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

// Aviso de decisão quando uma ou mais IAs são pausadas por erros repetidos.
// Mostra o LOG COMPLETO de execução de cada IA (não só o último erro) e
// deixa o usuário ignorar a IA e concluir, ou esperar e tentar depois.
function AvisoDecisao({ decisao, processando, onIgnorar, onEsperar }: {
  decisao: DecisaoPendente
  processando: boolean
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
            Veja o log completo de execução e decida: ignorar esta(s) IA(s) e concluir agora, ou
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

// Modal com o log individual de execução de um mentor (clicável na lista).
function ModalLogMentor({ nome, log, onClose }: { nome: string; log: LogEntry[]; onClose: () => void }) {
  const erros = log.filter((e) => !e.ok).length
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#141929] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bot size={16} style={{ color: '#8b5cf6' }} />
            <h3 className="text-[14px] font-semibold text-white truncate">Log · {nome}</h3>
            {erros > 0 && <span className="text-[12px]" style={{ color: '#ffb74d' }}>{erros} erro(s)</span>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/30" style={{ color: MUTED }}>
            <X size={14} />
          </button>
        </div>
        {log.length === 0 ? (
          <p className="text-[13px]" style={{ color: MUTED }}>Sem execução registrada nesta rodada.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto space-y-1 text-[12.5px] font-mono">
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
  )
}

// Progresso de um mentor durante a avaliação (1 barra por mentor).
interface ProgMentor {
  configId: string; nome: string; feito: number; total: number; erros: number
  abortado?: boolean
  /** Interrompido manualmente pelo usuário (só este mentor). */
  parado?: boolean
  /** Segundos restantes até a próxima tentativa automática (backoff). */
  aguardandoSeg?: number
}

// Botão (abaixo do mentor) para interromper SÓ aquele mentor durante a rodada.
function BotaoPararMentor({ onParar }: { onParar: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onParar() }}
      title="Parar este mentor (não afeta os demais)"
      className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
      style={{ borderColor: 'rgba(255,92,122,0.4)', color: '#ff5c7a', background: 'rgba(255,92,122,0.1)' }}>
      <CircleStop size={11} /> Parar
    </button>
  )
}

// Barra de progresso de um mentor — exibida logo abaixo do mascote dele.
function BarraMentor({ prog }: { prog?: ProgMentor }) {
  if (!prog) return null
  const pct = prog.total > 0 ? Math.round((prog.feito / prog.total) * 100) : 0
  const completo = prog.feito >= prog.total
  const aguardando = prog.aguardandoSeg != null && prog.aguardandoSeg > 0
  const interrompido = prog.parado || prog.abortado
  const cor = interrompido ? '#ff5c7a' : aguardando ? '#ffb74d' : completo ? '#00c896' : '#8b5cf6'
  return (
    <div className="w-full mt-1.5">
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full transition-all ${aguardando ? 'animate-pulse' : ''}`} style={{ width: `${pct}%`, background: cor }} />
      </div>
      <div className="text-[10.5px] mt-0.5 text-center" style={{ color: interrompido ? '#ff5c7a' : aguardando ? '#ffb74d' : MUTED }}>
        {aguardando ? `Nova tentativa em ${prog.aguardandoSeg}s`
          : prog.parado ? 'Parado'
          : prog.abortado ? 'Cancelado'
          : `${prog.feito}/${prog.total}`}
        {!aguardando && prog.erros > 0 && <span style={{ color: '#ffb74d' }}> · {prog.erros} erro(s)</span>}
      </div>
    </div>
  )
}

export default function AvaliacoesInvestimentosPage() {
  const { configs, ativa, carregando: carregandoIA } = useIAPreferencia()
  const { mascote } = useMascotePreferido()
  const { ativos, loading: loadingAtivos } = useInvestimentosAtivos()
  const { avaliacoes, loading: loadingAval, avaliarMentorAtivo, salvarAvaliacao, concluir } = useInvAvaliacoes()
  const { questionarioEfetivo } = useInvQuestionarios()
  const { perfil } = useInvPerfil()
  const { pesos: pesosGlobais } = useInvPesos()
  const { frequencia, salvar: salvarAgenda } = useInvAvaliacaoAgenda()
  // Todos os lembretes — o agendamento vira um lembrete (aparece no calendário).
  const { lembretes: todosLembretes, criar: criarLembrete, editar: editarLembrete, excluir: excluirLembrete } = useLembretes({})

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
  // Mentores que o usuário pediu para PARAR no meio da rodada (só eles).
  // Ref (não estado) p/ os loops assíncronos lerem o valor mais recente.
  const pararMentoresRef = useRef<Set<string>>(new Set())
  const pararMentor = (configId: string) => {
    pararMentoresRef.current.add(configId)
    setProgMentores((prev) => prev?.map((p) =>
      p.configId === configId ? { ...p, parado: true, aguardandoSeg: undefined } : p) ?? prev)
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

  // Ativos ainda SEM avaliação salva — base para "continuar" (retomar) após
  // um erro: a avaliação só persiste por ativo ao final, então os já salvos
  // são pulados e o processo retoma de onde parou.
  const pendentes = useMemo(() => ativos.filter((a) => !avalPorAtivo.has(a.id)), [ativos, avalPorAtivo])

  // Mentores que vão de fato fazer a busca (não desativados pelo usuário).
  const configsAtivos = useMemo(() => configs.filter((c) => !mentoresDesativados.has(c.id)), [configs, mentoresDesativados])

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

  // Nº de erros seguidos de uma IA que dispara a pausa daquela IA, e a
  // política de novas tentativas automáticas (backoff) antes de desistir.
  const LIMITE_ERROS_SEGUIDOS = 3
  const ESPERAS_SEG = [20, 45]          // backoff por ciclo de retentativa
  const MAX_CICLOS_RETRY = ESPERAS_SEG.length

  // Espera com contagem regressiva visível na barra do mentor.
  async function esperarCountdown(configId: string, segundos: number) {
    for (let s = segundos; s > 0; s--) {
      if (pararMentoresRef.current.has(configId)) break  // parado: aborta a espera
      setProgMentores((prev) => prev?.map((p) => p.configId === configId ? { ...p, aguardandoSeg: s } : p) ?? prev)
      await sleep(1000)
    }
    setProgMentores((prev) => prev?.map((p) => p.configId === configId ? { ...p, aguardandoSeg: undefined } : p) ?? prev)
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
      if (res.ok) { salvos++; jaAvaliados.add(a.id) }
      else errosSalvar++
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

  // Avalia uma lista de ativos. Cada MENTOR roda em paralelo (loop próprio
  // sobre os ativos, com barra de progresso individual). Uma IA que acumula
  // erros seguidos é PAUSADA (não é martelada nos demais ativos) e a rodada
  // espera o usuário decidir o que fazer. Sem pausas, consolida e persiste.
  async function avaliar(lista: InvestimentoAtivo[]) {
    if (rodando || pendenteDecisao || lista.length === 0 || configsAtivos.length === 0) return
    setRodando(true)
    setSalvandoFase(false)
    setResumo(null)
    setPendenteDecisao(null)
    setRoundSelecionado(null)
    decisaoRef.current = null
    pararMentoresRef.current = new Set()
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
      const registrarLog = () => setLogsMentor((prev) => ({ ...prev, [c.id]: [...log] }))
      const atualizarProg = () => {
        const erros = [...atribuidos.values()].filter((x) => x.erro).length
        setProgMentores((prev) => prev?.map((p) => p.configId === c.id ? { ...p, feito: tentados.size, erros } : p) ?? prev)
      }

      let fila = [...lista]
      let ciclo = 0
      let abortou = false
      let parado = false
      while (fila.length > 0) {
        if (pararMentoresRef.current.has(c.id)) { parado = true; break }
        const aindaFalhou: InvestimentoAtivo[] = []
        let consecutivos = 0
        for (let idx = 0; idx < fila.length; idx++) {
          if (pararMentoresRef.current.has(c.id)) { parado = true; break }
          const a = fila[idx]
          const ef = efPorAtivo.get(a.id)!
          const res = await avaliarMentorAtivo(a.id, c.id, ef.perguntas, ef.pesos)
          const r: InvAvaliacaoMentor = res.ok && res.dados
            ? res.dados
            : { config_id: c.id, nome: c.nome ?? null, provedor: c.provedor, modelo: c.modelo ?? null, nota: null, respostas: {}, erro: res.erro ?? 'falha' }
          atribuidos.set(a.id, r)
          tentados.add(a.id)
          log.push({
            ticker: ciclo > 0 ? `${a.ticker} (tentativa ${ciclo + 1})` : a.ticker,
            ok: !r.erro,
            erro: r.erro ?? undefined,
            nota: r.erro ? undefined : r.nota,
            respostas: r.erro ? undefined : Object.keys(r.respostas ?? {}).length,
          })
          registrarLog()
          atualizarProg()
          if (r.erro) { aindaFalhou.push(a); consecutivos++ } else consecutivos = 0
          if (consecutivos >= LIMITE_ERROS_SEGUIDOS) {
            for (let j = idx + 1; j < fila.length; j++) aindaFalhou.push(fila[j])
            break
          }
        }
        if (parado) break                    // interrompido manualmente
        if (aindaFalhou.length === 0) break  // mentor concluiu sem pendências
        ciclo++
        if (ciclo > MAX_CICLOS_RETRY) { abortou = true; break }
        const seg = ESPERAS_SEG[Math.min(ciclo - 1, ESPERAS_SEG.length - 1)]
        log.push({ ticker: '—', ok: false, erro: `Pausada após erros — nova tentativa em ${seg}s (${ciclo + 1}ª de ${MAX_CICLOS_RETRY + 1}).` })
        registrarLog()
        await esperarCountdown(c.id, seg)
        fila = aindaFalhou
      }

      // Resultados finais deste mentor (1 por ativo tentado) → mapa compartilhado.
      for (const [aid, r] of atribuidos) {
        const arr = resultadosPorAtivo.get(aid) ?? []
        arr.push(r)
        resultadosPorAtivo.set(aid, arr)
      }
      if (parado) {
        // Interrompido pelo usuário: NÃO entra no fluxo de decisão (abortados).
        // Mantém os resultados parciais já coletados e segue a rodada.
        log.push({ ticker: '—', ok: false, erro: 'Interrompido pelo usuário (parado).' })
        registrarLog()
        setProgMentores((prev) => prev?.map((p) => p.configId === c.id ? { ...p, parado: true, aguardandoSeg: undefined } : p) ?? prev)
      } else if (abortou) {
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

  if (carregandoIA || loadingAtivos || loadingAval) return <LoadingMascote />

  // Gating: precisa de ≥1 mentor configurado.
  const semMentor = configs.length === 0

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link to="/investimentos/ativos" className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
          <ArrowLeft size={15} />
        </Link>
        <div>
          <h1 className="text-[22px] font-bold text-white">Avaliações</h1>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
            Seus mentores (IAs) avaliam cada ativo; a nota de cada questão consolida as IAs (média/mediana) e a nota final é a média ponderada dos critérios
          </p>
        </div>
      </div>

      {/* Ranking dos ativos — topo da página */}
      {dadosRank.length > 0 && <RankingTopo dados={dadosRank} />}

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
          {/* Botão avaliar — à esquerda. Avalia só os PENDENTES (retoma de
              onde parou após erro). "Reavaliar tudo" força a carteira inteira. */}
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            <button onClick={() => avaliar(pendentes)} disabled={rodando || !!pendenteDecisao || pendentes.length === 0 || configsAtivos.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: '#8b5cf6' }}>
              <Sparkles size={15} className={rodando ? 'animate-pulse' : ''} />
              {rodando ? 'Avaliando…'
                : avaliacoes.length > 0
                  ? `Continuar avaliação (${pendentes.length} restante${pendentes.length === 1 ? '' : 's'})`
                  : 'Avaliar carteira com os mentores'}
            </button>
            {avaliacoes.length > 0 && (
              <button onClick={() => avaliar(ativos)} disabled={rodando || !!pendenteDecisao || configsAtivos.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border border-white/15 text-white/90 hover:border-white/30 disabled:opacity-50">
                <RefreshCw size={14} className={rodando ? 'animate-spin' : ''} /> Reavaliar tudo
              </button>
            )}
          </div>

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
              onIgnorar={() => finalizarDecisao('ignorar')}
              onEsperar={() => finalizarDecisao('esperar')} />
          )}

          {/* Agenda de reavaliação — frequência definida pelo usuário */}
          <section className={`rounded-xl border px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap ${
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
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-4">
            <h2 className="text-[13px] font-semibold text-white mb-4">
              Mentores ({configs.length})
            </h2>

            {(() => {
              const ativoCfg = ativa ?? configs[0]
              const outros = configs.filter((c) => c.id !== ativoCfg?.id)
              const progPorConfig = new Map((progMentores ?? []).map((p) => [p.configId, p]))
              // Mentor "parável": rodando e ainda em andamento (não parado/cancelado/concluído).
              const podeParar = (id: string) => {
                const p = progPorConfig.get(id)
                return rodando && !!p && !p.parado && !p.abortado && p.feito < p.total
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
                    <Mascote nome={mascote} pose="comprimento-inicio"
                      className={`!h-[120px] !w-auto ${ativoCfg && mentoresDesativados.has(ativoCfg.id) ? 'opacity-30 grayscale' : ''}`} />
                    <span className="mt-1 text-[13px] font-semibold text-white text-center">
                      {ativoCfg ? rotuloMentor(ativoCfg.nome ?? null, ativoCfg.provedor) : '—'}
                    </span>
                    <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}>
                      <Sparkles size={11} /> Orquestrador
                    </span>
                    {ativoCfg && <BarraMentor prog={progPorConfig.get(ativoCfg.id)} />}
                    {ativoCfg && podeParar(ativoCfg.id)
                      ? <BotaoPararMentor onParar={() => pararMentor(ativoCfg.id)} />
                      : ativoCfg && <BotaoMentorAtivo ativo={!mentoresDesativados.has(ativoCfg.id)} desabilitado={rodando || !!pendenteDecisao}
                          onToggle={() => toggleMentorAtivo(ativoCfg.id)} />}
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
                            <Mascote nome={mascoteSecundario(i, mascote)} pose="sentado"
                              className={`!h-[120px] !w-auto ${mentoresDesativados.has(c.id) ? 'opacity-30 grayscale' : ''}`} />
                            <span className="mt-1 text-[12px] font-medium text-white/90 text-center leading-tight">
                              {rotuloMentor(c.nome ?? null, c.provedor)}
                            </span>
                            {c.modelo && (
                              <span className="text-[11px] text-center" style={{ color: MUTED }}>{c.modelo}</span>
                            )}
                            <BarraMentor prog={progPorConfig.get(c.id)} />
                            {podeParar(c.id)
                              ? <BotaoPararMentor onParar={() => pararMentor(c.id)} />
                              : <BotaoMentorAtivo ativo={!mentoresDesativados.has(c.id)} desabilitado={rodando || !!pendenteDecisao}
                                  onToggle={() => toggleMentorAtivo(c.id)} />}
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
                  rodando={rodando} onReavaliar={(id) => avaliar([ativoPorId.get(id)!])} />
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

  return (
    <div>
      {/* Cabeçalho do tipo — clicável para colapsar/expandir o grupo. */}
      <button onClick={() => setGrupoAberto((o) => !o)} className="w-full flex items-center gap-2 mb-2 text-left">
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

      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-x-auto">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr style={{ color: MUTED }}>
              <th className="font-medium py-2 pl-3 pr-2 text-left min-w-[200px]">Ativo</th>
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
                    <td className="py-2 pl-3 pr-2">
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
                      <td colSpan={CRITERIOS_QUESTAO.length + 4} className="p-0">
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
