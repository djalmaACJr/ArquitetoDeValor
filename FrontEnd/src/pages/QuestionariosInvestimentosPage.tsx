import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ClipboardList, Sparkles, RotateCcw, Save, Eraser, AlertTriangle, Plus, Trash2,
} from 'lucide-react'
import { useInvPerfil } from '../hooks/useInvPerfil'
import { useInvPesos } from '../hooks/useInvPesos'
import { useInvQuestionarios, type QuestionarioEfetivo } from '../hooks/useInvQuestionarios'
import { useInvestimentosAlocacao } from '../hooks/useInvestimentosDashboard'
import { useMascotePreferido } from '../hooks/useMascotePreferido'
import { Input, ModalExcluir, Toast } from '../components/ui/shared'
import Mascote from '../components/ui/Mascote'
import {
  TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL, CRITERIOS_QUESTAO, CRITERIO_LABEL, CRITERIO_DESCRICAO,
  CATEGORIAS_FII, FII_CATEGORIA_INFO,
} from '../lib/constants'
import { provedorPorId } from '../lib/iaProvedores'
import type { PerguntaAvaliacao, PesosCriterio, TipoAtivoInvestimento, CriterioQuestao, CategoriaFII } from '../types'

// '' representa o questionário GENÉRICO de FII (vale p/ qualquer categoria
// sem override específico) — mostrado como uma "categoria" a mais na aba.
const CATEGORIA_FII_GENERICA = '' as const
type CategoriaFIISel = CategoriaFII | typeof CATEGORIA_FII_GENERICA

const MUTED = '#8b92a8'
const VERDE = '#00c896'
const AMBAR = '#ffb74d'

