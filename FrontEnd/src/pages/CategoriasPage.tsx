// src/pages/CategoriasPage.tsx
import { useState, useEffect, useRef } from 'react'
import { Plus, Pencil, X as XIcon, ChevronDown, ChevronUp, Shield, RefreshCw, ArrowLeft } from 'lucide-react'
import { useCategorias } from '../hooks/useCategorias'
import {
  Drawer, ColorPicker, IconPicker, Field, Input, SelectDark,
  Toggle, PreviewBadge, BtnSalvar, BtnCancelar, Segmented, Toast, ModalExcluir,
} from '../components/ui/shared'
import type { Categoria } from '../types'
import { apiFetch, apiMutate, extrairLista } from '../lib/api'
import { formatBRL, formatData } from '../lib/utils'

// ── Helpers de importação paralela ───────────────────────────────────────────
const _sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function dividirEmChunks<T>(itens: T[], maxWorkers: number): T[][] {
  if (itens.length === 0) return []
  const n = Math.min(maxWorkers, itens.length)
  const tamanho = Math.ceil(itens.length / n)
  return Array.from({ length: n }, (_, i) => itens.slice(i * tamanho, (i + 1) * tamanho)).filter(c => c.length > 0)
}

async function apiComRetry(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  tentativas = 3,
): Promise<Awaited<ReturnType<typeof apiMutate>>> {
  for (let t = 0; t < tentativas; t++) {
    const r = await apiMutate(path, method, body)
    if (r.ok || !(r.erro ?? '').includes('NetworkError')) return r
    if (t < tentativas - 1) await _sleep(2000)
  }
  return apiMutate(path, method, body)
}

// ── Tipo local para transações no painel de reclassificação ──────────────────
interface TxReclassif {
  id: string
  data: string
  descricao: string
  valor: number
  tipo: 'RECEITA' | 'DESPESA'
  status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
  conta_nome?: string | null
}

const STATUS_COR:   Record<string, string> = { PAGO: '#4ade80', PENDENTE: '#facc15', PROJECAO: '#94a3b8' }
const STATUS_LABEL: Record<string, string> = { PAGO: 'Pago', PENDENTE: 'Pendente', PROJECAO: 'Projeção' }

