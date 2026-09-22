import { useMemo, useState, useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  UserCog, Target, ClipboardList, Save, Wand2, PiggyBank, Plus, Trash2,
  SlidersHorizontal, ArrowRightLeft, Coins, RefreshCw, Wrench, Link2, Stethoscope,
} from 'lucide-react'
import { useInvPerfil } from '../hooks/useInvPerfil'
import { useInvQuestionarios } from '../hooks/useInvQuestionarios'
import { useInvestimentosAlocacao, type AlocacaoInput } from '../hooks/useInvestimentosDashboard'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useBackfillHistorico } from '../hooks/useInvestimentosHistorico'
import { useUsuarioPerfil } from '../hooks/useUsuarioPerfil'
import { useInvPesos } from '../hooks/useInvPesos'
import { useResumoAposentadoria } from '../hooks/useResumoAposentadoria'
import { useTiposDividendo } from '../hooks/useTiposDividendo'
import { useCategorias } from '../hooks/useCategorias'
import { useDividendos, type DiagnosticoProventos } from '../hooks/useDividendos'
import { apiFetch, extrairLista } from '../lib/api'
import { estimarIdade, formatData, formatBRL, mesAtual } from '../lib/utils'
import { tickerTesouro, ehSemestral } from '../lib/tesouro'
import {
  Input, BtnSalvar, BtnCancelar, Toast, SelectDark, Drawer, Field, SearchableSelect, Segmented,
} from '../components/ui/shared'
import { MultiSelect, type MultiSelectOption } from '../components/ui/MultiSelect'
import InvestimentosNav from '../components/ui/InvestimentosNav'
import TutorialTour from '../components/ui/TutorialTour'
import { TUTORIAL_INVESTIMENTOS_CONFIG } from '../lib/tutoriaisPaginas'
import { useRegistrarContextoIA } from '../context/ContextoIAContext'
import { useContas } from '../hooks/useContas'
import { useInvestimentosPosicoes } from '../hooks/useInvestimentosPosicoes'
import { PERGUNTAS_SUITABILITY, derivarPerfil } from '../lib/perfilInvestidor'
import {
  TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL, TIPO_ATIVO_COR,
  CRITERIOS_QUESTAO, CRITERIO_LABEL,
  PERFIL_INVESTIDOR_LABEL, PERFIL_INVESTIDOR_DESCRICAO, PESOS_SUGERIDOS_POR_PERFIL,
} from '../lib/constants'
import type {
  PerfilInvestidor, PesosCriterio,
  TipoAtivoInvestimento, InvestimentoTipoDividendo, InvestimentoAtivo,
} from '../types'

const MUTED = '#8b92a8'
const VERDE = '#00c896'
const AMBAR = '#ffb74d'

