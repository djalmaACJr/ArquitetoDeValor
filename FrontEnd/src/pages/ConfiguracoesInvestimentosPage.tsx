import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, UserCog, Target, ClipboardList, Sparkles, RotateCcw, Save, Wand2,
} from 'lucide-react'
import { useInvPerfil } from '../hooks/useInvPerfil'
import { useInvQuestionarios, type QuestionarioEfetivo } from '../hooks/useInvQuestionarios'
import { useInvestimentosAlocacao, type AlocacaoInput } from '../hooks/useInvestimentosDashboard'
import { Input, BtnSalvar, Toast, SelectDark } from '../components/ui/shared'
import { PERGUNTAS_SUITABILITY, derivarPerfil } from '../lib/perfilInvestidor'
import {
  TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL, TIPO_ATIVO_COR,
  CRITERIOS_QUESTAO, CRITERIO_LABEL, CRITERIO_DESCRICAO,
  PERFIL_INVESTIDOR_LABEL, PERFIL_INVESTIDOR_DESCRICAO, PESOS_SUGERIDOS_POR_PERFIL,
} from '../lib/constants'
import { provedorPorId } from '../lib/iaProvedores'
import type {
  PerfilInvestidor, PerguntaAvaliacao, PesosCriterio,
  TipoAtivoInvestimento, CriterioQuestao,
} from '../types'

const MUTED = '#8b92a8'
const VERDE = '#00c896'
const AMBAR = '#ffb74d'

export default function ConfiguracoesInvestimentosPage() {
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500) }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-5">
        <Link to="/investimentos" className="p-1.5 rounded-lg border border-white/10 hover:border-white/25 text-white">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-[19px] font-semibold text-white">Configurações de Investimentos</h1>
      </div>

      <SecaoPerfil onToast={showToast} />
      <SecaoMetas onToast={showToast} />
      <SecaoQuestionarios onToast={showToast} />

      <Toast msg={toast} />
    </div>
  )
}

// ── wrapper de seção ──────────────────────────────────────────
function Secao({ icone, titulo, subtitulo, children }: {
  icone: React.ReactNode; titulo: string; subtitulo?: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-white/10 p-4 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-white/80">{icone}</span>
        <h2 className="text-[15px] font-semibold text-white">{titulo}</h2>
      </div>
      {subtitulo && <p className="text-[12.5px] mb-3" style={{ color: MUTED }}>{subtitulo}</p>}
      {children}
    </section>
  )
}

