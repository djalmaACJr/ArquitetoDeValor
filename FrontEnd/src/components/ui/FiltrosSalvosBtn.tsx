// src/components/ui/FiltrosSalvosBtn.tsx
// Botão + dropdown para salvar e aplicar filtros nomeados.
// Exibe TODOS os filtros do usuário (qualquer página) com badge de origem.
// Exclusão de filtros só é permitida na tela de Perfil.
import { useState, useEffect, useRef } from 'react'
import { Bookmark } from 'lucide-react'
import { useFiltrosSalvos } from '../../hooks/useFiltrosSalvos'

const PAGINA_LABEL: Record<string, string> = {
  extrato:    'Extrato',
  relatorios: 'Relatórios',
  dashboard:  'Dashboard',
}

interface Props {
  /** Identificador da página — ex.: 'extrato', 'relatorios' */
  pagina: string
  /** Valores atuais dos filtros da página (qualquer estrutura JSONB) */
  filtAtual: Record<string, unknown>
  /** Indica se há pelo menos um filtro não-padrão ativo */
  temFiltroAtivo: boolean
  /** Chamado ao clicar num filtro salvo — recebe `dados` como foi salvo */
  onAplicar: (dados: Record<string, unknown>) => void
  /** Chamado ao clicar em "Limpar filtros" — se omitido, botão não aparece */
  onLimpar?: () => void
}

export function FiltrosSalvosBtn({ pagina, filtAtual, temFiltroAtivo, onAplicar, onLimpar }: Props) {
  const { filtros, carregando, salvar } = useFiltrosSalvos(pagina)
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
    <div ref={ref} className="relative flex-shrink-0 flex items-center gap-1.5">
      {/* Limpar filtros */}
      {temFiltroAtivo && onLimpar && (
        <button
          onClick={onLimpar}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all hover:bg-white/5"
          style={{ borderColor: 'rgba(248,113,113,0.3)', color: '#f87171' }}
        >
          × Limpar
        </button>
      )}
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
        <span className="text-[11px] font-medium" style={{ color: 'inherit' }}>
          {filtros.length > 0 ? `Filtros (${filtros.length})` : 'Filtros'}
        </span>
      </button>

      {/* Dropdown */}
      {aberto && (
        <div
          className="absolute top-9 right-0 z-30 rounded-xl border shadow-xl"
          style={{ background: '#1a1f2e', borderColor: 'rgba(255,255,255,0.1)', minWidth: 300 }}
        >
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-white/10">
            <p className="text-[12px] font-semibold" style={{ color: '#e8eaf0' }}>Filtros salvos</p>
            <p className="text-[10px] mt-0.5" style={{ color: '#4a5168' }}>
              Clique para aplicar · Gerencie na tela de Perfil
            </p>
          </div>

          {/* Lista — todos os filtros do usuário */}
          {carregando ? (
            <p className="px-4 py-3 text-[11px]" style={{ color: '#8b92a8' }}>Carregando…</p>
          ) : filtros.length === 0 ? (
            <p className="px-4 py-3 text-[11px]" style={{ color: '#8b92a8' }}>
              Nenhum filtro salvo ainda.
            </p>
          ) : (
            <div className="py-1 max-h-56 overflow-y-auto">
              {filtros.map(f => (
                <button
                  key={f.id}
                  onClick={() => { onAplicar(f.dados); setAberto(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.04] transition-colors text-left"
                >
                  <span
                    className="text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background: 'rgba(77,166,255,0.12)', color: '#4da6ff' }}
                  >
                    {PAGINA_LABEL[f.pagina] ?? f.pagina}
                  </span>
                  <span className="flex-1 text-[12px] truncate" style={{ color: '#c5cad8' }}>
                    {f.nome}
                  </span>
                </button>
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