export default function ConfiguracoesInvestimentosPage() {
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500) }

  // ── Snapshot pra IA ───────────────────────────────────────────────────────
  const { perfil } = useInvPerfil()
  const { alocacoes } = useInvestimentosAlocacao()
  const { pesos } = useInvPesos()
  useRegistrarContextoIA(useMemo(() => ({
    titulo:    'Investimentos · Configurações',
    descricao: 'Perfil do investidor, metas de alocação e pesos de avaliação por critério',
    dados: {
      perfil_investidor: perfil?.perfil ?? null,
      idade_aposentadoria: perfil?.idade_aposentadoria ?? null,
      renda_a_substituir: perfil?.renda_substituir ?? null,
      metas_alocacao: alocacoes.filter((a) => a.percentual_ideal > 0)
        .map((a) => ({ tipo: a.tipo_ativo, percentual_ideal: a.percentual_ideal })),
      pesos_por_criterio: pesos,
    },
  }), [perfil, alocacoes, pesos]))

  return (
    <div className="p-5">
      <InvestimentosNav />
      <div className="flex items-center gap-2 mb-5">
        <h1 className="text-[19px] font-semibold text-white">Configurações de Investimentos</h1>
      </div>

      <div data-tutorial="config-perfil"><SecaoPerfil onToast={showToast} /></div>
      <div data-tutorial="config-aposentadoria"><SecaoMetaAposentadoria onToast={showToast} /></div>
      <div data-tutorial="config-metas"><SecaoMetas onToast={showToast} /></div>
      <div data-tutorial="config-pesos"><SecaoPesos onToast={showToast} /></div>
      <div data-tutorial="config-questionarios"><SecaoQuestionarios /></div>
      <div data-tutorial="config-tipos-dividendo"><SecaoTiposDividendo onToast={showToast} /></div>
      <div data-tutorial="config-manutencao-proventos"><SecaoManutencaoProventos onToast={showToast} /></div>
      <div data-tutorial="config-manutencao"><SecaoManutencaoAtivos onToast={showToast} /></div>
      <div data-tutorial="config-migrar"><SecaoMigrarConta onToast={showToast} /></div>

      <Toast msg={toast} />

      <TutorialTour pageKey="investimentos-config-v1" passos={TUTORIAL_INVESTIMENTOS_CONFIG} />
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

// ════════════════════════════════════════════════════════════
// 4) Questionários de avaliação por tipo — a edição em si (abas de tipo/
// critério, geração pelo Mentor, etc.) vive numa página própria
// (QuestionariosInvestimentosPage); aqui fica só um card explicativo com
// acesso a ela, pra não sobrecarregar esta tela com um editor grande.
// ════════════════════════════════════════════════════════════
function SecaoQuestionarios() {
  const { alocacoes } = useInvestimentosAlocacao()
  const { questionarios } = useInvQuestionarios()
  const tiposAlocados = useMemo(
    () => TIPOS_ATIVO_INV.filter((t) => (alocacoes.find((a) => a.tipo_ativo === t)?.percentual_ideal ?? 0) > 0),
    [alocacoes],
  )
  const tiposComQuestionarioProprio = questionarios.length

  return (
    <Secao icone={<ClipboardList size={16} />} titulo="Questionários de avaliação"
      subtitulo="Há um questionário por tipo de ativo (com Meta de alocação acima de 0%), separado por critério — cada resposta vale de 0 a 4 e a nota final do ativo é a média ponderada pelos “Pesos por critério” definidos acima. Edite as perguntas à mão ou peça ao Mentor (IA) para gerar um conjunto novo.">
      {tiposAlocados.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: AMBAR }}>
          Nenhum tipo de ativo com Meta de alocação definida. Informe os percentuais em “Metas de alocação” acima para habilitar os questionários.
        </p>
      ) : (
        <p className="text-[12.5px] mb-3" style={{ color: MUTED }}>
          {tiposAlocados.length} {tiposAlocados.length === 1 ? 'tipo alocado' : 'tipos alocados'} com questionário disponível
          {tiposComQuestionarioProprio > 0 && ` — ${tiposComQuestionarioProprio} já ${tiposComQuestionarioProprio === 1 ? 'personalizado' : 'personalizados'} (manual ou pelo Mentor)`}.
        </p>
      )}
      <Link to="/investimentos/questionarios"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white"
        style={{ background: '#3b82f6' }}>
        <ClipboardList size={14} /> Abrir questionários
      </Link>
    </Secao>
  )
}

