import { useMemo, useState } from 'react'
import { FileSearch, Sparkles } from 'lucide-react'
import InvestimentosNav from '../components/ui/InvestimentosNav'
import { Toast, SelectDark } from '../components/ui/shared'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes } from '../hooks/useInvestimentosPosicoes'
import { useRelatoriosFii, useRelatoriosAuto, listarRelatoriosDisponiveis, sincronizarRelatoriosFii } from '../hooks/useRelatoriosFii'
import { useEmEspacoDeAgregado } from '../hooks/useEspacoAtivo'
import { useIAPreferencia } from '../hooks/useIAPreferencia'
import { provedorPorId } from '../lib/iaProvedores'
import CartaoAnalise from '../components/ui/CartaoAnaliseRelatorio'
import { formatData } from '../lib/utils'
import { TIPO_ATIVO_LABEL } from '../lib/constants'
import type { RelatorioFiiDisponivel } from '../types'

const MUTED = '#8b92a8'
const TODOS = 'TODOS'
const TIPOS_ANALISAVEIS: string[] = ['FII', 'ACOES', 'STOCKS', 'REIT']
const ULTIMOS_3 = 'ULTIMOS3'
type ModoAnalise = 'NOVOS' | 'REFAZER' | 'OUTRO'
const DESCRICAO_MODO: Record<ModoAnalise, string> = {
  NOVOS:   'Analisa só o que ainda não tem análise (não gasta tokens à toa).',
  REFAZER: 'Gera de novo, com a sua IA ativa, mesmo o que já foi analisado — a análise anterior é substituída.',
  OUTRO:   'Gera de novo pedindo a análise a outro mentor de IA já cadastrado — a análise anterior é substituída.',
}

