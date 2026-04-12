// src/pages/ContasPage.tsx
import { useState } from 'react'
import { Plus, Pencil, X as XIcon } from 'lucide-react'
import { useContas } from '../hooks/useContas'
import { formatBRL } from '../lib/utils'
import { IconeConta } from '../components/ui/IconeConta'
import {
  Drawer, ColorPicker, Field, Input, SelectDark,
  Toggle, BtnSalvar, BtnCancelar, Toast, ModalExcluir,
} from '../components/ui/shared'
import type { Conta, TipoConta } from '../types'

const TIPOS: { value: TipoConta; label: string }[] = [
  { value: 'CORRENTE',     label: 'Corrente'    },
  { value: 'REMUNERACAO',  label: 'Remunerada'  },
  { value: 'CARTAO',       label: 'Cartão'       },
  { value: 'INVESTIMENTO', label: 'Investimento' },
  { value: 'CARTEIRA',     label: 'Carteira'     },
]

type Grupo = { label: string; tipos: TipoConta[]; cor: string }

const GRUPOS_INICIAL: Grupo[] = [
  { label: 'Corrente / Remunerada', tipos: ['CORRENTE', 'REMUNERACAO'], cor: '#00c896' },
  { label: 'Cartão de Crédito',     tipos: ['CARTAO'],                  cor: '#e91e8c' },
  { label: 'Investimento',          tipos: ['INVESTIMENTO'],            cor: '#f0b429' },
  { label: 'Carteira',              tipos: ['CARTEIRA'],                cor: '#4da6ff' },
]

interface FormState {
  nome: string; tipo: TipoConta; saldo_inicial: string
  icone: string; cor: string; ativa: boolean
}
const FORM_VAZIO: FormState = {
  nome: '', tipo: 'CORRENTE', saldo_inicial: '0', icone: '', cor: '#00c896', ativa: true,
}
const formDeConta = (c: Conta): FormState => ({
  nome: c.nome, tipo: c.tipo, saldo_inicial: String(c.saldo_inicial),
  icone: c.icone ?? '', cor: c.cor ?? '#00c896', ativa: c.ativa,
})

function AcaoBtn({ onClick, title, danger = false, children }: {
  onClick: (e: React.MouseEvent) => void; title: string; danger?: boolean; children: React.ReactNode
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(e) }}
      title={title}
      className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center transition-all flex-shrink-0"
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

