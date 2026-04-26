// src/pages/CategoriasPage.tsx
import { useState } from 'react'
import { Plus, Pencil, X as XIcon, ChevronDown, ChevronUp, Shield } from 'lucide-react'
import { useCategorias } from '../hooks/useCategorias'
import {
  Drawer, ColorPicker, IconPicker, Field, Input, SelectDark,
  Toggle, PreviewBadge, BtnSalvar, BtnCancelar, Segmented, Toast, ModalExcluir,
} from '../components/ui/shared'
import type { Categoria } from '../types'

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

// ── Botão de ação pequeno ─────────────────────────────────────
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editando,   setEditando]   = useState<Categoria | null>(null)
  const [excluindo,  setExcluindo]  = useState<Categoria | null>(null)
  const [form,       setForm]       = useState<FormState>(FORM_VAZIO)
  const [erro,       setErro]       = useState<string | null>(null)
  const [salvando,   setSalvando]   = useState(false)
  const [feedback,   setFeedback]   = useState<string | null>(null)
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [busca,      setBusca]      = useState('')

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
                        <Shield size={11} style={{ color: '#7F77DD' }} className="flex-shrink-0" title="Protegida" />
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

                  {/* Botões — sempre visíveis: editar | excluir | expandir */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {subs.length > 0 && (
                      <span style={{ color: '#8b92a8' }}>
                        {isExp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </span>
                    )}
                    {!p.protegida && (
                      <>
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
