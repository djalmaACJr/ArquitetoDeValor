import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, UserCog, Target, ClipboardList, Sparkles, RotateCcw, Save, Wand2, PiggyBank, Plus, Trash2,
  SlidersHorizontal, AlertTriangle, Eraser, ArrowRightLeft,
} from 'lucide-react'
import { useInvPerfil } from '../hooks/useInvPerfil'
import { useInvQuestionarios, type QuestionarioEfetivo } from '../hooks/useInvQuestionarios'
import { useInvestimentosAlocacao, type AlocacaoInput } from '../hooks/useInvestimentosDashboard'
import { useUsuarioPerfil } from '../hooks/useUsuarioPerfil'
import { useInvPesos } from '../hooks/useInvPesos'
import { useResumoAposentadoria } from '../hooks/useResumoAposentadoria'
import { estimarIdade, formatData, formatBRL } from '../lib/utils'
import { Input, BtnSalvar, Toast, ModalExcluir, SelectDark } from '../components/ui/shared'
import { useContas } from '../hooks/useContas'
import { useInvestimentosPosicoes } from '../hooks/useInvestimentosPosicoes'
import Mascote from '../components/ui/Mascote'
import { useMascotePreferido } from '../hooks/useMascotePreferido'
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
    <div className="p-5">
      <div className="flex items-center gap-2 mb-5">
        <Link to="/investimentos" className="p-1.5 rounded-lg border border-white/10 hover:border-white/25 text-white">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-[19px] font-semibold text-white">Configurações de Investimentos</h1>
      </div>

      <SecaoPerfil onToast={showToast} />
      <SecaoMetaAposentadoria onToast={showToast} />
      <SecaoMetas onToast={showToast} />
      <SecaoPesos onToast={showToast} />
      <SecaoQuestionarios onToast={showToast} />
      <SecaoMigrarConta onToast={showToast} />

      <Toast msg={toast} />
    </div>
  )
}

