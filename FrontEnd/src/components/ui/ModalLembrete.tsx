import { useState, useEffect, useRef } from 'react'
import { X, Bell, Check } from 'lucide-react'
import { useLembretes } from '../../hooks/useLembretes'
import type { Lembrete } from '../../types'

interface Props {
  aberto:            boolean
  onFechar:          () => void
  lembrete?:         Lembrete | null   // se preenchido, abre em modo edição
  dataInicial?:      string            // YYYY-MM-DD
  descricaoInicial?: string
  onSalvo?:          () => void
}

export default function ModalLembrete({ aberto, onFechar, lembrete, dataInicial, descricaoInicial, onSalvo }: Props) {
  const hoje = new Date().toISOString().split('T')[0]
  const { criar, editar } = useLembretes()

  const [data,      setData]      = useState(dataInicial ?? hoje)
  const [descricao, setDescricao] = useState(descricaoInicial ?? '')
  const [status,    setStatus]    = useState<'PENDENTE' | 'CONCLUIDO'>(lembrete?.status ?? 'PENDENTE')
  const [salvando,  setSalvando]  = useState(false)
  const [erro,      setErro]      = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!aberto) return
    setData(lembrete?.data ?? dataInicial ?? hoje)
    setDescricao(lembrete?.descricao ?? descricaoInicial ?? '')
    setStatus(lembrete?.status ?? 'PENDENTE')
    setErro(null)
    setTimeout(() => inputRef.current?.focus(), 80)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, lembrete])

  // Fecha com Escape
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape' && aberto) onFechar() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [aberto, onFechar])

  if (!aberto) return null

  const salvar = async () => {
    if (!descricao.trim()) { setErro('Informe uma descrição.'); return }
    if (!data)             { setErro('Informe uma data.'); return }
    setSalvando(true)
    setErro(null)
    let res
    if (lembrete) {
      res = await editar(lembrete.id, { data, descricao: descricao.trim(), status })
    } else {
      res = await criar({ data, descricao: descricao.trim() })
    }
    setSalvando(false)
    if (res.ok) { onSalvo?.(); onFechar() }
    else setErro(res.erro ?? 'Erro ao salvar.')
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 z-[200]"
        onClick={onFechar}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed z-[201] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[min(420px,calc(100vw-32px))] rounded-2xl border border-white/10 flex flex-col"
        style={{ background: '#1a1f2e' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Bell size={15} style={{ color: '#f0b429' }} />
            <span className="text-[14px] font-semibold" style={{ color: '#e8eaf0' }}>
              {lembrete ? 'Editar lembrete' : 'Novo lembrete'}
            </span>
          </div>
          <button
            onClick={onFechar}
            className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center
              transition-all hover:border-white/30"
            style={{ color: '#8b92a8' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          {/* Data */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
              Data
            </label>
            <input
              type="date"
              value={data}
              onChange={e => setData(e.target.value)}
              className="w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2
                text-[13px] outline-none focus:border-av-green transition-colors"
              style={{ color: '#e8eaf0', colorScheme: 'dark' }}
            />
          </div>

          {/* Descrição */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
              Descrição
            </label>
            <input
              ref={inputRef}
              type="text"
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') salvar() }}
              maxLength={200}
              placeholder="Descrição do lembrete…"
              className="w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2
                text-[13px] outline-none focus:border-av-green transition-colors
                placeholder:text-white/30"
              style={{ color: '#e8eaf0' }}
            />
            <span className="text-right text-[10px]" style={{ color: '#8b92a8' }}>
              {descricao.length}/200
            </span>
          </div>

          {/* Status — só ao editar */}
          {lembrete && (
            <button
              type="button"
              onClick={() => setStatus(s => s === 'CONCLUIDO' ? 'PENDENTE' : 'CONCLUIDO')}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-[12px] font-semibold w-fit"
              style={{
                background: status === 'CONCLUIDO' ? 'rgba(0,200,150,0.1)'  : 'rgba(255,255,255,0.04)',
                border:     status === 'CONCLUIDO' ? '1px solid rgba(0,200,150,0.35)' : '1px solid rgba(255,255,255,0.1)',
                color:      status === 'CONCLUIDO' ? '#00c896' : '#8b92a8',
              }}
            >
              <Check size={13} />
              {status === 'CONCLUIDO' ? 'Concluído' : 'Pendente'}
            </button>
          )}

          {/* Erro */}
          {erro && (
            <p className="text-[12px] bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
              style={{ color: '#f87171' }}>
              {erro}
            </p>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button
            onClick={onFechar}
            className="px-4 py-2 rounded-lg border border-white/10 text-[12px] font-semibold
              transition-all hover:border-white/30"
            style={{ color: '#8b92a8' }}
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold
              transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: '#f0b429', color: '#1a1f2e' }}
          >
            {salvando ? 'Salvando…' : lembrete ? 'Atualizar' : 'Criar lembrete'}
          </button>
        </div>
      </div>
    </>
  )
}
