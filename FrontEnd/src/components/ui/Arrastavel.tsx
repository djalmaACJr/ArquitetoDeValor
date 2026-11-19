import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'

// Deixa um quadro de aviso ser movido pela tela (arrastando por qualquer área
// que não seja botão/link/campo). A posição vale só enquanto o aviso estiver na
// tela. `empty:hidden`: quando o aviso interno devolve null, o wrapper some e
// não deixa espaço na pilha. Ao soltar, o quadro é mantido dentro da janela.
export default function Arrastavel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const arrasto = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const [movendo, setMovendo] = useState(false)

  function aoPressionar(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    arrasto.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
    setMovendo(true)
  }
  function aoMover(e: ReactPointerEvent<HTMLDivElement>) {
    const a = arrasto.current
    if (!a) return
    setPos({ x: a.x + e.clientX - a.px, y: a.y + e.clientY - a.py })
  }
  function aoSoltar(e: ReactPointerEvent<HTMLDivElement>) {
    if (!arrasto.current) return
    arrasto.current = null
    setMovendo(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    // Mantém ao menos o quadro inteiro dentro da janela.
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    let dx = 0, dy = 0
    if (r.left < 8) dx = 8 - r.left
    else if (r.right > window.innerWidth - 8) dx = window.innerWidth - 8 - r.right
    if (r.top < 8) dy = 8 - r.top
    else if (r.bottom > window.innerHeight - 8) dy = window.innerHeight - 8 - r.bottom
    if (dx || dy) setPos((p) => ({ x: p.x + dx, y: p.y + dy }))
  }

  return (
    <div ref={ref} onPointerDown={aoPressionar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}
      className="pointer-events-auto empty:hidden"
      title="Arraste para mover"
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px)`, position: 'relative', zIndex: movendo ? 10 : undefined,
        cursor: movendo ? 'grabbing' : 'grab', touchAction: 'none', userSelect: movendo ? 'none' : undefined,
      }}>
      {children}
    </div>
  )
}