// ── wrapper de seção ──────────────────────────────────────────
// `bordas='horizontais'` remove as bordas esquerda/direita (mantém só topo e
// base), deixando a seção em faixa de largura total.
function Secao({ icone, titulo, subtitulo, children, bordas = 'todas' }: {
  icone: React.ReactNode; titulo: string; subtitulo?: string; children: React.ReactNode
  bordas?: 'todas' | 'horizontais'
}) {
  const borda = bordas === 'horizontais'
    ? 'border-y border-white/10'
    : 'rounded-xl border border-white/10'
  return (
    <section className={`${borda} p-4 mb-4`}>
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
  const { perfil, isFetched, salvar } = useInvPerfil()
  const { dataNascimento, loading: loadingNasc } = useUsuarioPerfil()
  const [aposent, setAposent] = useState('')
  const [resp, setResp] = useState<Record<string, number>>({})
  const [salvando, setSalvando] = useState(false)

  // A idade é SEMPRE derivada da data de nascimento informada no Perfil — não
  // se digita aqui (informar idade + data de nascimento seria redundante e
  // ficaria desatualizada). Acompanha o passar dos anos automaticamente.
  const idadeN = useMemo(() => estimarIdade(dataNascimento), [dataNascimento])

  // Carrega o perfil salvo no formulário UMA vez, quando a busca resolve.
  // Gateado por `isFetched` (não por `loading`): no primeiro render a sessão
  // ainda é null → a query fica desabilitada e `loading` (isLoading) reporta
  // false, o que populava o form ANTES do perfil chegar (e nunca mais). Padrão
  // derived-state-on-change (sync no render, sem latch em effect).
  const [carregado, setCarregado] = useState(false)
  if (isFetched && !carregado) {
    setCarregado(true)
    if (perfil) {
      setAposent(perfil.idade_aposentadoria ? String(perfil.idade_aposentadoria) : '')
      setResp(perfil.suitability ?? {})
    }
  }

  const aposentN = aposent ? Number(aposent) : null
  const resultado = useMemo(() => derivarPerfil(resp, idadeN, aposentN), [resp, idadeN, aposentN])
  const respondidas = PERGUNTAS_SUITABILITY.filter((p) => resp[p.id] != null).length

  async function handleSalvar() {
    // O questionário é o único requisito — idade (data de nascimento) e idade de
    // aposentadoria são opcionais e só refinam a estimativa de horizonte. Assim
    // as respostas sempre são salvas, mesmo sem a data de nascimento informada.
    if (respondidas === 0) { onToast('Responda o questionário de perfil.'); return }
    if (idadeN != null && (idadeN < 14 || idadeN > 110)) {
      onToast('A idade calculada pela data de nascimento é inválida — revise no Perfil.'); return
    }
    if (aposentN != null && (aposentN > 110 || (idadeN != null && aposentN <= idadeN))) {
      onToast('A idade de aposentadoria deve ser maior que a idade atual (e até 110).'); return
    }
    const payload: PerfilInvestidor = {
      perfil: resultado.perfil,
      idade: idadeN,
      idade_aposentadoria: aposentN,
      suitability: resp,
      // Preserva a renda-alvo definida no quadro "Meta de aposentadoria" — o
      // payload é montado do zero e a descartaria sem isto.
      renda_substituir: perfil?.renda_substituir ?? null,
      atualizado_em: new Date().toISOString(),
    }
    setSalvando(true)
    const res = await salvar(payload)
    setSalvando(false)
    onToast(res.ok ? 'Perfil salvo!' : (res.erro ?? 'Erro ao salvar perfil'))
  }

  return (
    <Secao icone={<UserCog size={16} />} titulo="Perfil do investidor"
      subtitulo="A idade vem da sua data de nascimento (Perfil). Informe quando pretende se aposentar e responda o questionário. O perfil é derivado das respostas e do horizonte.">
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex-1 min-w-[140px]">
          <span className="block text-[12.5px] mb-1" style={{ color: MUTED }}>Idade atual</span>
          {loadingNasc ? (
            <p className="text-[12.5px] mt-1" style={{ color: MUTED }}>Carregando…</p>
          ) : idadeN != null ? (
            <>
              <p className="text-[20px] font-bold text-white leading-tight">{idadeN} anos</p>
              <span className="block text-[11.5px] mt-1" style={{ color: MUTED }}>
                Calculada da data de nascimento{dataNascimento ? ` (${formatData(dataNascimento)})` : ''}.{' '}
                <Link to="/perfil" className="underline hover:text-white" style={{ color: VERDE }}>Alterar</Link>
              </span>
            </>
          ) : (
            <span className="block text-[12.5px] mt-1" style={{ color: AMBAR }}>
              Informe sua data de nascimento no <Link to="/perfil" className="underline hover:text-white" style={{ color: VERDE }}>Perfil</Link> para calcular a idade.
            </span>
          )}
        </div>
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
// 1b) Meta de aposentadoria (regra dos 4%)
// ════════════════════════════════════════════════════════════
const TAXA_RETIRADA = 0.04  // 4% a.a. — taxa de retirada segura (regra dos 4% / FIRE)

function StatMeta({ rotulo, valor, sufixo, destaque, dica }: {
  rotulo: string; valor: string; sufixo?: string; destaque?: boolean; dica?: string
}) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <p className="text-[12px]" style={{ color: MUTED }}>{rotulo}</p>
      <p className={`font-bold ${destaque ? 'text-[18px]' : 'text-[16px]'}`} style={{ color: destaque ? VERDE : '#fff' }}>
        {valor}{sufixo && <span className="text-[12px] font-normal ml-1" style={{ color: MUTED }}>{sufixo}</span>}
      </p>
      {dica && <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{dica}</p>}
    </div>
  )
}

function SecaoMetaAposentadoria({ onToast }: { onToast: (m: string) => void }) {
  const { rendaMensalMedia, patrimonioTotal, loading } = useResumoAposentadoria()
  const { perfil, salvar } = useInvPerfil()
  const [salvando, setSalvando] = useState(false)

  // "Renda a substituir" é editável: o usuário pode definir uma renda-alvo
  // diferente da média. Quando não há override salvo (null), usa a média das
  // receitas dos últimos 24 meses. Sincroniza o campo local com o valor de
  // referência (derived-state-on-change) sem latch frágil.
  const rendaSalva   = perfil?.renda_substituir ?? null
  const defaultRenda = rendaSalva != null ? rendaSalva : rendaMensalMedia
  const mediaArred   = Math.round(rendaMensalMedia * 100) / 100
  const [rendaEdit, setRendaEdit] = useState('')
  const [refPrev, setRefPrev] = useState<number | null>(null)
  if (defaultRenda !== refPrev) {
    setRefPrev(defaultRenda)
    setRendaEdit(defaultRenda > 0 ? String(Math.round(defaultRenda * 100) / 100) : '')
  }

  // Renda usada nos cálculos: campo vazio = automático (usa a média).
  const rendaSubstituir  = rendaEdit.trim() === '' ? rendaMensalMedia : (Number(rendaEdit) || 0)

  // Regra dos 4%: o patrimônio deve gerar, a 4% a.a., a renda que se quer
  // substituir. Logo o patrimônio-alvo = renda anual / 4% (= 25× a renda anual).
  const rendaAnual       = rendaSubstituir * 12
  const patrimonioAlvo   = rendaAnual / TAXA_RETIRADA
  const rendaPassivaMes  = patrimonioTotal > 0 ? (patrimonioTotal * TAXA_RETIRADA) / 12 : 0
  const progresso        = patrimonioAlvo > 0 ? Math.min(1, Math.max(0, patrimonioTotal / patrimonioAlvo)) : 0
  const falta            = Math.max(0, patrimonioAlvo - patrimonioTotal)
  const atingiu          = patrimonioAlvo > 0 && patrimonioTotal >= patrimonioAlvo
  const mostrarUsarMedia = rendaMensalMedia > 0 && rendaEdit.trim() !== '' && (Number(rendaEdit) || 0) !== mediaArred

  // Persiste a renda-alvo mesclando com o perfil existente (não perde
  // questionário/idade). Campo vazio salva null = volta ao automático.
  async function handleSalvarRenda() {
    const val = rendaEdit.trim() === '' ? null : Number(rendaEdit)
    if (val != null && (!Number.isFinite(val) || val < 0)) {
      onToast('Informe um valor válido para a renda a substituir.'); return
    }
    setSalvando(true)
    const res = await salvar({
      perfil: perfil?.perfil ?? 'MODERADO',
      idade: perfil?.idade ?? null,
      idade_aposentadoria: perfil?.idade_aposentadoria ?? null,
      suitability: perfil?.suitability ?? {},
      renda_substituir: val,
      atualizado_em: new Date().toISOString(),
    })
    setSalvando(false)
    onToast(res.ok ? 'Meta de renda salva!' : (res.erro ?? 'Erro ao salvar meta'))
  }

  return (
    <Secao icone={<PiggyBank size={16} />} titulo="Meta de aposentadoria (regra dos 4%)"
      subtitulo="Estimativa pela regra dos 4%: você poderia sacar 4% do patrimônio por ano sem esgotá-lo. Edite a renda a substituir para simular — o patrimônio necessário, o quanto falta e o progresso recalculam na hora.">
      {loading ? (
        <p className="text-[12.5px]" style={{ color: MUTED }}>Calculando…</p>
      ) : (
        <>
          {rendaMensalMedia <= 0 && (
            <p className="text-[12.5px] mb-3" style={{ color: AMBAR }}>
              Sem receitas suficientes nos últimos 24 meses para estimar a renda média — informe abaixo a renda que deseja substituir.
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">
            <StatMeta rotulo="Renda média mensal" valor={formatBRL(rendaMensalMedia)} dica="receitas, últimos 24 meses" />
            <StatMeta rotulo="Patrimônio total" valor={formatBRL(patrimonioTotal)} dica="saldo de todas as contas" />
            <StatMeta rotulo="Renda passiva hoje" valor={formatBRL(rendaPassivaMes)} sufixo="/mês" dica="seu patrimônio a 4% a.a." />

            {/* Renda a substituir — editável */}
            <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(0,200,150,0.4)' }}>
              <p className="text-[12px]" style={{ color: MUTED }}>Renda a substituir</p>
              <div className="flex items-center gap-1 mt-0.5">
                <Input type="number" min={0} step="any" value={rendaEdit}
                  onChange={(e) => setRendaEdit(e.target.value)}
                  placeholder={rendaMensalMedia > 0 ? String(mediaArred) : '0'}
                  className="!text-[16px] !py-1.5 !font-bold !px-2" style={{ color: VERDE }} />
                <span className="text-[12px]" style={{ color: MUTED }}>/mês</span>
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>edite para simular a meta</p>
            </div>

            <StatMeta destaque rotulo="Patrimônio necessário" valor={formatBRL(patrimonioAlvo)}
              dica="para gerar essa renda a 4% a.a." />
            <StatMeta rotulo={atingiu ? 'Excedente' : 'Falta acumular'} valor={formatBRL(atingiu ? patrimonioTotal - patrimonioAlvo : falta)}
              dica={atingiu ? 'você já atingiu a meta 🎉' : 'até o patrimônio-alvo'} />
          </div>

          {/* Ações da renda-alvo */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button onClick={handleSalvarRenda} disabled={salvando}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] disabled:opacity-50"
              style={{ borderColor: 'rgba(0,200,150,0.5)', color: VERDE }}>
              <Save size={14} /> {salvando ? 'Salvando…' : 'Salvar meta'}
            </button>
            {mostrarUsarMedia && (
              <button onClick={() => setRendaEdit(String(mediaArred))}
                className="text-[12px] text-blue-300 hover:text-blue-200">
                Usar renda média
              </button>
            )}
          </div>

          {/* Barra de progresso rumo ao patrimônio-alvo */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12.5px]" style={{ color: MUTED }}>Progresso até a independência</span>
              <span className="text-[13px] font-semibold" style={{ color: atingiu ? VERDE : '#fff' }}>
                {(progresso * 100).toFixed(1).replace('.', ',')}%
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${progresso * 100}%`, background: atingiu ? VERDE : 'linear-gradient(90deg,#5b8cff,#00c896)' }} />
            </div>
          </div>

          <p className="text-[11.5px] mt-3" style={{ color: MUTED }}>
            Estimativa simplificada (regra dos 4%): não considera inflação, impostos nem aportes futuros.
            Serve como referência de ordem de grandeza.
          </p>
        </>
      )}
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
        {/* Total alinhado sob a coluna dos valores */}
        <div className="flex items-center gap-3 pt-2 mt-1 border-t border-white/10">
          <span className="w-2 h-2 shrink-0" />
          <span className="flex-1 text-[14px] font-semibold text-white">Total</span>
          <div className="w-28 px-3">
            <span className="text-[15px] font-bold" style={{ color: totalOk ? VERDE : AMBAR }}>
              {total.toFixed(2).replace('.', ',')}
            </span>
          </div>
          <span className="text-[13px] w-4" style={{ color: MUTED }}>%</span>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
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
// 3) Pesos por critério — GLOBAIS (valem para todos os tipos de ativo)
// ════════════════════════════════════════════════════════════
function SecaoPesos({ onToast }: { onToast: (m: string) => void }) {
  const { perfil } = useInvPerfil()
  const { pesos: pesosGlobais, loading: loadingPesos, salvar: salvarPesos } = useInvPesos()

  // Editados localmente e ressincronizados quando o valor salvo chega.
  const [pesos, setPesos] = useState<PesosCriterio>(pesosGlobais)
  const [pesosPrev, setPesosPrev] = useState(pesosGlobais)
  const [salvando, setSalvando] = useState(false)
  if (!loadingPesos && pesosPrev !== pesosGlobais) {
    setPesosPrev(pesosGlobais)
    setPesos(pesosGlobais)
  }

  const soma = CRITERIOS_QUESTAO.reduce((s, c) => s + (Number(pesos[c]) || 0), 0)
  const ok = Math.abs(soma - 100) < 0.5

  function sugerir() {
    if (!perfil?.perfil) { onToast('Defina o perfil do investidor acima para sugerir pesos.'); return }
    setPesos({ ...PESOS_SUGERIDOS_POR_PERFIL[perfil.perfil] })
  }
  async function salvarTudo() {
    if (!ok) { onToast('A soma dos pesos deve ser 100.'); return }
    setSalvando(true)
    const res = await salvarPesos(pesos)
    setSalvando(false)
    onToast(res.ok ? 'Pesos salvos — valem para todos os tipos.' : (res.erro ?? 'Erro ao salvar pesos'))
  }

  return (
    <Secao icone={<SlidersHorizontal size={16} />} titulo="Pesos por critério"
      subtitulo="Definem quanto cada critério pesa na nota final dos ativos. Valem para TODOS os tipos de ativo — por isso ficam aqui, fora dos questionários. A soma precisa ser 100%.">
      <div className="flex justify-end mb-2">
        <button onClick={sugerir} className="flex items-center gap-1 text-[12px] text-blue-300 hover:text-blue-200">
          <Wand2 size={13} /> Sugerir pelo perfil
        </button>
      </div>
      {/* Grid alinhado: uma coluna por critério (4 em telas ≥ sm, 2 no mobile) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
        {CRITERIOS_QUESTAO.map((c) => (
          <label key={c} className="block">
            <span className="block text-[12px] mb-1 leading-tight min-h-[30px]" style={{ color: MUTED }}>{CRITERIO_LABEL[c]}</span>
            <div className="flex items-center gap-1">
              <Input type="number" min={0} max={100} value={String(pesos[c] ?? 0)}
                onChange={(e) => setPesos((p) => ({ ...p, [c]: Number(e.target.value) || 0 }))} />
              <span className="text-[12px]" style={{ color: MUTED }}>%</span>
            </div>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
        <p className="text-[12px]" style={{ color: ok ? MUTED : AMBAR }}>
          Soma: {soma}% {ok ? '' : '— precisa somar 100'}
        </p>
        <button onClick={salvarTudo} disabled={salvando || !ok}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] disabled:opacity-50"
          style={{ borderColor: 'rgba(0,200,150,0.5)', color: VERDE }}>
          <Save size={14} /> {salvando ? 'Salvando…' : 'Salvar pesos'}
        </button>
      </div>
    </Secao>
  )
}

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

// ════════════════════════════════════════════════════════════
// 4) Questionários de avaliação por tipo
// ════════════════════════════════════════════════════════════
function SecaoQuestionarios({ onToast }: { onToast: (m: string) => void }) {
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

  const custom = questionarios.find((q) => q.tipo_ativo === tipoSel)

  // (Re)carrega apenas as PERGUNTAS quando troca o tipo ou quando o custom
  // daquele tipo muda (derived-state-on-change, sync no render). Os pesos são
  // globais e não dependem da aba. Resetar `loadedSig` para '' força recarga.
  const [loadedSig, setLoadedSig] = useState('')
  const sigCarga = `${tipoSel}:${custom?.updated_at ?? 'default'}:${perfil?.perfil ?? 'sem'}`
  if (sigCarga !== loadedSig) {
    setLoadedSig(sigCarga)
    const ef = questionarioEfetivo(tipoSel, perfil?.perfil ?? null)
    setPerguntas(comIdsUnicos(ef.perguntas))
    setInfo({ origem: ef.origem, provedor: ef.ia_provedor, modelo: ef.ia_modelo, custom: ef.custom })
    setPendenteIA(null)
    setErroIA(null)
    setErroSalvar(null)
  }

  // Pesos são globais (editados na seção acima); aqui só validamos a soma.
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
      const res = await gerarPorIA(tipoSel)
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
    if (!pesosOk) { const m = 'Ajuste os “Pesos por critério” acima para somarem 100% antes de salvar.'; setErroSalvar(m); onToast(m); return }
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
    })
    setSalvando(false)
    if (res.ok) { setPendenteIA(null); setErroSalvar(null); setLoadedSig(''); onToast('Questionário salvo!') }
    else { const m = res.erro ?? 'Erro ao salvar questionário'; setErroSalvar(m); onToast(m) }
  }

  async function restaurarPadrao() {
    if (!info.custom) { onToast('Este tipo já usa o questionário padrão.'); return }
    const res = await excluir(tipoSel)
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

  // Sem nenhum tipo alocado não há aba para mostrar — orienta a definir metas.
  if (tiposAlocados.length === 0) {
    return (
      <Secao icone={<ClipboardList size={16} />} titulo="Questionários de avaliação"
        subtitulo="Há um questionário por tipo de ativo, exibido em abas e separado por critério. As abas aparecem para cada tipo com Meta de alocação acima de 0%.">
        <p className="text-[12.5px]" style={{ color: AMBAR }}>
          Nenhum tipo de ativo com Meta de alocação definida. Informe os percentuais em “Metas de alocação” acima para habilitar os questionários.
        </p>
      </Secao>
    )
  }

  return (
    <Secao icone={<ClipboardList size={16} />} titulo="Questionários de avaliação" bordas="horizontais"
      subtitulo="Cada tipo de ativo tem o SEU próprio questionário. As perguntas são separadas por critério (em abas) e cada resposta vale de 0 (pior) a 4 (melhor); a nota final do ativo é a média ponderada pelos “Pesos por critério” definidos acima. Edite/crie as perguntas à mão ou peça ao Mentor (IA) gerar 40 questões (10 por critério).">
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

        {/* Título do questionário visível */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <h3 className="text-[15px] font-semibold text-white">
            Questionário de <span style={{ color: '#7da9ff' }}>{TIPO_ATIVO_LABEL[tipoSel]}</span>
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
            {gerando ? 'Gerando…' : `Pedir ao Mentor (${TIPO_ATIVO_LABEL[tipoSel]})`}
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

// ════════════════════════════════════════════════════════════
// 6) Migrar conta de investimentos
// ════════════════════════════════════════════════════════════
// Consolida os dados de uma conta em outra — caso típico: a importação
// criou uma conta provisória ("Investimentos XP") e o usuário quer tudo
// na conta real. Move posições, operações, proventos (com as transações
// do extrato juntas) e o histórico mensal (mesclando meses em conflito).
function SecaoMigrarConta({ onToast }: { onToast: (m: string) => void }) {
  const { contas } = useContas()
  const { migrarConta } = useInvestimentosPosicoes()
  const [de,   setDe]   = useState('')
  const [para, setPara] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [migrando,    setMigrando]    = useState(false)

  const ativas = contas.filter((c) => c.ativa)
  const nomeDe   = ativas.find((c) => c.conta_id === de)?.nome ?? ''
  const nomePara = ativas.find((c) => c.conta_id === para)?.nome ?? ''

  async function migrar() {
    setConfirmando(false)
    setMigrando(true)
    const res = await migrarConta(de, para)
    setMigrando(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao migrar conta'); return }
    const d = res.dados
    onToast(`Migração concluída: ${d?.posicoes ?? 0} posição(ões), ${d?.operacoes ?? 0} operação(ões), ` +
      `${d?.dividendos ?? 0} provento(s) (${d?.transacoes ?? 0} lançamento(s) do extrato) e ` +
      `${(d?.historico_movido ?? 0) + (d?.historico_mesclado ?? 0)} mês(es) de histórico.`)
    setDe(''); setPara('')
  }

  return (
    <Secao icone={<ArrowRightLeft size={16} />} titulo="Migrar conta de investimentos"
      subtitulo="Move TUDO de uma conta para outra: posições, operações, proventos (inclusive os lançamentos no extrato — o saldo acompanha) e o histórico mensal. Útil para consolidar a conta provisória criada pela importação na sua conta real. A conta de origem fica vazia e pode ser inativada depois.">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <p className="text-[12.5px] mb-1" style={{ color: MUTED }}>De (conta de origem)</p>
          <SelectDark value={de} onChange={(e) => setDe(e.target.value)} style={{ width: 260 }}>
            <option value="">Selecione…</option>
            {ativas.map((c) => (
              <option key={c.conta_id} value={c.conta_id} disabled={c.conta_id === para}>{c.nome}</option>
            ))}
          </SelectDark>
        </div>
        <div>
          <p className="text-[12.5px] mb-1" style={{ color: MUTED }}>Para (conta de destino)</p>
          <SelectDark value={para} onChange={(e) => setPara(e.target.value)} style={{ width: 260 }}>
            <option value="">Selecione…</option>
            {ativas.map((c) => (
              <option key={c.conta_id} value={c.conta_id} disabled={c.conta_id === de}>{c.nome}</option>
            ))}
          </SelectDark>
        </div>
        <button onClick={() => setConfirmando(true)} disabled={!de || !para || de === para || migrando}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border text-[14px] font-semibold transition-all disabled:opacity-40"
          style={{ borderColor: `${AMBAR}66`, color: AMBAR }}>
          <ArrowRightLeft size={15} className={migrando ? 'animate-pulse' : ''} />
          {migrando ? 'Migrando…' : 'Migrar'}
        </button>
      </div>
      <p className="text-[12px] mt-2" style={{ color: MUTED }}>
        Dica: se a conta provisória estiver certa e o problema for só o nome, basta renomeá-la na página Contas — sem migração.
      </p>

      {confirmando && (
        <div role="dialog" aria-modal="true" aria-label="Confirmar migração"
          className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmando(false)} />
          <div className="relative bg-[#1a1f2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-md mx-4 p-5">
            <p className="text-[18px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>Confirmar migração</p>
            <p className="text-[15px] mb-5" style={{ color: MUTED }}>
              Mover todos os investimentos de <strong className="text-white">"{nomeDe}"</strong> para{' '}
              <strong className="text-white">"{nomePara}"</strong>? Os lançamentos de proventos no extrato
              mudam de conta junto (o saldo sai de uma e entra na outra).
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmando(false)}
                className="px-4 py-2 rounded-lg border border-white/10 text-[14px] text-white/80 hover:border-white/25">
                Cancelar
              </button>
              <button onClick={migrar}
                className="px-4 py-2 rounded-lg border text-[14px] font-semibold"
                style={{ borderColor: `${AMBAR}88`, color: AMBAR }}>
                Migrar tudo
              </button>
            </div>
          </div>
        </div>
      )}
    </Secao>
  )
}
