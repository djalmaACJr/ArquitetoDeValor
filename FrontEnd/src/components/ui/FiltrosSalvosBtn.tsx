// src/components/ui/FiltrosSalvosBtn.tsx
// Botão + dropdown para salvar, listar e aplicar filtros nomeados.
// Reutilizável em qualquer página — identifica-se pela prop `pagina`.
import { useState, useEffect, useRef } from 'react'
import { Bookmark, X } from 'lucide-react'
import { useFiltrosSalvos } from '../../hooks/useFiltrosSalvos'

interface Props {
  /** Identificador da página — ex.: 'extrato', 'relatorios' */
  pagina: string
  /** Valores atuais dos filtros da página (qualquer estrutura JSONB) */
  filtAtual: Record<string, unknown>
  /** Indica se há pelo menos um filtro não-padrão ativo */
  temFiltroAtivo: boolean
  /** Chamado ao clicar num filtro salvo — recebe `dados` como foi salvo */
  onAplicar: (dados: Record<string, unknown>) => void
}

export function FiltrosSalvosBtn({ pagina, filtAtual, temFiltroAtivo, onAplicar }: Props) {
  const { filtros, carregando, salvar, excluir } = useFiltrosSalvos(pagina)
  const [aberto, setAberto] = useState(false)
  const [nome, setNome]     = useState('')
  const [salvando, setSalvando] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    function onClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', onClickFora)
    return () => document.removeEventListener('mousedown', onClickFora)
  }, [aberto])

  const handleSalvar = async () => {
    const n = nome.trim()
    if (!n) return
    setSalvando(true)
    await salvar(n, filtAtual)
    setSalvando(false)
    setNome('')
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Botão principal */}
      <button
        onClick={() => setAberto(v => !v)}
        title="Filtros salvos"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all"
        style={{
          background:  aberto ? 'rgba(77,166,255,0.1)' : 'transparent',
          borderColor: aberto ? 'rgba(77,166,255,0.4)' : 'rgba(255,255,255,0.1)',
          color:       aberto ? '#4da6ff' : '#8b92a8',
        }}
      >
        <Bookmark size={13} />
        {filtros.length > 0 && (
          <span className="text-[10px] font-bold" style={{ color: 'inherit' }}>
            {filtros.length}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {aberto && (
        <div
          className="absolute top-9 right-0 z-30 rounded-xl border shadow-xl"
          style={{ background: '#1a1f2e', borderColor: 'rgba(255,255,255,0.1)', minWidth: 280 }}
        >
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-white/10">
            <p className="text-[12px] font-semibold" style={{ color: '#e8eaf0' }}>Filtros salvos</p>
          </div>

          {/* Lista */}
          {carregando ? (
            <p className="px-4 py-3 text-[11px]" style={{ color: '#8b92a8' }}>Carregando…</p>
          ) : filtros.length === 0 ? (
            <p className="px-4 py-3 text-[11px]" style={{ color: '#8b92a8' }}>
              Nenhum filtro salvo ainda.
            </p>
          ) : (
            <div className="py-1 max-h-52 overflow-y-auto">
              {filtros.map(f => (
                <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03] group">
                  <button
                    onClick={() => { onAplicar(f.dados); setAberto(false) }}
                    className="flex-1 text-left text-[12px] truncate"
                    style={{ color: '#c5cad8' }}
                  >
                    {f.nome}
                  </button>
                  <button
                    onClick={() => excluir(f.id)}
                    title="Excluir filtro"
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded hover:bg-red-400/10 flex-shrink-0"
                    style={{ color: '#f87171' }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Salvar filtro atual */}
          <div className="px-4 py-3 border-t border-white/10">
            {temFiltroAtivo ? (
              <>
                <p className="text-[10px] mb-2" style={{ color: '#8b92a8' }}>Salvar filtro atual:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Nome do filtro"
                    value={nome}
                    onChange={e => setNome(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSalvar()}
                    autoFocus
                    className="flex-1 text-[11px] bg-[#252d42] border border-white/10 rounded-lg px-2 py-1.5 focus:outline-none focus:border-white/25"
                    style={{ color: '#e8eaf0' }}
                  />
                  <button
                    onClick={handleSalvar}
                    disabled={!nome.trim() || salvando}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40"
                    style={{ background: '#4da6ff', color: '#0a0f1a' }}
                  >
                    {salvando ? '…' : 'Salvar'}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[10px] text-center" style={{ color: '#8b92a8' }}>
                Aplique filtros de conta, categoria ou status para salvar.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
