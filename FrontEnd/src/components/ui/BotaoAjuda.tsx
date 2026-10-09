import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'

/**
 * Botão "?" que abre um balão com a explicação de um recurso. Abre por clique
 * (funciona no toque, onde não existe hover) e fecha com clique fora, Esc ou
 * clicando de novo.
 */
export default function BotaoAjuda({
  titulo, children, alinhar = 'esquerda', tamanho = 15,
}: {
  titulo: string
  children: ReactNode
  /** Lado do botão em que o balão se ancora (use 'direita' perto da borda direita da tela). */
  alinhar?: 'esquerda' | 'direita'
  tamanho?: number
}) {
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent | TouchEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('touchstart', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('touchstart', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])

  return (
    <span ref={raiz} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        aria-label={`Ajuda: ${titulo}`}
        aria-expanded={aberto}
        aria-controls={id}
        title={`Ajuda: ${titulo}`}
        className="rounded-full transition-colors hover:bg-white/10 p-0.5"
        style={{ color: aberto ? '#4da6ff' : '#8b92a8' }}
      >
        <HelpCircle size={tamanho} />
      </button>
      {aberto && (
        <div
          id={id}
          role="dialog"
          className="absolute top-full mt-2 z-50 rounded-xl border p-3.5 text-left shadow-xl"
          style={{
            [alinhar === 'esquerda' ? 'left' : 'right']: 0,
            width: 'min(22rem, calc(100vw - 2.5rem))',
            background: '#1a1f2e',
            borderColor: 'rgba(77,166,255,0.35)',
            color: '#c5cad8',
          }}
        >
          <p className="text-[15px] font-bold mb-1.5 normal-case tracking-normal" style={{ color: '#e8eaf0' }}>{titulo}</p>
          <div className="text-[14px] leading-relaxed font-normal normal-case tracking-normal space-y-1.5">{children}</div>
        </div>
      )}
    </span>
  )
}