function LinhaConta({ conta, onEditar, onExcluir }: {
  conta: Conta; onEditar: () => void; onExcluir: () => void
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-white/10 bg-[#1a1f2e]">
      <IconeConta icone={conta.icone} cor={conta.cor} size="md" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate" style={{ color: '#e8eaf0' }}>{conta.nome}</p>
        <p className="text-[10px] mt-0.5" style={{ color: '#8b92a8' }}>
          {conta.tipo}{!conta.ativa ? ' · inativa' : ''}
        </p>
      </div>
      <div className="text-right flex-shrink-0 mr-1">
        <p className="text-[12px] font-bold"
          style={{ color: conta.saldo_atual >= 0 ? '#00c896' : '#f87171' }}>
          {formatBRL(conta.saldo_atual)}
        </p>
        <p className="text-[9px]" style={{ color: '#8b92a8' }}>saldo atual</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <AcaoBtn onClick={onEditar} title="Editar"><Pencil size={12} /></AcaoBtn>
        <div className="w-1.5" />
        <AcaoBtn onClick={onExcluir} title="Excluir" danger><XIcon size={12} /></AcaoBtn>
      </div>
    </div>
  )
}

export default function ContasPage() {
  const { contas, loading, error, criar, editar, excluir } = useContas()

  // Ordem dos grupos — reordenável pelo usuário
  const [ordemGrupos, setOrdemGrupos] = useState<Grupo[]>(GRUPOS_INICIAL)

  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [contaEditar,  setContaEditar]  = useState<Conta | null>(null)
  const [contaExcluir, setContaExcluir] = useState<Conta | null>(null)
  const [salvando,     setSalvando]     = useState(false)
  const [feedback,     setFeedback]     = useState<string | null>(null)
  const [form,         setForm]         = useState<FormState>(FORM_VAZIO)
  const [erro,         setErro]         = useState<string | null>(null)

  const set   = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }))
  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3000) }

  // Move grupo na posição idx para a direção dir (-1 esquerda, +1 direita)
  const moverGrupo = (idx: number, dir: number) => {
    const alvo = idx + dir
    if (alvo < 0 || alvo >= ordemGrupos.length) return
    setOrdemGrupos(prev => {
      const next = [...prev]
      ;[next[idx], next[alvo]] = [next[alvo], next[idx]]
      return next
    })
  }

  const abrirNova   = () => { setContaEditar(null); setForm(FORM_VAZIO); setErro(null); setDrawerOpen(true) }
  const abrirEditar = (c: Conta) => { setContaEditar(c); setForm(formDeConta(c)); setErro(null); setDrawerOpen(true) }
  const fechar      = () => { setDrawerOpen(false); setContaEditar(null); setErro(null) }

  const salvar = async () => {
    if (!form.nome.trim()) { setErro('Nome é obrigatório.'); return }
    setSalvando(true); setErro(null)
    if (contaEditar) {
      const { ok, erro: e } = await editar(contaEditar.conta_id, {
        nome: form.nome.trim(), tipo: form.tipo,
        icone: form.icone || undefined, cor: form.cor || undefined, ativa: form.ativa,
      })
      setSalvando(false)
      if (ok) { fechar(); toast('Conta atualizada!') } else setErro(e ?? 'Erro ao salvar.')
    } else {
      const { ok, erro: e } = await criar({
        nome: form.nome.trim(), tipo: form.tipo,
        saldo_inicial: parseFloat(form.saldo_inicial) || 0,
        icone: form.icone || undefined, cor: form.cor || undefined,
      })
      setSalvando(false)
      if (ok) { fechar(); toast('Conta criada com sucesso!') } else setErro(e ?? 'Erro ao salvar.')
    }
  }

  const handleExcluir = async () => {
    if (!contaExcluir) return
    setSalvando(true)
    const { ok, erro: e } = await excluir(contaExcluir.conta_id)
    setSalvando(false)
    if (ok) { setContaExcluir(null); fechar(); toast('Conta excluída.') }
    else { setContaExcluir(null); toast(e ?? 'Não foi possível excluir.') }
  }

  // Grupos com contas filtradas, na ordem do usuário
  const gruposComContas = ordemGrupos
    .map((g, idx) => ({ g, idx, lista: contas.filter(c => g.tipos.includes(c.tipo)) }))
    .filter(({ lista }) => lista.length > 0)

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[17px] font-bold" style={{ color: '#e8eaf0' }}>Contas</h1>
        <button onClick={abrirNova}
          className="flex items-center gap-1.5 bg-av-green text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-av-green/90 transition-colors"
          style={{ color: '#0a0f1a' }}>
          <Plus size={14} /> Nova conta
        </button>
      </div>

      <Toast msg={feedback} />

      {loading && <p className="text-[13px] text-center py-12" style={{ color: '#8b92a8' }}>Carregando contas...</p>}
      {error   && <p className="text-[13px] text-center py-12" style={{ color: '#f87171' }}>{error}</p>}

      {!loading && !error && contas.length > 0 && (
        /*
          Grid responsivo:
          1 col em mobile | 2 cols em tablet | 3 cols em desktop
          Cada grupo com contas ocupa 1 célula.
          O usuário reordena com os botões ◀ ▶ no cabeçalho de cada grupo.
        */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
          {gruposComContas.map(({ g, idx, lista }) => {
            const total = lista.reduce((s, c) => s + c.saldo_atual, 0)
            // Posição entre os grupos COM contas (para setas)
            const posComContas  = gruposComContas.findIndex(x => x.idx === idx)
            const isFirst       = posComContas === 0
            const isLast        = posComContas === gruposComContas.length - 1

            return (
              <div key={g.label} className="flex flex-col gap-1.5">
                {/* Cabeçalho do grupo */}
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: g.cor }} />
                    <span className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: '#8b92a8' }}>
                      {g.label}
                    </span>
                    <span className="text-[10px] flex-shrink-0" style={{ color: '#8b92a8' }}>· {lista.length}</span>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
                    {/* Reordenar ◀ ▶ */}
                    <button
                      onClick={() => moverGrupo(idx, -1)}
                      disabled={isFirst}
                      title="Mover para a esquerda"
                      className="w-5 h-5 rounded flex items-center justify-center text-[9px] transition-all disabled:opacity-20 hover:bg-white/5"
                      style={{ color: '#8b92a8' }}>◀</button>
                    <button
                      onClick={() => moverGrupo(idx, 1)}
                      disabled={isLast}
                      title="Mover para a direita"
                      className="w-5 h-5 rounded flex items-center justify-center text-[9px] transition-all disabled:opacity-20 hover:bg-white/5"
                      style={{ color: '#8b92a8' }}>▶</button>
                    <span className="text-[11px] font-bold ml-1"
                      style={{ color: total >= 0 ? g.cor : '#f87171' }}>
                      {formatBRL(total)}
                    </span>
                  </div>
                </div>

                {/* Linhas de conta */}
                {lista.map(c => (
                  <LinhaConta key={c.conta_id} conta={c}
                    onEditar={() => abrirEditar(c)}
                    onExcluir={() => setContaExcluir(c)} />
                ))}
              </div>
            )
          })}
        </div>
      )}

      {!loading && !error && contas.length === 0 && (
        <div className="text-center py-16">
          <p className="text-[13px] mb-3" style={{ color: '#8b92a8' }}>Nenhuma conta cadastrada ainda.</p>
          <button onClick={abrirNova} className="text-[12px] underline underline-offset-2"
            style={{ color: '#00c896' }}>Criar primeira conta</button>
        </div>
      )}

      {/* Drawer */}
      <Drawer
        open={drawerOpen} onClose={fechar}
        titulo={contaEditar ? `Editar — ${contaEditar.nome}` : 'Nova conta'}
        subtitulo={contaEditar ? contaEditar.tipo : 'Preencha os dados abaixo'}
        rodape={
          <>
            <BtnCancelar onClick={fechar} />
            <BtnSalvar editando={!!contaEditar} salvando={salvando} onClick={salvar}
              labelSalvar="Salvar conta" labelEditar="Atualizar" />
          </>
        }
      >
        <Field label="Nome da conta *">
          <div className="relative">
            <Input value={form.nome} onChange={e => set({ nome: e.target.value })}
              placeholder="Ex: Nubank, Sofisa..." maxLength={50} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px]"
              style={{ color: '#8b92a8' }}>{form.nome.length}/50</span>
          </div>
        </Field>

        <Field label="Tipo">
          <SelectDark value={form.tipo} onChange={e => set({ tipo: e.target.value as TipoConta })}>
            {TIPOS.map(t => (
              <option key={t.value} value={t.value} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                {t.label}
              </option>
            ))}
          </SelectDark>
        </Field>

        <Field label={contaEditar ? 'Saldo inicial (não editável)' : 'Saldo inicial'}>
          <Input
            type="number" step="0.01"
            value={form.saldo_inicial}
            onChange={e => { if (!contaEditar) set({ saldo_inicial: e.target.value }) }}
            readOnly={!!contaEditar}
            style={contaEditar ? { opacity: 0.5, cursor: 'not-allowed', color: '#e8eaf0' } : { color: '#e8eaf0' }}
          />
          {contaEditar && (
            <p className="text-[10px] mt-1" style={{ color: '#8b92a8' }}>
              O saldo inicial não pode ser alterado. O saldo atual é calculado pelos lançamentos.
            </p>
          )}
        </Field>

        <Field label="Ícone / Logo">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden border border-white/10"
              style={{ background: form.cor ? `${form.cor}22` : 'rgba(77,166,255,0.12)' }}>
              {form.icone?.startsWith('data:') ? (
                <img src={form.icone} alt="" className="w-full h-full object-contain p-[3px]" />
              ) : (
                <span className="text-xl">{form.icone || '🏦'}</span>
              )}
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="cursor-pointer flex items-center gap-1.5 text-[11px] border border-white/10
                rounded-lg px-2.5 py-1.5 hover:border-white/25 transition-colors" style={{ color: '#4da6ff' }}>
                📁 Escolher imagem
                <input type="file" accept="image/*" className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]; if (!file) return
                    const reader = new FileReader()
                    reader.onload = ev => {
                      const img = new Image()
                      img.onload = () => {
                        const canvas = document.createElement('canvas')
                        canvas.width = 64; canvas.height = 64
                        const ctx = canvas.getContext('2d')!
                        const scale = Math.min(64 / img.width, 64 / img.height)
                        const w = img.width * scale; const h = img.height * scale
                        ctx.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h)
                        set({ icone: canvas.toDataURL('image/png') })
                      }
                      img.src = ev.target?.result as string
                    }
                    reader.readAsDataURL(file)
                  }} />
              </label>
              <input
                value={form.icone?.startsWith('data:') ? '' : (form.icone ?? '')}
                onChange={e => set({ icone: e.target.value })}
                placeholder="ou emoji 🏦"
                className="w-full bg-[#252d42] border border-white/10 rounded-lg px-2.5 py-1.5
                  text-[13px] outline-none focus:border-av-green transition-colors placeholder:text-white/30"
                style={{ color: '#e8eaf0' }}
              />
              {form.icone && (
                <button onClick={() => set({ icone: '' })}
                  className="text-[10px] text-left hover:text-red-400 transition-colors"
                  style={{ color: '#8b92a8' }}>✕ Remover ícone</button>
              )}
            </div>
          </div>
        </Field>

        <Field label="Cor">
          <ColorPicker value={form.cor} onChange={v => set({ cor: v })} />
        </Field>

        {contaEditar && (
          <Field label="Status">
            <Toggle checked={form.ativa} onChange={v => set({ ativa: v })}
              label={form.ativa ? 'Ativa' : 'Inativa'} />
          </Field>
        )}

        {erro && (
          <p className="text-[12px] bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
            style={{ color: '#f87171' }}>{erro}</p>
        )}

        {contaEditar && (
          <button onClick={() => setContaExcluir(contaEditar)}
            className="w-full py-2 text-[12px] font-semibold border border-red-400/20 rounded-lg
              hover:bg-red-400/10 transition-colors mt-2"
            style={{ color: '#f87171' }}>
            Excluir conta
          </button>
        )}
      </Drawer>

      {contaExcluir && (
        <ModalExcluir
          nome={contaExcluir.nome}
          mensagem="Esta ação é permanente. Contas com lançamentos vinculados não podem ser excluídas."
          onConfirmar={handleExcluir}
          onCancelar={() => setContaExcluir(null)}
          salvando={salvando}
        />
      )}
    </div>
  )
}
