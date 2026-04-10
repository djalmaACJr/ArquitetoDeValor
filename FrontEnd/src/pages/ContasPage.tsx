import { useState } from 'react'
import { Plus, Pencil, X, AlertTriangle, Check } from 'lucide-react'
import { useContas } from '../hooks/useContas'
import { formatBRL, GRUPOS_CONTA } from '../lib/utils'
import type { Conta, TipoConta } from '../types'

const TIPOS: { value: TipoConta; label: string }[] = [
  { value: 'CORRENTE',    label: 'Corrente'    },
  { value: 'REMUNERACAO', label: 'Remunerada'  },
  { value: 'CARTAO',      label: 'Cartão'      },
  { value: 'INVESTIMENTO',label: 'Investimento'},
  { value: 'CARTEIRA',    label: 'Carteira'    },
]

const CORES_SUGERIDAS = [
  '#00c896','#f0b429','#4da6ff','#7F77DD',
  '#ff6b4a','#0d1220','#e91e8c','#ff7a00',
]

// ── Formulário de conta (criar / editar) ─────────────────
interface FormState {
  nome: string; tipo: TipoConta; saldo_inicial: string
  icone: string; cor: string; ativa: boolean
}

function formVazio(): FormState {
  return { nome: '', tipo: 'CORRENTE', saldo_inicial: '0', icone: '', cor: '#00c896', ativa: true }
}

function formDeConta(c: Conta): FormState {
  return {
    nome:          c.nome,
    tipo:          c.tipo,
    saldo_inicial: String(c.saldo_inicial),
    icone:         c.icone ?? '',
    cor:           c.cor   ?? '#00c896',
    ativa:         c.ativa,
  }
}

// ── Modal ────────────────────────────────────────────────
function Modal({
  titulo, onClose, children,
}: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose}/>
      {/* Painel */}
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">{titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <X size={16}/>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ── Modal de confirmação de exclusão ─────────────────────
function ModalConfirmar({
  nome, onConfirmar, onCancelar, salvando,
}: { nome: string; onConfirmar: () => void; onCancelar: () => void; salvando: boolean }) {
  return (
    <Modal titulo="Confirmar exclusão" onClose={onCancelar}>
      <div className="flex items-start gap-3 mb-5">
        <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
          <AlertTriangle size={16} className="text-red-500"/>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-100 mb-1">
            Excluir conta "{nome}"?
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            Esta ação é permanente. Contas com lançamentos vinculados não podem ser excluídas.
          </p>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancelar}
          className="px-4 py-2 text-[12px] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={onConfirmar} disabled={salvando}
          className="px-4 py-2 text-[12px] font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
        >
          {salvando ? 'Excluindo...' : 'Excluir'}
        </button>
      </div>
    </Modal>
  )
}