export default function RelatoriosFiiPage() {
  const emEspacoAgregado = useEmEspacoDeAgregado()
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000) }

  const { ativos: todosAtivos } = useInvestimentosAtivos()
  const ativos = useMemo(() => todosAtivos.filter((a) => TIPOS_ANALISAVEIS.includes(a.tipo_ativo)), [todosAtivos])
  const { posicoes } = useInvestimentosPosicoes({ status: 'ATIVA' })
  const { analises, loading, analisar, marcarVisto, excluir } = useRelatoriosFii()
  const auto = useRelatoriosAuto()

  const fiisEmCarteira = useMemo(() => {
    const comSaldo = new Set(posicoes.filter((p) => Number(p.quantidade) > 0).map((p) => p.ativo_id))
    return ativos.filter((a) => comSaldo.has(a.id)).sort((a, b) => a.ticker.localeCompare(b.ticker))
  }, [ativos, posicoes])

  const [tipoRun, setTipoRun] = useState('')
  const [resumo, setResumo] = useState<string | null>(null)
  const [ativoId, setAtivoId] = useState('')
  const [disponiveis, setDisponiveis] = useState<RelatorioFiiDisponivel[]>([])
  const [relatorioId, setRelatorioId] = useState('')
  const [analisando, setAnalisando] = useState(false)
  const [progresso, setProgresso] = useState('')
  const [modo, setModo] = useState<ModoAnalise>('NOVOS')
  const [configId, setConfigId] = useState('')
  const { configs: motores, ativa: motorAtivo } = useIAPreferencia()
  const outrosMotores = useMemo(() => motores.filter((c) => c.id !== motorAtivo?.id), [motores, motorAtivo])
  const motorSel = configId || outrosMotores[0]?.id || ''
  const tiposEmCarteira = useMemo(() => TIPOS_ANALISAVEIS.filter((t) => fiisEmCarteira.some((a) => a.tipo_ativo === t)), [fiisEmCarteira])
  const candidatos = useMemo(() => fiisEmCarteira.filter((a) => !tipoRun || a.tipo_ativo === tipoRun), [fiisEmCarteira, tipoRun])
  const ativoSel = (ativoId && (ativoId === TODOS || candidatos.some((a) => a.id === ativoId)) ? ativoId : '') || (candidatos.length > 1 ? TODOS : candidatos[0]?.id) || ''
  const todos = ativoSel === TODOS

  // Filtros da lista de análises
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroFii, setFiltroFii] = useState('')
  const [filtroMes, setFiltroMes] = useState('')
  const [soNovos, setSoNovos] = useState(false)
  // A lista de análises não traz o tipo: cruza com os ativos já carregados.
  const tipoDoAtivo = useMemo(() => new Map(todosAtivos.map((a) => [a.id, a.tipo_ativo as string])), [todosAtivos])
  const tiposDasAnalises = useMemo(() => {
    const s = new Set<string>()
    for (const a of analises) { const t = tipoDoAtivo.get(a.ativo_id); if (t) s.add(t) }
    return TIPOS_ANALISAVEIS.filter((t) => s.has(t))
  }, [analises, tipoDoAtivo])
  const fiisDasAnalises = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of analises) if (!filtroTipo || tipoDoAtivo.get(a.ativo_id) === filtroTipo) m.set(a.ativo_id, a.inv_ativos?.ticker ?? '—')
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]))
  }, [analises, filtroTipo, tipoDoAtivo])
  const mesesDasAnalises = useMemo(() => {
    const s = new Set<string>()
    for (const a of analises) if (a.data_referencia) s.add(a.data_referencia.slice(0, 7))
    return [...s].sort().reverse()
  }, [analises])
  const analisesFiltradas = useMemo(() => analises.filter((a) =>
    (!filtroTipo || tipoDoAtivo.get(a.ativo_id) === filtroTipo) &&
    (!filtroFii || a.ativo_id === filtroFii) &&
    (!filtroMes || (a.data_referencia ?? '').slice(0, 7) === filtroMes) &&
    (!soNovos || !a.visto_em)), [analises, filtroTipo, tipoDoAtivo, filtroFii, filtroMes, soNovos])

  function trocarTipoRun(tipo: string) {
    setTipoRun(tipo); setAtivoId(''); setDisponiveis([]); setRelatorioId('')
  }

  async function trocarAtivo(id: string) {
    setAtivoId(id); setDisponiveis([])
    // "Todos os ativos" só aceita as opções genéricas (mais recente / 3 últimos).
    if (id === TODOS) { if (relatorioId && relatorioId !== ULTIMOS_3) setRelatorioId(''); return }
    setRelatorioId('')
    if (id) setDisponiveis(await listarRelatoriosDisponiveis(id))
  }

  async function rodar() {
    if (!ativoSel) return
    if (modo === 'OUTRO' && !motorSel) { showToast('Cadastre outro mentor de IA em Perfil → Integração com IA.'); return }
    setAnalisando(true); setResumo(null)
    const alvos = todos ? candidatos : candidatos.filter((a) => a.id === ativoSel)
    const cfg = modo === 'OUTRO' ? motorSel : undefined
    let ok = 0, puladas = 0
    const erros: string[] = []
    // O cron diário só guarda ~12 dias de relatórios; se faltar, busca uma
    // janela maior no Fundos.NET (uma única vez por execução).
    let sincronizado = false
    const garantirCache = async (a: { id: string; tipo_ativo: string }) => {
      if (a.tipo_ativo !== 'FII') { setProgresso(`${a.tipo_ativo === 'ACOES' ? 'Buscando resultado na CVM' : 'Buscando relatórios na SEC'}…`); await sincronizarRelatoriosFii(100, a.id); return }
      if (sincronizado) return
      sincronizado = true
      setProgresso('Buscando relatórios no Fundos.NET… (até 2 min)')
      await sincronizarRelatoriosFii()
    }
    const ordenar = (l: RelatorioFiiDisponivel[]) => [...l].sort((x, y) => (y.data_referencia ?? y.data_entrega).localeCompare(x.data_referencia ?? x.data_entrega))
    for (let i = 0; i < alvos.length; i++) {
      const a = alvos[i]
      const prefixo = alvos.length > 1 ? `${a.ticker} (${i + 1}/${alvos.length}) — ` : ''
      setProgresso(`${prefixo}buscando relatórios…`)
      let lista = ordenar(await listarRelatoriosDisponiveis(a.id))
      if (lista.length < (relatorioId === ULTIMOS_3 ? 3 : 1)) { await garantirCache(a); lista = ordenar(await listarRelatoriosDisponiveis(a.id)) }

      // Do mais antigo para o mais novo, para a análise de cada mês poder
      // comparar com a do mês anterior.
      let alvoRel: RelatorioFiiDisponivel[]
      if (relatorioId === ULTIMOS_3) alvoRel = lista.slice(0, 3).reverse()
      else if (relatorioId) alvoRel = lista.filter((r) => String(r.id) === relatorioId)
      else alvoRel = lista.slice(0, 1)
      if (alvoRel.length === 0) { erros.push(`${a.ticker}: sem relatório disponível`); continue }

      // "Somente novos" pula o que já tem análise; os outros modos refazem (a análise anterior é substituída).
      const fazer = modo === 'NOVOS' ? alvoRel.filter((r) => !r.analisado) : alvoRel
      puladas += alvoRel.length - fazer.length
      for (const r of fazer) {
        setProgresso(`${prefixo}${modo === 'NOVOS' ? 'analisando' : 'refazendo'}…`)
        const res = await analisar(a.id, r.id, cfg)
        if (res.ok) ok++; else erros.push(`${a.ticker}: ${res.erro ?? 'erro ao analisar'}`)
      }
    }
    setAnalisando(false); setProgresso('')
    const rotulo = modo === 'NOVOS' ? (ok === 1 ? 'análise nova feita' : 'análises novas feitas') : (ok === 1 ? 'análise refeita' : 'análises refeitas')
    const partes = [`${ok} ${rotulo}`]
    if (puladas > 0) partes.push(`${puladas} já estava(m) analisada(s)`)
    if (erros.length > 0) partes.push(`${erros.length} falha(s): ${erros[0]}`)
    const msg = partes.join(' · ')
    setResumo(msg)   // fica na tela até ser dispensado (o toast some em 4s)
    showToast(msg)
  }

  async function alternarAuto() {
    const ok = await auto.definir(!auto.ativo)
    showToast(ok ? (auto.ativo ? 'Análise automática desligada.' : 'Análise automática ligada.') : 'Não foi possível salvar.')
  }

  const naoLidas = analises.filter((a) => !a.visto_em).length

  return (
    <div className="space-y-5">
      <InvestimentosNav />
      <div>
        <h1 className="text-white text-[22px] font-semibold flex items-center gap-2"><FileSearch size={22} style={{ color: '#3b82f6' }} /> Análise de Relatórios</h1>
        <p className="text-[13px] mt-1" style={{ color: MUTED }}>
          A IA lê o Relatório Gerencial dos seus FIIs, o resultado trimestral das suas ações (dados da CVM) e os relatórios 10-Q/10-K das suas stocks (SEC),
          e aponta pontos fortes, pontos de atenção e inconsistências, comparando com o período anterior. É uma leitura de apoio — confira o PDF e não trate como recomendação de investimento.
        </p>
      </div>

      {emEspacoAgregado ? (
        <p className="text-[14px] rounded-lg border border-white/10 p-4" style={{ color: MUTED }}>
          Esta página usa a chave de IA de quem está logado e só funciona em "Meus dados".
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-white/10 p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={auto.ativo} disabled={auto.loading} onChange={alternarAuto} />
              <span>
                <span className="text-white text-[14px] font-medium">Analisar automaticamente quando sair um relatório novo</span>
                <span className="block text-[12px]" style={{ color: MUTED }}>
                  Roda todo dia de manhã para os FIIs, ações e stocks que você possui. Usa a sua IA ativa (Perfil → Integração com IA) e consome tokens da sua chave — cerca de 1 chamada por ativo a cada divulgação (mensal nos FIIs, trimestral nas ações e stocks).
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-white/10">
              <div className="min-w-[160px]">
                <p className="text-[12px] mb-1" style={{ color: MUTED }}>Tipo de ativo</p>
                <SelectDark value={tipoRun} onChange={(e) => trocarTipoRun(e.target.value)}>
                  <option value="">Todos os tipos</option>
                  {tiposEmCarteira.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t as keyof typeof TIPO_ATIVO_LABEL] ?? t}</option>)}
                </SelectDark>
              </div>
              <div className="min-w-[200px]">
                <p className="text-[12px] mb-1" style={{ color: MUTED }}>Ativo</p>
                <SelectDark value={ativoSel} onChange={(e) => trocarAtivo(e.target.value)}>
                  {candidatos.length === 0 && <option value="">Nenhum ativo analisável em carteira</option>}
                  {candidatos.length > 1 && <option value={TODOS}>{tipoRun ? 'Todos deste tipo' : 'Todos os ativos'}</option>}
                  {candidatos.map((a) => <option key={a.id} value={a.id}>{a.ticker}</option>)}
                </SelectDark>
              </div>
              <div className="min-w-[240px]">
                <p className="text-[12px] mb-1" style={{ color: MUTED }}>Relatório</p>
                <SelectDark value={relatorioId} onChange={(e) => setRelatorioId(e.target.value)}
                  onFocus={() => { if (ativoSel && !todos && disponiveis.length === 0) void trocarAtivo(ativoSel) }}>
                  <option value="">Mais recente</option>
                  <option value={ULTIMOS_3}>3 últimos relatórios</option>
                  {!todos && disponiveis.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.data_referencia ? formatData(r.data_referencia) : formatData(r.data_entrega.slice(0, 10))}{r.analisado ? ' · já analisado' : ''}
                    </option>
                  ))}
                </SelectDark>
              </div>
              <div className="min-w-[200px]">
                <p className="text-[12px] mb-1" style={{ color: MUTED }}>Tipo de análise</p>
                <SelectDark value={modo} onChange={(e) => setModo(e.target.value as ModoAnalise)}>
                  <option value="NOVOS">Verificar somente novos</option>
                  <option value="REFAZER">Refazer análises</option>
                  <option value="OUTRO">Pedir análise a outro mentor</option>
                </SelectDark>
              </div>
              {modo === 'OUTRO' && (
                <div className="min-w-[220px]">
                  <p className="text-[12px] mb-1" style={{ color: MUTED }}>Mentor</p>
                  {outrosMotores.length === 0 ? (
                    <p className="text-[12px] py-2" style={{ color: '#f0b429' }}>Nenhum outro mentor cadastrado (Perfil → Integração com IA).</p>
                  ) : (
                    <SelectDark value={motorSel} onChange={(e) => setConfigId(e.target.value)}>
                      {outrosMotores.map((c) => (
                        <option key={c.id} value={c.id}>{c.nome || provedorPorId(c.provedor)?.label || c.provedor}{c.modelo ? ' · ' + c.modelo : ''}</option>
                      ))}
                    </SelectDark>
                  )}
                </div>
              )}
              <button onClick={rodar} disabled={analisando || !ativoSel || (modo === 'OUTRO' && !motorSel)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>
                <Sparkles size={14} className={analisando ? 'animate-pulse' : ''} /> {analisando ? (progresso || 'Analisando… (até 1 min)') : 'Analisar agora'}
              </button>
            </div>
            <p className="text-[12px]" style={{ color: MUTED }}>{DESCRICAO_MODO[modo]}</p>
            {resumo && (
              <div role="status" className="flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-[13px] text-white" style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)' }}>
                <span>✅ {resumo}</span>
                <button onClick={() => setResumo(null)} className="text-[12px] underline shrink-0" style={{ color: MUTED }}>Fechar</button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-white text-[16px] font-semibold">Análises {naoLidas > 0 && <span className="text-[12px] font-normal text-blue-300">· {naoLidas} nova(s)</span>}</h2>
          </div>

          {analises.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[160px]">
                <p className="text-[12px] mb-1" style={{ color: MUTED }}>Filtrar por tipo</p>
                <SelectDark value={filtroTipo} onChange={(e) => { setFiltroTipo(e.target.value); setFiltroFii('') }}>
                  <option value="">Todos</option>
                  {tiposDasAnalises.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t as keyof typeof TIPO_ATIVO_LABEL] ?? t}</option>)}
                </SelectDark>
              </div>
              <div className="min-w-[160px]">
                <p className="text-[12px] mb-1" style={{ color: MUTED }}>Filtrar por ativo</p>
                <SelectDark value={filtroFii} onChange={(e) => setFiltroFii(e.target.value)}>
                  <option value="">Todos</option>
                  {fiisDasAnalises.map(([id, tk]) => <option key={id} value={id}>{tk}</option>)}
                </SelectDark>
              </div>
              <div className="min-w-[160px]">
                <p className="text-[12px] mb-1" style={{ color: MUTED }}>Mês do relatório</p>
                <SelectDark value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)}>
                  <option value="">Todos</option>
                  {mesesDasAnalises.map((m) => <option key={m} value={m}>{m.slice(5)}/{m.slice(0, 4)}</option>)}
                </SelectDark>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-white/85 cursor-pointer pb-2">
                <input type="checkbox" checked={soNovos} onChange={(e) => setSoNovos(e.target.checked)} /> Somente novas
              </label>
            </div>
          )}

          {loading ? (
            <p className="text-[13px]" style={{ color: MUTED }}>Carregando…</p>
          ) : analises.length === 0 ? (
            <p className="text-[13px] text-center py-8" style={{ color: MUTED }}>
              Nenhuma análise ainda. Escolha um ativo e clique em "Analisar agora", ou ligue a análise automática.
            </p>
          ) : analisesFiltradas.length === 0 ? (
            <p className="text-[13px] text-center py-8" style={{ color: MUTED }}>Nenhuma análise com esses filtros.</p>
          ) : (
            <div className="space-y-3">
              {analisesFiltradas.map((a) => (
                <CartaoAnalise key={a.id} a={a}
                  onVisto={async () => { await marcarVisto(a.id) }}
                  onExcluir={async () => { const r = await excluir(a.id); if (!r.ok) showToast(r.erro ?? 'Erro ao excluir') }} />
              ))}
            </div>
          )}
        </>
      )}
      <Toast msg={toast} />
    </div>
  )
}