// ════════════════════════════════════════════════════════════
// 1) Perfil do investidor
// ════════════════════════════════════════════════════════════
function SecaoPerfil({ onToast }: { onToast: (m: string) => void }) {
  const { perfil, loading, salvar } = useInvPerfil()
  const [idade, setIdade] = useState('')
  const [aposent, setAposent] = useState('')
  const [resp, setResp] = useState<Record<string, number>>({})
  const [salvando, setSalvando] = useState(false)
  const carregado = useRef(false)

  // Carrega o perfil salvo (uma vez quando chegar).
  useEffect(() => {
    if (carregado.current || loading) return
    if (perfil) {
      setIdade(perfil.idade ? String(perfil.idade) : '')
      setAposent(perfil.idade_aposentadoria ? String(perfil.idade_aposentadoria) : '')
      setResp(perfil.suitability ?? {})
    }
    carregado.current = true
  }, [perfil, loading])

  const idadeN = idade ? Number(idade) : null
  const aposentN = aposent ? Number(aposent) : null
  const resultado = useMemo(() => derivarPerfil(resp, idadeN, aposentN), [resp, idadeN, aposentN])
  const respondidas = PERGUNTAS_SUITABILITY.filter((p) => resp[p.id] != null).length

  async function handleSalvar() {
    if (!idadeN || idadeN < 14 || idadeN > 110) { onToast('Informe uma idade válida.'); return }
    if (!aposentN || aposentN <= idadeN || aposentN > 110) { onToast('Idade de aposentadoria deve ser maior que a idade atual.'); return }
    if (respondidas === 0) { onToast('Responda o questionário de perfil.'); return }
    const payload: PerfilInvestidor = {
      perfil: resultado.perfil,
      idade: idadeN,
      idade_aposentadoria: aposentN,
      suitability: resp,
      atualizado_em: new Date().toISOString(),
    }
    setSalvando(true)
    const res = await salvar(payload)
    setSalvando(false)
    onToast(res.ok ? 'Perfil salvo!' : (res.erro ?? 'Erro ao salvar perfil'))
  }

  return (
    <Secao icone={<UserCog size={16} />} titulo="Perfil do investidor"
      subtitulo="Informe sua idade e quando pretende se aposentar e responda o questionário. O perfil é derivado das respostas e do horizonte.">
      <div className="flex flex-wrap gap-3 mb-4">
        <label className="flex-1 min-w-[140px]">
          <span className="block text-[12.5px] mb-1" style={{ color: MUTED }}>Idade atual</span>
          <Input type="number" min={14} max={110} value={idade} onChange={(e) => setIdade(e.target.value)} placeholder="Ex.: 38" />
        </label>
        <label className="flex-1 min-w-[140px]">
          <span className="block text-[12.5px] mb-1" style={{ color: MUTED }}>Idade de aposentadoria</span>
          <Input type="number" min={15} max={110} value={aposent} onChange={(e) => setAposent(e.target.value)} placeholder="Ex.: 60" />
        </label>
      </div>

      <div className="space-y-3">
        {PERGUNTAS_SUITABILITY.map((p) => (
          <div key={p.id} className="space-y-1.5">
            <p className="text-[13px] font-medium text-white">{p.texto}</p>
            <div className="flex flex-wrap gap-1.5">
              {p.opcoes.map((opcao, idx) => {
                const ativa = resp[p.id] === idx
                return (
                  <button key={idx} type="button" onClick={() => setResp({ ...resp, [p.id]: idx })}
                    className={`px-2.5 py-1 rounded-md border text-[12.5px] transition-colors ${
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

      <div className="mt-4 rounded-lg border border-white/10 p-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px]" style={{ color: MUTED }}>{respondidas}/{PERGUNTAS_SUITABILITY.length} respondidas</p>
          <p className="text-[15px] font-bold text-white">Perfil: {PERFIL_INVESTIDOR_LABEL[resultado.perfil]}</p>
          <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>{PERFIL_INVESTIDOR_DESCRICAO[resultado.perfil]}</p>
        </div>
        <BtnSalvar editando onClick={handleSalvar} salvando={salvando} labelSalvar="Salvar perfil" />
      </div>
    </Secao>
  )
}

// ════════════════════════════════════════════════════════════
// 2) Metas de alocação (% ideal por tipo)
// ════════════════════════════════════════════════════════════
function SecaoMetas({ onToast }: { onToast: (m: string) => void }) {
  const { alocacoes, salvar } = useInvestimentosAlocacao()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)

  const valores = useMemo(() => {
    const out: Record<string, string> = {}
    for (const t of TIPOS_ATIVO_INV) {
      if (t in edits) { out[t] = edits[t]; continue }
      const a = alocacoes.find((x) => x.tipo_ativo === t)
      out[t] = a && a.percentual_ideal > 0 ? String(a.percentual_ideal) : ''
    }
    return out
  }, [alocacoes, edits])

  const total = TIPOS_ATIVO_INV.reduce((s, t) => s + (Number(valores[t]) || 0), 0)
  const totalOk = Math.abs(total - 100) < 0.01 || total === 0

  async function handleSalvar() {
    if (!totalOk) { onToast('A soma das metas deve ser 100% (ou tudo zerado para limpar).'); return }
    const itens: AlocacaoInput[] = TIPOS_ATIVO_INV
      .map((t) => ({ tipo_ativo: t, percentual_ideal: Number(valores[t]) || 0 }))
      .filter((x) => x.percentual_ideal > 0)
    setSalvando(true)
    const res = await salvar(itens)
    setSalvando(false)
    onToast(res.ok ? 'Metas de alocação salvas!' : (res.erro ?? 'Erro ao salvar metas'))
  }

  return (
    <Secao icone={<Target size={16} />} titulo="Metas de alocação"
      subtitulo="Defina o % ideal de cada tipo de ativo na carteira (soma 100%). Alimenta a barra “Meta %” e a recomendação de compra.">
      <div className="space-y-2">
        {TIPOS_ATIVO_INV.map((t) => (
          <div key={t} className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[t] }} />
            <span className="flex-1 text-[14px] text-white/85">{TIPO_ATIVO_LABEL[t]}</span>
            <div className="w-28">
              <Input type="number" min={0} max={100} step="any" value={valores[t] ?? ''}
                onChange={(e) => setEdits((v) => ({ ...v, [t]: e.target.value }))} placeholder="0" />
            </div>
            <span className="text-[13px] w-4" style={{ color: MUTED }}>%</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-[13px]">
          <span style={{ color: MUTED }}>Total: </span>
          <span className="font-semibold" style={{ color: totalOk ? VERDE : AMBAR }}>
            {total.toFixed(2).replace('.', ',')}%
          </span>
        </div>
        <BtnSalvar editando onClick={handleSalvar} salvando={salvando} labelSalvar="Salvar metas" />
      </div>
      {!totalOk && (
        <p className="text-[12px] mt-1" style={{ color: AMBAR }}>
          A soma precisa ser 100% (ou deixe tudo em branco/zero para não usar metas).
        </p>
      )}
    </Secao>
  )
}

// ════════════════════════════════════════════════════════════
// 3) Questionários de avaliação por tipo
// ════════════════════════════════════════════════════════════
function SecaoQuestionarios({ onToast }: { onToast: (m: string) => void }) {
  const { perfil } = useInvPerfil()
  const { questionarios, questionarioEfetivo, salvar, excluir, gerarPorIA } = useInvQuestionarios()

  const [tipoSel, setTipoSel] = useState<TipoAtivoInvestimento>('ACOES')
  const [perguntas, setPerguntas] = useState<PerguntaAvaliacao[]>([])
  const [pesos, setPesos] = useState<PesosCriterio>({ FUNDAMENTOS: 40, CRESCIMENTO: 30, DIVIDENDOS: 30 })
  const [info, setInfo] = useState<{ origem: QuestionarioEfetivo['origem']; provedor: string | null; modelo: string | null; custom: boolean }>(
    { origem: 'PADRAO', provedor: null, modelo: null, custom: false })
  const [gerando, setGerando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [pendenteIA, setPendenteIA] = useState<{ provedor: string | null; modelo: string | null } | null>(null)

  const custom = questionarios.find((q) => q.tipo_ativo === tipoSel)
  const loadedSig = useRef<string>('')

  // (Re)carrega o questionário efetivo quando troca o tipo ou quando o custom
  // daquele tipo muda (após salvar/excluir). Não reseta edições não relacionadas.
  useEffect(() => {
    const sig = `${tipoSel}:${custom?.updated_at ?? 'default'}:${perfil?.perfil ?? 'sem'}`
    if (sig === loadedSig.current) return
    loadedSig.current = sig
    const ef = questionarioEfetivo(tipoSel, perfil?.perfil ?? null)
    setPerguntas(ef.perguntas)
    setPesos(ef.pesos)
    setInfo({ origem: ef.origem, provedor: ef.ia_provedor, modelo: ef.ia_modelo, custom: ef.custom })
    setPendenteIA(null)
  }, [tipoSel, custom?.updated_at, perfil?.perfil, questionarioEfetivo, perfil])

  const somaPesos = CRITERIOS_QUESTAO.reduce((s, c) => s + (Number(pesos[c]) || 0), 0)
  const pesosOk = Math.abs(somaPesos - 100) < 0.5

  const porCriterio = useMemo(() => {
    const out: Record<CriterioQuestao, PerguntaAvaliacao[]> = { FUNDAMENTOS: [], CRESCIMENTO: [], DIVIDENDOS: [] }
    for (const p of perguntas) (out[p.criterio] ?? out.FUNDAMENTOS).push(p)
    return out
  }, [perguntas])

  function sugerirPesos() {
    if (!perfil?.perfil) { onToast('Defina o perfil acima para sugerir pesos.'); return }
    setPesos({ ...PESOS_SUGERIDOS_POR_PERFIL[perfil.perfil] })
  }

  async function pedirMentor() {
    setGerando(true)
    const res = await gerarPorIA(tipoSel)
    setGerando(false)
    if (!res.ok || !res.dados) { onToast(res.erro ?? 'Falha ao gerar pelo Mentor'); return }
    setPerguntas(res.dados.perguntas)
    setPesos(res.dados.pesos)
    setPendenteIA({ provedor: res.dados.ia_provedor, modelo: res.dados.ia_modelo })
    setInfo({ origem: 'IA', provedor: res.dados.ia_provedor, modelo: res.dados.ia_modelo, custom: false })
    onToast('Questionário gerado pelo Mentor — revise e salve.')
  }

  async function handleSalvar() {
    if (perguntas.length < 10) { onToast('O questionário precisa de no mínimo 10 questões.'); return }
    if (!pesosOk) { onToast('A soma dos pesos deve ser 100.'); return }
    const ehIA = !!pendenteIA
    setSalvando(true)
    const res = await salvar(tipoSel, {
      perguntas,
      pesos,
      origem: ehIA ? 'IA' : 'MANUAL',
      ia_provedor: ehIA ? pendenteIA!.provedor : null,
      ia_modelo: ehIA ? pendenteIA!.modelo : null,
    })
    setSalvando(false)
    if (res.ok) { setPendenteIA(null); loadedSig.current = ''; onToast('Questionário salvo!') }
    else onToast(res.erro ?? 'Erro ao salvar questionário')
  }

  async function restaurarPadrao() {
    if (!info.custom) { onToast('Este tipo já usa o questionário padrão.'); return }
    const res = await excluir(tipoSel)
    if (res.ok) { loadedSig.current = ''; onToast('Restaurado para o padrão.') }
    else onToast(res.erro ?? 'Erro ao restaurar')
  }

  const editarPergunta = (id: string, patch: Partial<PerguntaAvaliacao>) =>
    setPerguntas((arr) => arr.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const editarOpcao = (id: string, idx: number, val: string) =>
    setPerguntas((arr) => arr.map((p) => {
      if (p.id !== id) return p
      const opcoes = [...p.opcoes] as PerguntaAvaliacao['opcoes']
      opcoes[idx] = val
      return { ...p, opcoes }
    }))

  return (
    <Secao icone={<ClipboardList size={16} />} titulo="Questionários de avaliação"
      subtitulo="Configure o questionário usado para dar nota aos ativos de cada tipo. Sem customização, vale o padrão do app.">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SelectDark value={tipoSel} onChange={(e) => setTipoSel(e.target.value as TipoAtivoInvestimento)}
          style={{ width: 'auto' }} className="!text-[13px] !py-2">
          {TIPOS_ATIVO_INV.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
        </SelectDark>
        <SeloOrigem origem={info.origem} provedor={info.provedor} modelo={info.modelo} />
      </div>

      {/* Pesos por critério */}
      <div className="rounded-lg border border-white/10 p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-medium text-white">Pesos por critério</span>
          <button onClick={sugerirPesos} className="flex items-center gap-1 text-[12px] text-blue-300 hover:text-blue-200">
            <Wand2 size={13} /> Sugerir pelo perfil
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {CRITERIOS_QUESTAO.map((c) => (
            <label key={c} className="flex-1 min-w-[120px]">
              <span className="block text-[12px] mb-1" style={{ color: MUTED }}>{CRITERIO_LABEL[c]}</span>
              <div className="flex items-center gap-1">
                <Input type="number" min={0} max={100} value={String(pesos[c] ?? 0)}
                  onChange={(e) => setPesos((p) => ({ ...p, [c]: Number(e.target.value) || 0 }))} />
                <span className="text-[12px]" style={{ color: MUTED }}>%</span>
              </div>
            </label>
          ))}
        </div>
        <p className="text-[12px] mt-2" style={{ color: pesosOk ? MUTED : AMBAR }}>
          Soma: {somaPesos}% {pesosOk ? '' : '— precisa somar 100'}
        </p>
      </div>

      {/* Perguntas agrupadas por critério (editáveis) */}
      <div className="space-y-4">
        {CRITERIOS_QUESTAO.map((c) => (
          <div key={c}>
            <div className="flex items-baseline gap-2 mb-1.5">
              <h3 className="text-[13.5px] font-semibold text-white">{CRITERIO_LABEL[c]}</h3>
              <span className="text-[11.5px]" style={{ color: MUTED }}>{porCriterio[c].length} questões</span>
            </div>
            <p className="text-[11.5px] mb-2" style={{ color: MUTED }}>{CRITERIO_DESCRICAO[c]}</p>
            <div className="space-y-2">
              {porCriterio[c].map((p) => (
                <div key={p.id} className="rounded-lg border border-white/10 p-2.5">
                  <Input value={p.texto} onChange={(e) => editarPergunta(p.id, { texto: e.target.value })}
                    className="!text-[13px] mb-1.5" />
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
                    {p.opcoes.map((op, idx) => (
                      <Input key={idx} value={op} onChange={(e) => editarOpcao(p.id, idx, e.target.value)}
                        className="!text-[11.5px] !py-1.5" title={`Opção ${idx} (${idx === 0 ? 'pior' : idx === 4 ? 'melhor' : ''})`} />
                    ))}
                  </div>
                </div>
              ))}
              {porCriterio[c].length === 0 && (
                <p className="text-[12px]" style={{ color: AMBAR }}>Nenhuma questão deste critério.</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Ações */}
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/10">
        <button onClick={pedirMentor} disabled={gerando}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#7c5cff,#5b8cff)' }}>
          <Sparkles size={15} className={gerando ? 'animate-pulse' : ''} />
          {gerando ? 'Gerando…' : 'Pedir ao Mentor'}
        </button>
        <button onClick={handleSalvar} disabled={salvando}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] text-white disabled:opacity-50"
          style={{ borderColor: 'rgba(0,200,150,0.5)', color: VERDE }}>
          <Save size={15} /> {salvando ? 'Salvando…' : 'Salvar questionário'}
        </button>
        {info.custom && (
          <button onClick={restaurarPadrao}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
            <RotateCcw size={15} /> Restaurar padrão
          </button>
        )}
        <span className="text-[12px] ml-auto" style={{ color: MUTED }}>{perguntas.length} questões</span>
      </div>
    </Secao>
  )
}

function SeloOrigem({ origem, provedor, modelo }: {
  origem: QuestionarioEfetivo['origem']; provedor: string | null; modelo: string | null
}) {
  if (origem === 'PADRAO') {
    return <span className="text-[11.5px] px-2 py-1 rounded-md bg-white/5 border border-white/10" style={{ color: MUTED }}>Padrão do app</span>
  }
  if (origem === 'IA') {
    const prov = provedor ? (provedorPorId(provedor)?.label ?? provedor) : 'IA'
    return (
      <span className="text-[11.5px] px-2 py-1 rounded-md border" style={{ borderColor: 'rgba(124,92,255,0.5)', color: '#b9a7ff' }}>
        Gerado por {prov}{modelo ? ` · ${modelo}` : ''}
      </span>
    )
  }
  return <span className="text-[11.5px] px-2 py-1 rounded-md border border-white/10 text-white/70">Personalizado</span>
}