// ── Formulário de criação / edição ───────────────────────
function FormConta({
  conta, onSalvar, onExcluir, onCancelar,
}: {
  conta: Conta | null
  onSalvar:  (form: FormState) => Promise<string | null>
  onExcluir: (() => void) | null
  onCancelar: () => void
}) {
  const [form, setForm]       = useState<FormState>(conta ? formDeConta(conta) : formVazio())
  const [erro, setErro]       = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const set = (campo: Partial<FormState>) => setForm(f => ({ ...f, ...campo }))

  const handleSalvar = async () => {
    if (!form.nome.trim()) { setErro('Nome é obrigatório.'); return }
    setSalvando(true)
    setErro(null)
    const err = await onSalvar(form)
    setSalvando(false)
    if (err) setErro(err)
  }

  return (
    <div className="space-y-4">
      {/* Nome */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
          Nome da conta *
        </label>
        <input
          value={form.nome} onChange={e => set({ nome: e.target.value })}
          maxLength={50} placeholder="Ex: Nubank, Sofisa..."
          className="w-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2 text-[13px] text-gray-800 dark:text-gray-100 focus:outline-none focus:border-av-green transition-colors"
        />
        <p className="text-[10px] text-gray-400 mt-1 text-right">{form.nome.length}/50</p>
      </div>

      {/* Tipo */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
          Tipo
        </label>
        <select
          value={form.tipo} onChange={e => set({ tipo: e.target.value as TipoConta })}
          className="w-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2 text-[13px] text-gray-800 dark:text-gray-100 focus:outline-none focus:border-av-green transition-colors"
        >
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {/* Saldo inicial — só na criação */}
      {!conta && (
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            Saldo inicial
          </label>
          <input
            type="number" step="0.01" value={form.saldo_inicial}
            onChange={e => set({ saldo_inicial: e.target.value })}
            className="w-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2 text-[13px] text-gray-800 dark:text-gray-100 focus:outline-none focus:border-av-green transition-colors"
          />
        </div>
      )}

      {/* Ícone + Cor */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            Ícone (emoji)
          </label>
          <input
            value={form.icone} onChange={e => set({ icone: e.target.value })}
            placeholder="🏦"
            className="w-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2 text-[18px] focus:outline-none focus:border-av-green transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            Cor
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {CORES_SUGERIDAS.map(c => (
              <button
                key={c} onClick={() => set({ cor: c })}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{ background: c, borderColor: form.cor === c ? '#fff' : c }}
                title={c}
              >
                {form.cor === c && <Check size={10} className="m-auto text-white"/>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ativa — só na edição */}
      {conta && (
        <div className="flex items-center justify-between py-2 border-t border-gray-100 dark:border-gray-700">
          <div>
            <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200">Conta ativa</p>
            <p className="text-[11px] text-gray-400">Contas inativas não aparecem na seleção de lançamentos</p>
          </div>
          <button
            onClick={() => set({ ativa: !form.ativa })}
            className={`w-11 h-6 rounded-full transition-colors relative ${form.ativa ? 'bg-av-green' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.ativa ? 'left-[22px]' : 'left-0.5'}`}/>
          </button>
        </div>
      )}

      {/* Erro */}
      {erro && (
        <p className="text-[12px] text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{erro}</p>
      )}

      {/* Botões */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
        {onExcluir && (
          <button
            onClick={onExcluir}
            className="px-4 py-2 text-[12px] font-semibold text-red-500 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            Excluir
          </button>
        )}
        <div className="flex-1"/>
        <button
          onClick={onCancelar}
          className="px-4 py-2 text-[12px] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handleSalvar} disabled={salvando}
          className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-av-dark bg-av-green rounded-lg hover:bg-av-green/90 disabled:opacity-50 transition-colors"
        >
          <Check size={13}/>
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// ── Card de conta na listagem ────────────────────────────
function CardConta({ conta, onClick }: { conta: Conta; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-3.5 flex items-center gap-3 hover:border-av-green/50 hover:bg-white dark:hover:bg-gray-600 transition-all group text-left"
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
        style={{ background: conta.cor ? `${conta.cor}20` : 'rgba(77,166,255,0.12)' }}
      >
        {conta.icone ?? '🏦'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-100 truncate">{conta.nome}</p>
        <p className="text-[11px] text-gray-400">{conta.tipo}{!conta.ativa && ' · inativa'}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[13px] font-bold" style={{ color: conta.saldo_atual >= 0 ? '#00c896' : '#ff6b4a' }}>
          {formatBRL(conta.saldo_atual)}
        </p>
        <p className="text-[10px] text-gray-400">saldo atual</p>
      </div>
      <Pencil size={13} className="text-gray-300 group-hover:text-av-green transition-colors flex-shrink-0"/>
    </button>
  )
}

// ── Página de Contas ─────────────────────────────────────
export default function ContasPage() {
  const { contas, loading, error, criar, editar, excluir } = useContas()

  const [modalNova, setModalNova]     = useState(false)
  const [contaEditar, setContaEditar] = useState<Conta | null>(null)
  const [contaExcluir, setContaExcluir] = useState<Conta | null>(null)
  const [salvando, setSalvando]       = useState(false)
  const [feedback, setFeedback]       = useState<string | null>(null)

  const mostrarFeedback = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 3000)
  }

  const handleCriar = async (form: FormState): Promise<string | null> => {
    const { ok, erro } = await criar({
      nome:          form.nome.trim(),
      tipo:          form.tipo,
      saldo_inicial: parseFloat(form.saldo_inicial) || 0,
      icone:         form.icone || undefined,
      cor:           form.cor || undefined,
    })
    if (ok) { setModalNova(false); mostrarFeedback('Conta criada com sucesso!') }
    return erro
  }

  const handleEditar = async (form: FormState): Promise<string | null> => {
    if (!contaEditar) return null
    const { ok, erro } = await editar(contaEditar.conta_id, {
      nome:  form.nome.trim(),
      tipo:  form.tipo,
      icone: form.icone || undefined,
      cor:   form.cor   || undefined,
      ativa: form.ativa,
    })
    if (ok) { setContaEditar(null); mostrarFeedback('Conta atualizada!') }
    return erro
  }

  const handleExcluir = async () => {
    if (!contaExcluir) return
    setSalvando(true)
    const { ok, erro } = await excluir(contaExcluir.conta_id)
    setSalvando(false)
    if (ok) {
      setContaExcluir(null)
      setContaEditar(null)
      mostrarFeedback('Conta excluída.')
    } else {
      setContaExcluir(null)
      mostrarFeedback(erro ?? 'Não foi possível excluir. Verifique se há lançamentos vinculados.')
    }
  }

  return (
    <div className="p-5 max-w-[900px]">
      {/* Topbar */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[17px] font-bold text-gray-800 dark:text-gray-100">Contas</h1>
        <button
          onClick={() => setModalNova(true)}
          className="flex items-center gap-1.5 bg-av-green text-av-dark text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-av-green/90 transition-colors"
        >
          <Plus size={14}/> Nova conta
        </button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div className="mb-4 px-4 py-2.5 bg-av-green/10 border border-av-green/30 text-av-green text-[12px] font-semibold rounded-lg">
          {feedback}
        </div>
      )}

      {/* Loading / erro */}
      {loading && (
        <p className="text-[13px] text-gray-400 text-center py-12">Carregando contas...</p>
      )}
      {error && (
        <p className="text-[13px] text-red-400 text-center py-12">{error}</p>
      )}

      {/* Listagem agrupada por tipo */}
      {!loading && !error && (
        <div className="space-y-6">
          {GRUPOS_CONTA.map(grupo => {
            const lista = contas.filter(c => grupo.tipos.includes(c.tipo))
            if (lista.length === 0) return null
            const totalGrupo = lista.reduce((s, c) => s + c.saldo_atual, 0)

            return (
              <div key={grupo.label}>
                {/* Cabeçalho do grupo */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: grupo.cor }}/>
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {grupo.label}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      · {lista.length} {lista.length === 1 ? 'conta' : 'contas'}
                    </span>
                  </div>
                  <span className="text-[12px] font-bold" style={{ color: grupo.cor }}>
                    {formatBRL(totalGrupo)}
                  </span>
                </div>

                {/* Cards das contas */}
                <div className="space-y-2">
                  {lista.map(conta => (
                    <CardConta
                      key={conta.conta_id}
                      conta={conta}
                      onClick={() => setContaEditar(conta)}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {contas.length === 0 && (
            <div className="text-center py-16">
              <p className="text-[13px] text-gray-400 mb-3">Nenhuma conta cadastrada ainda.</p>
              <button
                onClick={() => setModalNova(true)}
                className="text-[12px] text-av-green underline underline-offset-2"
              >
                Criar primeira conta
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal: nova conta */}
      {modalNova && (
        <Modal titulo="Nova conta" onClose={() => setModalNova(false)}>
          <FormConta
            conta={null}
            onSalvar={handleCriar}
            onExcluir={null}
            onCancelar={() => setModalNova(false)}
          />
        </Modal>
      )}

      {/* Modal: editar conta */}
      {contaEditar && (
        <Modal titulo={`Editar — ${contaEditar.nome}`} onClose={() => setContaEditar(null)}>
          <FormConta
            conta={contaEditar}
            onSalvar={handleEditar}
            onExcluir={() => setContaExcluir(contaEditar)}
            onCancelar={() => setContaEditar(null)}
          />
        </Modal>
      )}

      {/* Modal: confirmar exclusão */}
      {contaExcluir && (
        <ModalConfirmar
          nome={contaExcluir.nome}
          onConfirmar={handleExcluir}
          onCancelar={() => setContaExcluir(null)}
          salvando={salvando}
        />
      )}
    </div>
  )
}