// ════════════════════════════════════════════════════════════
// 5) Tipos de dividendo (mapeamento tipo → categoria do extrato)
// Movida de DividendosPage — era a única configuração do módulo que vivia
// fora desta página (drawer "Configurar tipos" + aviso de mapeamento).
// ════════════════════════════════════════════════════════════
function SecaoTiposDividendo({ onToast }: { onToast: (m: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const { tipos } = useTiposDividendo()
  const semMapeamento = tipos.filter((t) => !t.categoria_id).length

  return (
    <Secao icone={<Coins size={16} />} titulo="Tipos de dividendo"
      subtitulo="Cada tipo de provento (Dividendos, JSCP, Aluguel de FII, Rend. Trib. …) é lançado na categoria do extrato mapeada aqui. Sem mapeamento, a busca automática não lança o provento.">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12.5px]" style={{ color: semMapeamento > 0 ? AMBAR : MUTED }}>
          {tipos.length} tipo(s) cadastrado(s){semMapeamento > 0 ? ` — ${semMapeamento} sem categoria mapeada` : ''}
        </p>
        <button onClick={() => setAberto(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
          <Coins size={15} /> Gerenciar tipos
        </button>
      </div>
      {aberto && <DrawerConfigTipos onClose={() => setAberto(false)} onToast={onToast} />}
    </Secao>
  )
}

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

// ════════════════════════════════════════════════════════════
// 5c) Manutenção de proventos — diagnóstico, backfill de DY/YoC e
// associação de dividendos já lançados no extrato antes de existir o
// módulo de investimentos. Movida de Proventos: são ações pontuais de
// configuração/correção, não do dia a dia (que fica só com "Buscar
// proventos" e "Novo dividendo" na página de Proventos).
// ════════════════════════════════════════════════════════════

function SecaoManutencaoProventos({ onToast }: { onToast: (m: string) => void }) {
  const { backfillRate, associarMassa } = useDividendos()
  const [backfilling, setBackfilling] = useState(false)
  const [associando,  setAssociando]  = useState(false)
  const [drawerAssoc, setDrawerAssoc] = useState(false)
  const [drawerDiag,  setDrawerDiag]  = useState(false)

  async function backfillYoc() {
    setBackfilling(true)
    const res = await backfillRate()
    setBackfilling(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao preencher dividendo por cota'); return }
    const d = res.dados
    onToast(`Backfill concluído — ${d?.preenchidos ?? 0} provento(s) atualizado(s) com o dividendo por cota da B3.`)
  }

  async function associarDoExtrato() {
    setAssociando(true)
    const res = await associarMassa()
    setAssociando(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao associar do extrato'); return }
    const d = res.dados
    onToast((d?.associados ?? 0) === 0
      ? 'Nenhum provento do extrato para associar.'
      : `${d?.associados} provento(s) do extrato associado(s) aos investimentos.`)
  }

  return (
    <Secao icone={<Link2 size={16} />} titulo="Manutenção de proventos"
      subtitulo="Ações pontuais de diagnóstico e correção — o dia a dia (buscar/lançar proventos) fica na página Proventos.">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setDrawerDiag(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 text-[13px] text-white/90 hover:border-white/30"
          title="Testa cada elo da busca de proventos (posição, fonte, tipos) sem lançar nada — use quando a busca voltar vazia">
          <Stethoscope size={15} /> Diagnóstico
        </button>
        <button onClick={backfillYoc} disabled={backfilling}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 text-[13px] text-white/90 hover:border-white/30 disabled:opacity-50"
          title="Re-busca da B3 o dividendo por cota dos proventos antigos — corrige DY e Yield on Cost no padrão investidor10">
          <Coins size={15} className={backfilling ? 'animate-spin' : ''} /> {backfilling ? 'Atualizando…' : 'Atualizar DY/YoC'}
        </button>
        <button onClick={() => setDrawerAssoc(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 text-[13px] text-white/90 hover:border-white/30"
          title="Vincula dividendos/aluguéis já lançados no extrato (antes de existir o módulo de investimentos) a um ativo, um por um">
          <Link2 size={15} /> Associar do extrato
        </button>
        <button onClick={associarDoExtrato} disabled={associando}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 text-[13px] text-white/90 hover:border-white/30 disabled:opacity-50"
          title="Vincula em lote proventos que já estão no extrato (ex.: projeções de FII lançadas na mão) aos investimentos">
          <RefreshCw size={15} className={associando ? 'animate-spin' : ''} /> {associando ? 'Associando…' : 'Associar extrato (lote)'}
        </button>
      </div>
      {drawerAssoc && <DrawerAssociar onClose={() => setDrawerAssoc(false)} onToast={onToast} />}
      {drawerDiag  && <DrawerDiagnostico onClose={() => setDrawerDiag(false)} />}
    </Secao>
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

  // Só categorias já associadas a um tipo de provento (seção "Tipos de
  // dividendo" acima): é o mapeamento que define em qual tipo o provento
  // será gravado.
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
              Nenhuma categoria associada a um tipo de provento. Mapeie cada tipo (Dividendos, JSCP,
              Aluguel de FII…) na seção "Tipos de dividendo" desta página.
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

// ── Drawer: diagnóstico da busca de proventos (dry-run) ──────
// Mostra, por ativo, cada elo da corrente de provisão: posição ativa,
// fonte coberta, resposta HTTP da fonte, proventos devolvidos/na janela
// e tipos sem categoria. Não lança nada — só explica por que a busca
// voltou (ou voltaria) vazia.
function DrawerDiagnostico({ onClose }: { onClose: () => void }) {
  const { diagnostico } = useDividendos()
  const [dados, setDados] = useState<DiagnosticoProventos | null>(null)
  const [erro,  setErro]  = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    diagnostico().then((r) => {
      if (!vivo) return
      if (r.ok && r.dados) setDados(r.dados)
      else setErro(r.erro ?? 'Erro ao executar o diagnóstico')
    })
    return () => { vivo = false }
    // roda uma única vez ao abrir o drawer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const OK  = '#00c896'
  const BAD = '#ff6b6b'
  const WRN = '#ffb74d'

  // Conclusão por ativo: qual elo quebra a provisão deste ativo?
  function conclusao(a: DiagnosticoProventos['ativos'][number]): { txt: string; cor: string } {
    if (!a.fonte)            return { txt: 'sem fonte de proventos (tipo/moeda fora da cobertura B3/Polygon)', cor: MUTED }
    if (!a.posicao_ativa)    return { txt: 'sem posição ATIVA — a busca pula este ativo', cor: WRN }
    if (a.erro)              return { txt: `fonte falhou: ${a.erro}`, cor: BAD }
    if (a.proventos_fonte === 0) return { txt: 'a fonte respondeu, mas sem nenhum provento anunciado para este ativo', cor: WRN }
    if (a.na_janela === 0)   return { txt: `há ${a.proventos_fonte} provento(s) na fonte, mas nenhum com pagamento na janela (futuros + últimos 30 dias)`, cor: WRN }
    if (a.tipos_pendentes.length > 0) return { txt: `seria lançado, mas o(s) tipo(s) ${a.tipos_pendentes.join(', ')} está(ão) sem categoria — mapeie na seção "Tipos de dividendo" desta página`, cor: WRN }
    return { txt: `${a.na_janela} provento(s) na janela — a busca deve lançar/atualizar`, cor: OK }
  }

  return (
    <Drawer open onClose={onClose} titulo="Diagnóstico de proventos"
      subtitulo="Testa a busca de ponta a ponta, sem lançar nada">
      {!dados && !erro && (
        <div className="flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>
          <RefreshCw size={15} className="animate-spin" /> Consultando B3/Polygon para cada ativo…
        </div>
      )}
      {erro && <p className="text-[14px]" style={{ color: BAD }}>{erro}</p>}
      {dados && (
        <div className="space-y-4 text-[13px]">
          {/* Pré-requisitos globais */}
          <div className="rounded-lg border border-white/10 p-3 space-y-1">
            <p className="font-semibold text-white mb-1">Pré-requisitos</p>
            <p style={{ color: dados.ptax_ultima ? MUTED : BAD }}>
              PTAX: {dados.ptax_ultima ? `sincronizada até ${formatData(dados.ptax_ultima)}` : 'INDISPONÍVEL — bloqueia proventos em USD'}
            </p>
            <p style={{ color: dados.polygon_key ? MUTED : WRN }}>
              Chave Polygon (ativos USD): {dados.polygon_key ? 'configurada' : 'NÃO configurada — internacionais não são buscados'}
            </p>
            <p style={{ color: MUTED }}>
              Janela de provisão: futuros + últimos {dados.janela_dias} dias (desde {formatData(dados.data_corte)})
            </p>
          </div>

          {/* Tipos de provento */}
          <div className="rounded-lg border border-white/10 p-3">
            <p className="font-semibold text-white mb-2">Tipos de provento</p>
            <div className="flex flex-wrap gap-1.5">
              {dados.tipos.length === 0 && (
                <p style={{ color: BAD }}>Nenhum tipo cadastrado — nada pode ser lançado.</p>
              )}
              {dados.tipos.map((t) => (
                <span key={t.nome} className="px-2 py-0.5 rounded-full border text-[12px]"
                  style={{ borderColor: t.mapeado ? `${OK}55` : `${WRN}88`, color: t.mapeado ? OK : WRN }}>
                  {t.nome} {t.mapeado ? '✓' : '· sem categoria'}
                </span>
              ))}
            </div>
          </div>

          {/* Por ativo */}
          <div className="rounded-lg border border-white/10 p-3 space-y-3">
            <p className="font-semibold text-white">Ativos ({dados.ativos.length})</p>
            {dados.ativos.length === 0 && (
              <p style={{ color: BAD }}>Nenhum ativo cadastrado em investimentos.</p>
            )}
            {dados.ativos.map((a) => {
              const c = conclusao(a)
              return (
                <div key={`${a.ticker}-${a.tipo_ativo}`} className="border-t border-white/5 pt-2 first:border-t-0 first:pt-0">
                  <p className="text-white font-semibold">
                    {a.ticker} <span className="font-normal" style={{ color: MUTED }}>· {a.tipo_ativo} · {a.moeda}</span>
                  </p>
                  <p style={{ color: MUTED }}>
                    posição ativa: {a.posicao_ativa ? 'sim' : 'não'}
                    {a.fonte ? ` · fonte: ${a.fonte}` : ''}
                    {a.http != null ? ` · HTTP ${a.http}` : ''}
                    {a.fonte && a.posicao_ativa && !a.erro
                      ? ` · ${a.proventos_fonte} na fonte / ${a.na_janela} na janela / ${a.futuros} futuro(s)` : ''}
                  </p>
                  <p style={{ color: c.cor }}>→ {c.txt}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Drawer>
  )
}

// ════════════════════════════════════════════════════════════
// 5b) Manutenção de ativos — atualizar tickets / padronizar Tesouro
// Movida de Meus ativos: fica escondida do dia a dia e só aparece na aba
// certa quando há mesmo algo pra corrigir. Cada botão só é exibido quando a
// detecção local (sem chamar a API) encontra ao menos um ativo candidato —
// mesmo critério "conservador" que o backend usa para decidir se atualiza.
// ════════════════════════════════════════════════════════════

// "Tipo Titulo" cru do STN sem o ano (mesmo regex de rotaNormalizarTesouro,
// supabase/functions/investimentos/import-export.ts) — nome órfão de um bug
// já corrigido na busca, mas que pode ter ficado gravado em ativos antigos.
const TESOURO_NOME_SEM_ANO = /^Tesouro (Prefixado|Selic|IPCA\+)(\s+com Juros Semestrais)?$/i

// Ticket "incompleto": nome vazio ou igual ao próprio código — sinal de que a
// busca externa (brapi) falhou no cadastro/importação. RF privada e Tesouro
// não têm essa fonte, então nunca entram nesta checagem.
function ticketIncompleto(a: InvestimentoAtivo): boolean {
  if (a.tipo_ativo === 'RENDA_FIXA' || a.tipo_ativo === 'TESOURO_DIRETO') return false
  const tk = a.ticker.trim().toUpperCase()
  return !a.nome.trim() || a.nome.trim().toUpperCase() === tk
}

// Título do Tesouro fora do formato padronizado (ticker legível TD-IPCA-2040
// e nome correspondente) — mesma lógica de rotaNormalizarTesouro, só que aqui
// apenas para DECIDIR se vale mostrar o botão (o backend refaz o cálculo).
function tesouroDespadronizado(a: InvestimentoAtivo): boolean {
  if (!a.rf_indexador || !a.rf_vencimento) return false
  const novo = tickerTesouro(a.rf_indexador, a.rf_vencimento, ehSemestral(a.nome))
  if (!novo) return false
  const atual = a.ticker.trim().toUpperCase()
  if (novo !== atual) return true
  const nomeAtual = (a.nome ?? '').trim()
  return !nomeAtual || nomeAtual.toUpperCase() === atual || nomeAtual.toUpperCase() === novo || TESOURO_NOME_SEM_ANO.test(nomeAtual)
}

function SecaoManutencaoAtivos({ onToast }: { onToast: (m: string) => void }) {
  const { ativos, atualizarAtivos, normalizarTesouro } = useInvestimentosAtivos()
  const { preencherTodos } = useBackfillHistorico()
  const [atualizando, setAtualizando] = useState(false)
  const [normalizando, setNormalizando] = useState(false)
  const [recalculando, setRecalculando] = useState(false)
  const [progressoRecalculo, setProgressoRecalculo] = useState<{ feito: number; total: number } | null>(null)

  const precisaAtualizarTickets = useMemo(() => ativos.some(ticketIncompleto), [ativos])
  const precisaNormalizarTesouro = useMemo(() => ativos.some(tesouroDespadronizado), [ativos])

  async function handleAtualizarAtivos() {
    if (atualizando) return
    setAtualizando(true)
    const res = await atualizarAtivos()
    setAtualizando(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao atualizar tickets'); return }
    const d = res.dados
    onToast(!d || d.atualizados === 0
      ? 'Nada a atualizar — tickets já estão completos'
      : `${d.atualizados} ticket(s) atualizado(s) de ${d.processados}`)
  }

  async function handleNormalizarTesouro() {
    if (normalizando) return
    setNormalizando(true)
    const res = await normalizarTesouro()
    setNormalizando(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao padronizar os títulos do Tesouro'); return }
    const d = res.dados
    const ign = d?.ignorados?.length ? ` · ${d.ignorados.length} ignorado(s)` : ''
    onToast(!d || d.renomeados === 0
      ? `Tesouro já está padronizado${ign}`
      : `${d.renomeados} título(s) padronizado(s)${ign}`)
  }

  // Reconstrói os snapshots mensais de TODOS os ativos válidos (mesma
  // restrição de `preencherTodos`: pula quem tem cotacao_automatica=false).
  // Diferente dos outros dois botões, não tem detecção local de "precisa
  // rodar" — sobrescreve qualquer mês cujo valor recalculado hoje difira do
  // já gravado, então fica sempre visível (não só quando algo é detectado).
  async function handleRecalcularHistorico() {
    if (recalculando) return
    setRecalculando(true)
    setProgressoRecalculo(null)
    const res = await preencherTodos({
      onProgress: (feito, total) => setProgressoRecalculo({ feito, total }),
    })
    setRecalculando(false)
    setProgressoRecalculo(null)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao recalcular histórico'); return }
    const n = res.dados?.meses_gravados ?? 0
    onToast(n === 0
      ? 'Histórico já estava em dia — nada mudou.'
      : `Histórico recalculado — ${n} mês(es) atualizado(s) em ${res.dados?.ativos_processados ?? 0} ativo(s).`)
  }

  return (
    <Secao icone={<Wrench size={16} />} titulo="Manutenção de ativos"
      subtitulo="Correções automáticas de nome/ticker/histórico. As 2 primeiras só aparecem quando há algo pendente; a de histórico fica sempre disponível.">
      {!precisaAtualizarTickets && !precisaNormalizarTesouro && (
        <p className="text-[12.5px] mb-2" style={{ color: VERDE }}>Tudo em dia — nenhuma correção de nome/ticket pendente.</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {precisaAtualizarTickets && (
          <button onClick={handleAtualizarAtivos} disabled={atualizando}
            title="Re-busca nome e moeda oficiais dos ativos (corrige tickets que ficaram só com o código)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border border-white/15 text-white/90 hover:border-white/30 disabled:opacity-50">
            <RefreshCw size={15} className={atualizando ? 'animate-spin' : ''} />
            {atualizando ? 'Atualizando…' : 'Atualizar tickets'}
          </button>
        )}
        {precisaNormalizarTesouro && (
          <button onClick={handleNormalizarTesouro} disabled={normalizando}
            title="Padroniza o código e o nome dos títulos do Tesouro já cadastrados (ex.: TD-IPCA-2040)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border border-white/15 text-white/90 hover:border-white/30 disabled:opacity-50">
            <RefreshCw size={15} className={normalizando ? 'animate-spin' : ''} />
            {normalizando ? 'Padronizando…' : 'Padronizar Tesouro'}
          </button>
        )}
        <button onClick={handleRecalcularHistorico} disabled={recalculando}
          title="Reconstrói os snapshots mensais (valor de mercado e quantidade) de todos os ativos — use se algum gráfico de evolução parecer errado"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border border-white/15 text-white/90 hover:border-white/30 disabled:opacity-50">
          <RefreshCw size={15} className={recalculando ? 'animate-spin' : ''} />
          {recalculando
            ? `Recalculando…${progressoRecalculo ? ` (${progressoRecalculo.feito}/${progressoRecalculo.total})` : ''}`
            : 'Recalcular histórico'}
        </button>
      </div>
    </Secao>
  )
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
  const { posicoes, migrarConta } = useInvestimentosPosicoes()
  const [de,   setDe]   = useState('')
  const [para, setPara] = useState('')
  const [sel,  setSel]  = useState<string[]>([])
  const [confirmando, setConfirmando] = useState(false)
  const [migrando,    setMigrando]    = useState(false)

  // Só contas de INVESTIMENTO ativas fazem sentido aqui (origem e destino)
  const contasInvest = contas.filter((c) => c.tipo === 'INVESTIMENTO' && c.ativa)
  const nomeDe   = contasInvest.find((c) => c.conta_id === de)?.nome ?? ''
  const nomePara = contasInvest.find((c) => c.conta_id === para)?.nome ?? ''

  // Ativos com posição (qualquer status) na conta de origem, agrupados por
  // tipo de ativo. O MultiSelect trata cada tipo como um "pai" (clicar nele
  // seleciona/deseleciona todos os ativos daquele tipo); os ativos são os
  // "filhos". O valor do pai é um pseudo-id (`tipo:…`) que NÃO vai para a API.
  const opcoesAtivos = useMemo<MultiSelectOption[]>(() => {
    const porTipo = new Map<string, { value: string; label: string }[]>()
    const rotuloTipo = new Map<string, string>()
    const vistos = new Set<string>()
    for (const p of posicoes) {
      if (p.conta_id !== de || !p.ativo_id || vistos.has(p.ativo_id)) continue
      vistos.add(p.ativo_id)
      const tipo = (p.inv_ativos?.tipo_ativo as TipoAtivoInvestimento | undefined) ?? undefined
      const chave = tipo ?? '__outros'
      const rotulo = p.inv_ativos?.ticker
        ? `${p.inv_ativos.ticker}${p.inv_ativos?.nome ? ` — ${p.inv_ativos.nome}` : ''}`
        : p.ativo_id
      if (!porTipo.has(chave)) {
        porTipo.set(chave, [])
        rotuloTipo.set(chave, tipo ? TIPO_ATIVO_LABEL[tipo] : 'Outros')
      }
      porTipo.get(chave)!.push({ value: p.ativo_id, label: rotulo })
    }

    const opts: MultiSelectOption[] = []
    const tiposOrdenados = [...porTipo.keys()].sort((a, b) =>
      (rotuloTipo.get(a) ?? a).localeCompare(rotuloTipo.get(b) ?? b))
    for (const chave of tiposOrdenados) {
      const grupo = rotuloTipo.get(chave) ?? chave
      const paiValue = `tipo:${chave}`
      const cor = chave === '__outros' ? undefined : TIPO_ATIVO_COR[chave as TipoAtivoInvestimento]
      opts.push({ value: paiValue, label: grupo, cor })
      const filhos = porTipo.get(chave)!.sort((a, b) => a.label.localeCompare(b.label))
      for (const f of filhos) opts.push({ ...f, idPai: paiValue, grupo })
    }
    return opts
  }, [posicoes, de])

  // Só os ativos "de verdade" (filhos) — exclui os pseudo-pais de tipo.
  const idsReais = useMemo(
    () => new Set(opcoesAtivos.filter((o) => o.idPai).map((o) => o.value)),
    [opcoesAtivos])
  const selReais = sel.filter((v) => idsReais.has(v))

  // Ao trocar a conta de origem, pré-seleciona todos os ativos dela
  // (derived-state-on-change, mesmo padrão da SecaoPerfil).
  const [deAnterior, setDeAnterior] = useState('')
  if (de !== deAnterior) {
    setDeAnterior(de)
    setSel(opcoesAtivos.map((o) => o.value))
  }

  const todosSelecionados = selReais.length === idsReais.size && idsReais.size > 0

  async function migrar() {
    setConfirmando(false)
    setMigrando(true)
    // Todos selecionados → migra a conta inteira (inclui dividendos/histórico
    // de ativos sem posição na conta); seleção parcial → só os escolhidos.
    const res = await migrarConta(de, para, todosSelecionados ? undefined : selReais)
    setMigrando(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao migrar conta'); return }
    const d = res.dados
    onToast(`Migração concluída: ${d?.posicoes ?? 0} posição(ões), ${d?.operacoes ?? 0} operação(ões), ` +
      `${d?.dividendos ?? 0} provento(s) (${d?.transacoes ?? 0} lançamento(s) do extrato) e ` +
      `${(d?.historico_movido ?? 0) + (d?.historico_mesclado ?? 0)} mês(es) de histórico.`)
    setDe(''); setPara(''); setSel([])
  }

  return (
    <Secao icone={<ArrowRightLeft size={16} />} titulo="Migrar conta de investimentos"
      subtitulo="Move posições, operações, proventos (inclusive os lançamentos no extrato — o saldo acompanha) e o histórico mensal para outra conta. Escolha quais ativos migrar — útil para redistribuir a conta provisória criada pela importação entre as suas contas reais.">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <p className="text-[12.5px] mb-1" style={{ color: MUTED }}>De (conta de origem)</p>
          <SelectDark value={de} onChange={(e) => setDe(e.target.value)} style={{ width: 260 }}>
            <option value="">Selecione…</option>
            {contasInvest.map((c) => (
              <option key={c.conta_id} value={c.conta_id} disabled={c.conta_id === para}>{c.nome}</option>
            ))}
          </SelectDark>
        </div>
        <div>
          <p className="text-[12.5px] mb-1" style={{ color: MUTED }}>Para (conta de destino)</p>
          <SelectDark value={para} onChange={(e) => setPara(e.target.value)} style={{ width: 260 }}>
            <option value="">Selecione…</option>
            {contasInvest.map((c) => (
              <option key={c.conta_id} value={c.conta_id} disabled={c.conta_id === de}>{c.nome}</option>
            ))}
          </SelectDark>
        </div>
        <div>
          <p className="text-[12.5px] mb-1" style={{ color: MUTED }}>
            Ativos a migrar {de && idsReais.size > 0 ? `(${selReais.length}/${idsReais.size})` : ''}
          </p>
          <div style={{ width: 300 }}>
            <MultiSelect options={opcoesAtivos} values={sel} onChange={setSel} selecionarTodos
              placeholder={!de ? 'Escolha a conta de origem…' : opcoesAtivos.length === 0 ? 'Sem posições nesta conta' : 'Selecionar ativos…'} />
          </div>
        </div>
        <button onClick={() => setConfirmando(true)}
          disabled={!de || !para || de === para || selReais.length === 0 || migrando}
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
              Mover {todosSelecionados ? 'todos os investimentos' : `${selReais.length} ativo(s)`} de{' '}
              <strong className="text-white">"{nomeDe}"</strong> para{' '}
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