// ── Painel de reclassificação ─────────────────────────────────────────────────
function PainelReclassificacao({
  categoria,
  todasCategorias,
  onFechar,
}: {
  categoria: Categoria
  todasCategorias: Categoria[]
  onFechar: (reclassificouAlgo: boolean) => void
}) {
  const [transacoes,    setTransacoes]    = useState<TxReclassif[]>([])
  const [loading,       setLoading]       = useState(true)
  const [erro,          setErro]          = useState<string | null>(null)
  const [catDestinoId,  setCatDestinoId]  = useState('')
  const [processando,   setProcessando]   = useState(false)
  const [progresso,     setProgresso]     = useState<{ feitos: number; total: number } | null>(null)
  const canceladoRef    = useRef(false)
  const reclassificouRef = useRef(false)

  useEffect(() => {
    let ativo = true
    setLoading(true); setErro(null)
    apiFetch<unknown>(`/transacoes?categoria_id=${categoria.id}&per_page=500`)
      .then(res => {
        if (!ativo) return
        if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar transações')
        setTransacoes(extrairLista<TxReclassif>(res.dados))
        setLoading(false)
      })
      .catch(e => { if (!ativo) return; setErro((e as Error).message); setLoading(false) })
    return () => { ativo = false }
  }, [categoria.id])

  const reclassificarUm = async (id: string) => {
    if (!catDestinoId || processando) return
    const res = await apiComRetry(`/transacoes/${id}?escopo=SOMENTE_ESTE`, 'PUT', { categoria_id: catDestinoId })
    if (res.ok) {
      reclassificouRef.current = true
      setTransacoes(prev => prev.filter(t => t.id !== id))
    }
  }

  const reclassificarTodas = async () => {
    if (!catDestinoId || transacoes.length === 0 || processando) return
    setProcessando(true)
    canceladoRef.current = false
    const copia = [...transacoes]
    const total = copia.length
    setProgresso({ feitos: 0, total })
    let feitos = 0

    await Promise.all(dividirEmChunks(copia, 8).map(async chunk => {
      for (const tx of chunk) {
        if (canceladoRef.current) break
        const res = await apiComRetry(`/transacoes/${tx.id}?escopo=SOMENTE_ESTE`, 'PUT', { categoria_id: catDestinoId })
        if (res.ok) {
          feitos++
          reclassificouRef.current = true
          setProgresso(p => p ? { ...p, feitos } : null)
          setTransacoes(prev => prev.filter(t => t.id !== tx.id))
        }
      }
    }))

    setProcessando(false)
    setProgresso(null)
  }

  const catDest = todasCategorias.find(c => c.id === catDestinoId)

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0a0f1a' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <button
          onClick={() => onFechar(reclassificouRef.current)}
          className="w-8 h-8 rounded-lg border flex items-center justify-center transition-all hover:bg-white/5"
          style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#8b92a8' }}>
          <ArrowLeft size={16} />
        </button>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[17px] flex-shrink-0"
          style={{ background: `${categoria.cor ?? '#888'}22` }}>
          {categoria.icone ?? '📂'}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-bold" style={{ color: '#e8eaf0' }}>Reclassificar transações</h2>
          <p className="text-[11px]" style={{ color: '#8b92a8' }}>
            {categoria.descricao}
            {!loading && ` · ${transacoes.length} transaç${transacoes.length === 1 ? 'ão' : 'ões'} encontrada${transacoes.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      {/* Barra de controles */}
      <div className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0 flex-wrap"
        style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#111827' }}>
        <span className="text-[12px] font-medium flex-shrink-0" style={{ color: '#8b92a8' }}>
          Nova categoria:
        </span>
        <SelectDark value={catDestinoId} onChange={e => setCatDestinoId(e.target.value)}>
          <option value="">Selecione...</option>
          {(() => {
            const naoProteg = todasCategorias.filter(c => !c.protegida && c.ativa && c.id !== categoria.id)
            const pais = naoProteg.filter(c => !c.id_pai)
              .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
            const vistos = new Set<string>()
            const elems: React.ReactNode[] = []

            for (const pai of pais) {
              const filhos = naoProteg.filter(c => c.id_pai === pai.id)
                .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
              vistos.add(pai.id)
              filhos.forEach(f => vistos.add(f.id))

              if (filhos.length > 0) {
                elems.push(
                  <optgroup key={pai.id} label={`${pai.icone ?? ''} ${pai.descricao}`}
                    style={{ background: '#252d42', color: '#8b92a8' }}>
                    <option value={pai.id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                      {pai.icone ?? ''} {pai.descricao}
                    </option>
                    {filhos.map(f => (
                      <option key={f.id} value={f.id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                        {f.icone ?? ''} {f.descricao}
                      </option>
                    ))}
                  </optgroup>
                )
              } else {
                elems.push(
                  <option key={pai.id} value={pai.id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                    {pai.icone ?? ''} {pai.descricao}
                  </option>
                )
              }
            }

            // Subcategorias cujo pai foi excluído da lista (ex: pai = categoria atual)
            naoProteg.filter(c => !vistos.has(c.id))
              .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
              .forEach(c => elems.push(
                <option key={c.id} value={c.id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                  {c.icone ?? ''} {c.descricao}
                </option>
              ))

            return elems
          })()}
        </SelectDark>
        {catDestinoId && transacoes.length > 0 && (
          <button
            onClick={reclassificarTodas}
            disabled={processando}
            className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60 flex-shrink-0"
            style={{ background: '#00c896', color: '#0a0f1a' }}>
            <RefreshCw size={12} className={processando ? 'animate-spin' : ''} />
            {progresso ? `Processando ${progresso.feitos}/${progresso.total}...` : 'Reclassificar todas'}
          </button>
        )}
        {processando && (
          <button
            onClick={() => { canceladoRef.current = true }}
            className="text-[12px] px-3 py-1.5 rounded-lg border transition-colors flex-shrink-0"
            style={{ borderColor: 'rgba(248,113,113,0.3)', color: '#f87171' }}>
            Cancelar
          </button>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && (
          <p className="text-[13px] text-center py-12" style={{ color: '#8b92a8' }}>Carregando...</p>
        )}
        {erro && (
          <p className="text-[13px] text-center py-12" style={{ color: '#f87171' }}>{erro}</p>
        )}
        {!loading && !erro && transacoes.length === 0 && (
          <div className="text-center py-16">
            <p className="text-[13px]" style={{ color: '#8b92a8' }}>
              Nenhuma transação encontrada nesta categoria.
            </p>
          </div>
        )}
        {!loading && !erro && transacoes.length > 0 && (
          <div className="space-y-1 max-w-3xl">
            {transacoes.map(t => (
              <div key={t.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
                style={{ borderColor: 'rgba(255,255,255,0.06)', background: '#1a1f2e' }}>

                {/* Data */}
                <span className="text-[11px] flex-shrink-0 w-[68px]" style={{ color: '#8b92a8' }}>
                  {formatData(t.data)}
                </span>

                {/* Descrição */}
                <span className="flex-1 text-[12px] truncate" style={{ color: '#c5cad8' }}>
                  {t.descricao}
                </span>

                {/* Conta */}
                {t.conta_nome && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 flex-shrink-0"
                    style={{ color: '#8b92a8' }}>
                    {t.conta_nome}
                  </span>
                )}

                {/* Status */}
                <span className="text-[10px] font-semibold flex-shrink-0 w-14 text-right"
                  style={{ color: STATUS_COR[t.status] ?? '#8b92a8' }}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>

                {/* Valor */}
                <span className="text-[12px] font-semibold w-24 text-right flex-shrink-0"
                  style={{ color: t.tipo === 'RECEITA' ? '#4ade80' : '#f87171' }}>
                  {t.tipo === 'RECEITA' ? '+' : '-'}{formatBRL(t.valor)}
                </span>

                {/* Botão mover */}
                <button
                  onClick={() => reclassificarUm(t.id)}
                  disabled={!catDestinoId || processando}
                  title={catDest ? `Mover para: ${catDest.descricao}` : 'Selecione a nova categoria'}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all disabled:opacity-30 flex-shrink-0 hover:bg-av-green/10"
                  style={{ borderColor: 'rgba(0,200,150,0.3)', color: '#00c896' }}>
                  Mover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tipos do formulário ───────────────────────────────────────────────────────
type Nivel = 'pai' | 'sub'
interface FormState {
  descricao: string; nivel: Nivel; id_pai: string
  icone: string; cor: string; ativa: boolean
}
const FORM_VAZIO: FormState = { descricao: '', nivel: 'pai', id_pai: '', icone: '🏠', cor: '#00c896', ativa: true }

function formDeCat(c: Categoria): FormState {
  return {
    descricao: c.descricao, nivel: c.id_pai ? 'sub' : 'pai',
    id_pai: c.id_pai ?? '', icone: c.icone ?? '🏠', cor: c.cor ?? '#00c896', ativa: c.ativa,
  }
}

// ── Botão de ação pequeno ─────────────────────────────────────────────────────
function AcaoBtn({ onClick, title, danger = false, children }: {
  onClick: (e: React.MouseEvent) => void; title: string; danger?: boolean; children: React.ReactNode
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(e) }}
      title={title}
      className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center
        transition-all flex-shrink-0"
      style={{ color: danger ? '#f87171' : '#8b92a8' }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.background = danger ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.06)'
        el.style.borderColor = danger ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.25)'
        el.style.color = danger ? '#f87171' : '#e8eaf0'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.background = 'transparent'
        el.style.borderColor = 'rgba(255,255,255,0.1)'
        el.style.color = danger ? '#f87171' : '#8b92a8'
      }}
    >
      {children}
    </button>
  )
}

export default function CategoriasPage() {
  const { categorias, loading, error, criar, editar, excluir } = useCategorias()
  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [editando,     setEditando]     = useState<Categoria | null>(null)
  const [excluindo,    setExcluindo]    = useState<Categoria | null>(null)
  const [form,         setForm]         = useState<FormState>(FORM_VAZIO)
  const [erro,         setErro]         = useState<string | null>(null)
  const [salvando,     setSalvando]     = useState(false)
  const [feedback,     setFeedback]     = useState<string | null>(null)
  const [expandidos,   setExpandidos]   = useState<Set<string>>(new Set())
  const [busca,        setBusca]        = useState('')
  const [catReclassif, setCatReclassif] = useState<Categoria | null>(null)

  const pais   = categorias.filter(c => !c.id_pai)
  const subsOf = (id: string) => categorias.filter(c => c.id_pai === id)
  const set    = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }))
  const toast  = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3000) }

  const abrirNovo   = () => { setEditando(null); setForm(FORM_VAZIO); setErro(null); setDrawerOpen(true) }
  const abrirEditar = (c: Categoria) => { setEditando(c); setForm(formDeCat(c)); setErro(null); setDrawerOpen(true) }
  const fechar      = () => { setDrawerOpen(false); setEditando(null); setErro(null) }

  const salvar = async () => {
    if (!form.descricao.trim()) { setErro('Descrição é obrigatória.'); return }
    if (form.nivel === 'sub' && !form.id_pai) { setErro('Selecione a categoria pai.'); return }
    setSalvando(true); setErro(null)
    const payload = {
      descricao: form.descricao.trim(),
      id_pai:    form.nivel === 'sub' ? form.id_pai : null,
      icone:     form.icone || undefined,
      cor:       form.cor   || undefined,
    }
    if (editando) {
      const { ok, erro: e } = await editar(editando.id, { ...payload, ativa: form.ativa })
      if (ok) { fechar(); toast('Categoria atualizada!') } else setErro(e ?? 'Erro ao salvar.')
    } else {
      const { ok, erro: e } = await criar(payload)
      if (ok) { fechar(); toast('Categoria criada!') } else setErro(e ?? 'Erro ao salvar.')
    }
    setSalvando(false)
  }

  const confirmarExclusao = async () => {
    if (!excluindo) return
    setSalvando(true)
    const { ok, erro: e } = await excluir(excluindo.id)
    setSalvando(false); setExcluindo(null)
    if (ok) { fechar(); toast('Categoria excluída.') } else toast(e ?? 'Não foi possível excluir.')
  }

  const toggleExp = (id: string) =>
    setExpandidos(prev => {
      const s = new Set(prev)
      if (s.has(id)) { s.delete(id) } else { s.add(id) }
      return s
    })

  const q = busca.toLowerCase()
  const paisFiltrados = pais.filter(p =>
    !q || p.descricao.toLowerCase().includes(q) ||
    subsOf(p.id).some(s => s.descricao.toLowerCase().includes(q))
  )

  if (catReclassif) {
    return (
      <PainelReclassificacao
        categoria={catReclassif}
        todasCategorias={categorias}
        onFechar={reclassificouAlgo => {
          setCatReclassif(null)
          if (reclassificouAlgo) toast('Reclassificação concluída!')
        }}
      />
    )
  }

  return (
    <div className="p-5 max-w-[860px]">
      {/* Topbar */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[17px] font-bold" style={{ color: '#e8eaf0' }}>Categorias</h1>
        <button onClick={abrirNovo}
          className="flex items-center gap-1.5 bg-av-green text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-av-green/90 transition-colors"
          style={{ color: '#0a0f1a' }}>
          <Plus size={14} /> Nova categoria
        </button>
      </div>

      <Toast msg={feedback} />

      {/* Busca */}
      <input value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="Buscar categoria..."
        className="mb-4 w-full max-w-xs bg-[#252d42] border border-white/10 rounded-lg px-3 py-2
          text-[13px] outline-none focus:border-av-green transition-colors placeholder:text-white/30"
        style={{ color: '#e8eaf0' }} />

      {loading && <p className="text-[13px] text-center py-12" style={{ color: '#8b92a8' }}>Carregando...</p>}
      {error   && <p className="text-[13px] text-center py-12" style={{ color: '#f87171' }}>{error}</p>}

      {/* Lista hierárquica */}
      {!loading && !error && (
        <div className="space-y-1.5">
          {paisFiltrados.map(p => {
            const subs  = subsOf(p.id).filter(s =>
              !q || p.descricao.toLowerCase().includes(q) || s.descricao.toLowerCase().includes(q)
            )
            const isExp = expandidos.has(p.id)

            return (
              <div key={p.id}>
                {/* ── Linha pai ── */}
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-white/10 bg-[#1a1f2e] cursor-pointer select-none" onClick={() => subs.length > 0 && toggleExp(p.id)}>

                  {/* Ícone */}
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[17px] flex-shrink-0"
                    style={{ background: `${p.cor ?? '#888'}22` }}>
                    {p.icone ?? '📂'}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold truncate" style={{ color: '#e8eaf0' }}>
                        {p.descricao}
                      </span>
                      {p.protegida && (
                        <Shield size={11} style={{ color: '#7F77DD' }} className="flex-shrink-0" />
                      )}
                      {!p.ativa && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/5"
                          style={{ color: '#8b92a8' }}>Inativa</span>
                      )}
                    </div>
                    <p className="text-[10px] mt-0.5" style={{ color: '#8b92a8' }}>
                      {subs.length} subcategoria{subs.length !== 1 ? 's' : ''}
                    </p>
                  </div>

                  {/* Botões */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {subs.length > 0 && (
                      <span style={{ color: '#8b92a8' }}>
                        {isExp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </span>
                    )}
                    {!p.protegida && (
                      <>
                        <AcaoBtn onClick={() => setCatReclassif(p)} title="Reclassificar transações">
                          <RefreshCw size={12} />
                        </AcaoBtn>
                        <AcaoBtn onClick={() => abrirEditar(p)} title="Editar">
                          <Pencil size={12} />
                        </AcaoBtn>
                        <div className="w-2" />
                        <AcaoBtn onClick={() => setExcluindo(p)} title="Excluir" danger>
                          <XIcon size={12} />
                        </AcaoBtn>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Subcategorias ── */}
                {isExp && subs.length > 0 && (
                  <div className="ml-8 mt-1 space-y-1 pl-3 border-l-2 border-white/5">
                    {subs.map(s => (
                      <div key={s.id}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/5 bg-[#252d42]/50">

                        <div className="w-6 h-6 rounded-md flex items-center justify-center text-[13px] flex-shrink-0"
                          style={{ background: `${s.cor ?? '#888'}22` }}>
                          {s.icone ?? '📂'}
                        </div>

                        <span className="flex-1 text-[12px] font-medium truncate" style={{ color: '#c5cad8' }}>
                          {s.descricao}
                        </span>

                        {!s.ativa && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/5"
                            style={{ color: '#8b92a8' }}>Inativa</span>
                        )}

                        {/* Botões subcategoria */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!s.protegida && (
                            <AcaoBtn onClick={() => setCatReclassif(s)} title="Reclassificar transações">
                              <RefreshCw size={12} />
                            </AcaoBtn>
                          )}
                          <AcaoBtn onClick={() => abrirEditar(s)} title="Editar">
                            <Pencil size={12} />
                          </AcaoBtn>
                          <div className="w-2" />
                          <AcaoBtn onClick={() => setExcluindo(s)} title="Excluir" danger>
                            <XIcon size={12} />
                          </AcaoBtn>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {categorias.length === 0 && !busca && (
            <div className="text-center py-16">
              <p className="text-[13px] mb-3" style={{ color: '#8b92a8' }}>Nenhuma categoria cadastrada.</p>
              <button onClick={abrirNovo} className="text-[12px] underline underline-offset-2"
                style={{ color: '#00c896' }}>Criar primeira categoria</button>
            </div>
          )}
          {categorias.length > 0 && paisFiltrados.length === 0 && (
            <p className="text-[13px] text-center py-8" style={{ color: '#8b92a8' }}>Nenhuma encontrada.</p>
          )}
        </div>
      )}

      {/* Drawer */}
      <Drawer open={drawerOpen} onClose={fechar}
        titulo={editando ? 'Editar categoria' : 'Nova categoria'}
        subtitulo={editando?.descricao ?? 'Preencha os dados abaixo'}
        rodape={
          <><BtnCancelar onClick={fechar} />
          <BtnSalvar editando={!!editando} salvando={salvando} onClick={salvar}
            labelSalvar="Salvar categoria" labelEditar="Atualizar" /></>
        }>

        <Field label="Nível">
          <Segmented
            opcoes={[{ value: 'pai', label: 'Categoria pai' }, { value: 'sub', label: 'Subcategoria' }]}
            value={form.nivel} onChange={v => set({ nivel: v as Nivel, id_pai: '' })} />
        </Field>

        {form.nivel === 'sub' && (
          <Field label="Categoria pai *">
            <SelectDark value={form.id_pai} onChange={e => set({ id_pai: e.target.value })}>
              <option value="">Selecione...</option>
              {pais.filter(p => !p.protegida && p.id !== editando?.id).map(p => (
                <option key={p.id} value={p.id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                  {p.icone ?? ''} {p.descricao}
                </option>
              ))}
            </SelectDark>
          </Field>
        )}

        <Field label="Descrição *">
          <div className="relative">
            <Input value={form.descricao} onChange={e => set({ descricao: e.target.value })}
              placeholder="Ex: Alimentação" maxLength={50} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px]"
              style={{ color: '#8b92a8' }}>{form.descricao.length}/50</span>
          </div>
        </Field>

        <Field label="Ícone">
          <IconPicker value={form.icone} onChange={v => set({ icone: v })} />
        </Field>

        <Field label="Cor">
          <ColorPicker value={form.cor} onChange={v => set({ cor: v })} />
        </Field>

        {editando && (
          <Field label="Status">
            <Toggle checked={form.ativa} onChange={v => set({ ativa: v })}
              label={form.ativa ? 'Ativa' : 'Inativa'} />
          </Field>
        )}

        <Field label="Pré-visualização">
          <PreviewBadge icone={form.icone} label={form.descricao || 'Nova categoria'} cor={form.cor} />
        </Field>

        {editando && !editando.protegida && (
          <button onClick={() => setExcluindo(editando)}
            className="w-full py-2 text-[12px] font-semibold border border-red-400/20 rounded-lg
              hover:bg-red-400/10 transition-colors mt-2"
            style={{ color: '#f87171' }}>
            Excluir categoria
          </button>
        )}

        {erro && (
          <p className="text-[12px] bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
            style={{ color: '#f87171' }}>{erro}</p>
        )}
      </Drawer>

      {excluindo && (
        <ModalExcluir nome={excluindo.descricao}
          mensagem="Categorias com subcategorias ou lançamentos vinculados não podem ser excluídas."
          onConfirmar={confirmarExclusao} onCancelar={() => setExcluindo(null)} salvando={salvando} />
      )}
    </div>
  )
}