// Garante ids únicos e não-vazios nas perguntas. A IA (e questionários
// antigos) podem trazer ids repetidos/ausentes — isso quebra a `key` do React,
// fazendo a exclusão/edição agir na linha errada (a pergunta "não some" da tela).
function comIdsUnicos(perguntas: PerguntaAvaliacao[]): PerguntaAvaliacao[] {
  const vistos = new Set<string>()
  return perguntas.map((p, i) => {
    let id = (p.id ?? '').trim() || `q${i}`
    if (vistos.has(id)) {
      let n = 2
      while (vistos.has(`${id}_${n}`)) n++
      id = `${id}_${n}`
    }
    vistos.add(id)
    return id === p.id ? p : { ...p, id }
  })
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

// Página dedicada aos questionários de avaliação — antes vivia como uma seção
// (grande, com abas de tipo/critério e editor de perguntas) dentro de
// Configurações de Investimentos; virou página própria pra não sobrecarregar
// aquela tela, que agora só mostra um card explicativo com um botão de acesso.
export default function QuestionariosInvestimentosPage() {
  const navigate = useNavigate()
  const [toast, setToast] = useState<string | null>(null)
  const onToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500) }

  const { perfil } = useInvPerfil()
  const { pesos: pesosGlobais } = useInvPesos()
  const { questionarios, questionarioEfetivo, salvar, excluir, gerarPorIA } = useInvQuestionarios()
  const { alocacoes } = useInvestimentosAlocacao()
  const { mascote } = useMascotePreferido()

  // Abas: só tipos com Meta de alocação > 0% (um questionário por item alocado).
  const tiposAlocados = useMemo(
    () => TIPOS_ATIVO_INV.filter((t) => (alocacoes.find((a) => a.tipo_ativo === t)?.percentual_ideal ?? 0) > 0),
    [alocacoes],
  )

  const [tipoSel, setTipoSel] = useState<TipoAtivoInvestimento>('ACOES')
  // Mantém a aba ativa dentro dos tipos alocados quando a lista carrega/muda
  // (derived-state-on-change, reconcilia só quando o conjunto de tipos muda).
  const [tiposSig, setTiposSig] = useState('')
  const sigTipos = tiposAlocados.join(',')
  if (sigTipos !== tiposSig) {
    setTiposSig(sigTipos)
    if (tiposAlocados.length > 0 && !tiposAlocados.includes(tipoSel)) setTipoSel(tiposAlocados[0])
  }
  // Sub-aba de categoria — só existe/importa quando tipoSel === 'FII' (um FII
  // de Papel e um de Tijolo têm riscos opostos, então cada categoria tem seu
  // próprio questionário). '' = genérico (vale p/ categoria sem override).
  const [categoriaSel, setCategoriaSel] = useState<CategoriaFIISel>(CATEGORIA_FII_GENERICA)
  const categoriaEfetiva: CategoriaFIISel = tipoSel === 'FII' ? categoriaSel : CATEGORIA_FII_GENERICA
  const [perguntas, setPerguntas] = useState<PerguntaAvaliacao[]>([])
  const [info, setInfo] = useState<{ origem: QuestionarioEfetivo['origem']; provedor: string | null; modelo: string | null; custom: boolean }>(
    { origem: 'PADRAO', provedor: null, modelo: null, custom: false })
  const [gerando, setGerando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [pendenteIA, setPendenteIA] = useState<{ provedor: string | null; modelo: string | null } | null>(null)
  const [erroIA, setErroIA] = useState<string | null>(null)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [perguntaExcluir, setPerguntaExcluir] = useState<PerguntaAvaliacao | null>(null)
  const [confirmarLimpar, setConfirmarLimpar] = useState(false)
  const [criterioSel, setCriterioSel] = useState<CriterioQuestao>('FUNDAMENTOS')

  const custom = questionarios.find((q) => q.tipo_ativo === tipoSel && q.fii_categoria === categoriaEfetiva)

  // (Re)carrega apenas as PERGUNTAS quando troca o tipo/categoria ou quando o
  // custom daquela combinação muda (derived-state-on-change, sync no render).
  // Os pesos são globais e não dependem da aba. Resetar `loadedSig` para ''
  // força recarga.
  const [loadedSig, setLoadedSig] = useState('')
  const sigCarga = `${tipoSel}:${categoriaEfetiva}:${custom?.updated_at ?? 'default'}:${perfil?.perfil ?? 'sem'}`
  if (sigCarga !== loadedSig) {
    setLoadedSig(sigCarga)
    const ef = questionarioEfetivo(tipoSel, perfil?.perfil ?? null, undefined, categoriaEfetiva || null)
    setPerguntas(comIdsUnicos(ef.perguntas))
    setInfo({ origem: ef.origem, provedor: ef.ia_provedor, modelo: ef.ia_modelo, custom: ef.custom })
    setPendenteIA(null)
    setErroIA(null)
    setErroSalvar(null)
  }

  // Pesos são globais (editados em Configurações); aqui só validamos a soma.
  const pesosOk = Math.abs(CRITERIOS_QUESTAO.reduce((s, c) => s + (Number(pesosGlobais[c]) || 0), 0) - 100) < 0.5

  const porCriterio = useMemo(() => {
    const out = Object.fromEntries(
      CRITERIOS_QUESTAO.map((c) => [c, [] as PerguntaAvaliacao[]]),
    ) as Record<CriterioQuestao, PerguntaAvaliacao[]>
    for (const p of perguntas) (out[p.criterio] ?? out.FUNDAMENTOS).push(p)
    return out
  }, [perguntas])

  async function pedirMentor() {
    setGerando(true)
    setErroIA(null)
    try {
      const res = await gerarPorIA(tipoSel, categoriaEfetiva)
      if (!res.ok || !res.dados) {
        const msg = res.erro ?? 'Falha ao gerar pelo Mentor. Tente novamente.'
        setErroIA(msg); onToast(msg); return
      }
      setPerguntas(comIdsUnicos(res.dados.perguntas))
      setPendenteIA({ provedor: res.dados.ia_provedor, modelo: res.dados.ia_modelo })
      setInfo({ origem: 'IA', provedor: res.dados.ia_provedor, modelo: res.dados.ia_modelo, custom: false })
      onToast('Questionário gerado pelo Mentor — revise e salve.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro inesperado ao falar com o Mentor.'
      setErroIA(msg); onToast(msg)
    } finally {
      setGerando(false)
    }
  }

  async function handleSalvar() {
    setErroSalvar(null)
    if (perguntas.length < 10) { const m = 'O questionário precisa de no mínimo 10 questões.'; setErroSalvar(m); onToast(m); return }
    if (!pesosOk) { const m = 'Ajuste os “Pesos por critério” em Configurações para somarem 100% antes de salvar.'; setErroSalvar(m); onToast(m); return }
    // Garante as 4 chaves de peso (preenche faltantes com 0) — o backend rejeita
    // pesos sem algum critério (ex.: VALUATION ausente em config antiga).
    const pesosPayload = Object.fromEntries(
      CRITERIOS_QUESTAO.map((c) => [c, Number(pesosGlobais[c]) || 0]),
    ) as PesosCriterio
    const ehIA = !!pendenteIA
    setSalvando(true)
    const res = await salvar(tipoSel, {
      perguntas,
      pesos: pesosPayload,
      origem: ehIA ? 'IA' : 'MANUAL',
      ia_provedor: ehIA ? pendenteIA!.provedor : null,
      ia_modelo: ehIA ? pendenteIA!.modelo : null,
    }, categoriaEfetiva)
    setSalvando(false)
    if (res.ok) { setPendenteIA(null); setErroSalvar(null); setLoadedSig(''); onToast('Questionário salvo!') }
    else { const m = res.erro ?? 'Erro ao salvar questionário'; setErroSalvar(m); onToast(m) }
  }

  async function restaurarPadrao() {
    if (!info.custom) { onToast('Este tipo já usa o questionário padrão.'); return }
    const res = await excluir(tipoSel, categoriaEfetiva)
    if (res.ok) { setLoadedSig(''); onToast('Restaurado para o padrão.') }
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
  // Cria uma pergunta vazia no critério (o usuário preenche enunciado/opções).
  const adicionarPergunta = (criterio: CriterioQuestao) =>
    setPerguntas((arr) => [...arr, {
      id: `q_${criterio.slice(0, 4).toLowerCase()}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      criterio,
      texto: '',
      opcoes: ['', '', '', '', ''],
    }])
  const removerPergunta = (id: string) =>
    setPerguntas((arr) => arr.filter((x) => x.id !== id))
  // Limpa TODAS as perguntas do questionário do tipo visível (começar do zero).
  const limparQuestionario = () => { setPerguntas([]); setConfirmarLimpar(false) }

  const voltar = () => navigate('/investimentos/configuracoes')

  return (
    <div className="p-5">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={voltar} title="Voltar para Configurações"
          className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
          <ArrowLeft size={15} />
        </button>
        <div className="flex items-center gap-2">
          <ClipboardList size={18} style={{ color: '#7da9ff' }} />
          <div>
            <h1 className="text-[19px] font-semibold text-white">Questionários de avaliação</h1>
            <p className="text-[12.5px]" style={{ color: MUTED }}>Configurações de Investimentos</p>
          </div>
        </div>
      </div>

      {/* Sem nenhum tipo alocado não há aba para mostrar — orienta a definir metas. */}
      {tiposAlocados.length === 0 ? (
        <div className="rounded-xl border border-white/10 p-4">
          <p className="text-[12.5px]" style={{ color: AMBAR }}>
            Nenhum tipo de ativo com Meta de alocação definida. Informe os percentuais em “Metas de alocação”, em Configurações, para habilitar os questionários.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 p-4">
          <p className="text-[12.5px] mb-3" style={{ color: MUTED }}>
            Cada tipo de ativo tem o SEU próprio questionário — e para FII, cada CATEGORIA também (um fundo de Papel não tem os mesmos riscos de um de Tijolo). As perguntas são separadas por critério (em abas) e cada resposta vale de 0 (pior) a 4 (melhor); a nota final do ativo é a média ponderada pelos “Pesos por critério” definidos em Configurações. Edite/crie as perguntas à mão ou peça ao Mentor (IA) gerar 40 questões (10 por critério).
          </p>
          {/* Cabeçalho fixo (sticky): tipo, ações (Salvar no topo) e critérios — sempre visível ao rolar */}
          <div className="sticky top-0 z-10 -mx-4 px-4 pt-1 pb-2 border-b border-white/10" style={{ background: 'var(--bg-page, #0d1220)' }}>
            <p className="text-[12px] mb-1.5" style={{ color: MUTED }}>Tipo de ativo (cada um tem o seu questionário):</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tiposAlocados.map((t) => {
                const ativo = t === tipoSel
                return (
                  <button key={t} type="button" onClick={() => setTipoSel(t)}
                    className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors ${
                      ativo ? 'border-blue-400/60 bg-blue-500/15 text-white' : 'border-white/10 text-white/70 hover:border-white/25'
                    }`}>
                    {TIPO_ATIVO_LABEL[t]}
                  </button>
                )
              })}
            </div>

            {/* Sub-abas de CATEGORIA — só para FII, que tem riscos bem diferentes
                entre Tijolo/Papel/FoF/Desenvolvimento/FIAGRO. "Genérico" vale para
                qualquer categoria sem um questionário mais específico salvo. */}
            {tipoSel === 'FII' && (
              <div className="mb-2">
                <p className="text-[11.5px] mb-1.5" style={{ color: MUTED }}>
                  Categoria do FII (cada uma pode ter o seu questionário; sem uma específica, usa o Genérico):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {([CATEGORIA_FII_GENERICA, ...CATEGORIAS_FII] as CategoriaFIISel[]).map((cat) => {
                    const ativo = cat === categoriaSel
                    const label = cat === CATEGORIA_FII_GENERICA ? 'Genérico (todas)' : FII_CATEGORIA_INFO[cat].label
                    const temCustom = questionarios.some((q) => q.tipo_ativo === 'FII' && q.fii_categoria === cat)
                    return (
                      <button key={cat || 'generico'} type="button" onClick={() => setCategoriaSel(cat)}
                        className={`px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors ${
                          ativo ? 'border-purple-400/60 bg-purple-500/15 text-white' : 'border-white/10 text-white/70 hover:border-white/25'
                        }`}>
                        {label}{temCustom && <span className="ml-1" style={{ color: '#b9a7ff' }} title="Tem questionário personalizado">●</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Título do questionário visível */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h3 className="text-[15px] font-semibold text-white">
                Questionário de <span style={{ color: '#7da9ff' }}>{TIPO_ATIVO_LABEL[tipoSel]}</span>
                {tipoSel === 'FII' && (
                  <span style={{ color: MUTED }}> — {categoriaSel === CATEGORIA_FII_GENERICA ? 'Genérico' : FII_CATEGORIA_INFO[categoriaSel].label}</span>
                )}
              </h3>
              <SeloOrigem origem={info.origem} provedor={info.provedor} modelo={info.modelo} />
              <span className="text-[12px]" style={{ color: MUTED }}>{perguntas.length} questões</span>
            </div>

            {/* Mentor (IA) — com a imagem do mascote escolhido ao lado do botão */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Mascote nome={mascote} pose="feliz" size={40} />
              <button onClick={pedirMentor} disabled={gerando}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#7c5cff,#5b8cff)' }}>
                <Sparkles size={15} className={gerando ? 'animate-pulse' : ''} />
                {gerando ? 'Gerando…' : `Pedir ao Mentor (${TIPO_ATIVO_LABEL[tipoSel]}${tipoSel === 'FII' && categoriaSel ? ` — ${FII_CATEGORIA_INFO[categoriaSel].label}` : ''})`}
              </button>
              {gerando && <span className="text-[11.5px]" style={{ color: MUTED }}>Gerando 40 questões — pode levar alguns segundos…</span>}
            </div>

            {/* Ações abaixo do Mentor, à esquerda */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <button onClick={handleSalvar} disabled={salvando}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[13px] text-white disabled:opacity-50"
                style={{ borderColor: 'rgba(0,200,150,0.5)', color: VERDE }}>
                <Save size={15} /> {salvando ? 'Salvando…' : 'Salvar questionário'}
              </button>
              <button onClick={() => setConfirmarLimpar(true)} disabled={perguntas.length === 0}
                title="Remover todas as perguntas do questionário visível"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25 disabled:opacity-40">
                <Eraser size={15} /> Limpar
              </button>
              {info.custom && (
                <button onClick={restaurarPadrao}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
                  <RotateCcw size={15} /> Restaurar padrão
                </button>
              )}
            </div>

            {/* Critérios em abas — mostra um critério por vez */}
            <div className="flex flex-wrap gap-1.5">
              {CRITERIOS_QUESTAO.map((c) => {
                const ativo = c === criterioSel
                return (
                  <button key={c} type="button" onClick={() => setCriterioSel(c)}
                    className={`px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors ${
                      ativo ? 'border-blue-400/60 bg-blue-500/15 text-white' : 'border-white/10 text-white/70 hover:border-white/25'
                    }`}>
                    {CRITERIO_LABEL[c]} <span style={{ color: MUTED }}>({porCriterio[c].length})</span>
                  </button>
                )
              })}
            </div>
          </div>

          {erroIA && (
            <div className="flex items-start gap-1.5 mt-3 rounded-lg border p-2.5 text-[12px]"
              style={{ borderColor: 'rgba(255,107,107,0.4)', background: 'rgba(255,107,107,0.08)', color: '#ffb3b3' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{erroIA} <Link to="/perfil" className="underline hover:text-white">Abrir Integração com IA</Link></span>
            </div>
          )}
          {erroSalvar && (
            <div className="flex items-start gap-1.5 mt-3 rounded-lg border p-2.5 text-[12px]"
              style={{ borderColor: 'rgba(255,107,107,0.4)', background: 'rgba(255,107,107,0.08)', color: '#ffb3b3' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>Não foi possível salvar: {erroSalvar}</span>
            </div>
          )}

          {/* Perguntas do critério selecionado (aba) */}
          <div className="mt-3">
            <p className="text-[11.5px] mb-2" style={{ color: MUTED }}>{CRITERIO_DESCRICAO[criterioSel]}</p>
            <div className="space-y-2">
              {porCriterio[criterioSel].map((p) => (
                <div key={p.id} className="rounded-lg border border-white/10 p-2.5">
                  <div className="flex items-start gap-1.5 mb-1.5">
                    <Input value={p.texto} onChange={(e) => editarPergunta(p.id, { texto: e.target.value })}
                      placeholder="Enunciado da pergunta…" className="!text-[13px] flex-1" />
                    <button type="button" onClick={() => setPerguntaExcluir(p)} title="Remover pergunta"
                      className="shrink-0 p-2 rounded-lg border border-white/10 text-white/60 hover:text-red-300 hover:border-red-400/40">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
                    {p.opcoes.map((op, idx) => (
                      <Input key={idx} value={op} onChange={(e) => editarOpcao(p.id, idx, e.target.value)}
                        placeholder={idx === 0 ? 'pior' : idx === 4 ? 'melhor' : `opção ${idx}`}
                        className="!text-[11.5px] !py-1.5" title={`Opção ${idx} (${idx === 0 ? 'pior' : idx === 4 ? 'melhor' : ''})`} />
                    ))}
                  </div>
                </div>
              ))}
              {porCriterio[criterioSel].length === 0 && (
                <p className="text-[12px]" style={{ color: AMBAR }}>Nenhuma questão deste critério ainda. Use “Adicionar pergunta” ou peça ao Mentor.</p>
              )}
              <button type="button" onClick={() => adicionarPergunta(criterioSel)}
                className="flex items-center gap-1.5 text-[12.5px] text-blue-300 hover:text-blue-200 mt-1">
                <Plus size={14} /> Adicionar pergunta
              </button>
            </div>
          </div>

          {perguntaExcluir && (
            <ModalExcluir
              nome={perguntaExcluir.texto?.trim() ? perguntaExcluir.texto.trim().slice(0, 60) : 'pergunta sem título'}
              mensagem="A pergunta será removida do editor. Clique em “Salvar questionário” para confirmar a alteração."
              salvando={false}
              onConfirmar={() => { removerPergunta(perguntaExcluir.id); setPerguntaExcluir(null) }}
              onCancelar={() => setPerguntaExcluir(null)}
            />
          )}
          {confirmarLimpar && (
            <ModalExcluir
              nome={`questionário de ${TIPO_ATIVO_LABEL[tipoSel]}`}
              mensagem="Todas as perguntas (de todos os critérios) serão removidas do editor. Clique em “Salvar questionário” depois para confirmar a alteração."
              salvando={false}
              onConfirmar={limparQuestionario}
              onCancelar={() => setConfirmarLimpar(false)}
            />
          )}
        </div>
      )}

      <Toast msg={toast} />
    </div>
  )
}
