import { useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from './Sidebar'
import { prefetchLancamentosVizinhos } from '../../hooks/useLancamentos'

export default function AppLayout() {
  const qc = useQueryClient()
  const mainRef = useRef<HTMLElement>(null)

  // Pré-aquece o cache dos meses vizinhos ao mês atual logo após o login,
  // antes mesmo do usuário navegar para a tela de Lançamentos.
  useEffect(() => {
    const mes = new Date().toISOString().slice(0, 7)
    prefetchLancamentosVizinhos(qc, mes)
  }, [qc])

  // ── Delegação de scroll para ↑ / ↓ / PageUp / PageDown / Home / End ───
  //
  // O scroll real está em <main> (porque a sidebar é fixa via h-screen no
  // container). O <body> não rola, então as teclas verticais "não fazem
  // nada" quando o foco está fora de algum scrollable.
  //
  // Esta delegação intercepta as teclas no nível do document e rola o
  // <main> programaticamente — mas só se a tecla NÃO foi tratada por
  // algum elemento focado já scrollable (input, textarea, dropdown
  // aberto, etc.).
  useEffect(() => {
    function eDescendenteScrollavel(el: Element | null, ate: Element | null): boolean {
      let n: Element | null = el
      while (n && n !== ate) {
        const overflowY = getComputedStyle(n).overflowY
        if ((overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) {
          return true
        }
        n = n.parentElement
      }
      return false
    }
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const main = mainRef.current
      if (!main) return
      // Se o foco está dentro de algum container scrollável (que não é o
      // próprio <main>), o browser já cuida — não interfere.
      if (eDescendenteScrollavel(e.target as Element, main)) return

      const passoLinha = 60
      switch (e.key) {
        case 'ArrowUp':   main.scrollBy({ top: -passoLinha,         behavior: 'smooth' }); e.preventDefault(); break
        case 'ArrowDown': main.scrollBy({ top:  passoLinha,         behavior: 'smooth' }); e.preventDefault(); break
        case 'PageUp':    main.scrollBy({ top: -main.clientHeight * 0.9, behavior: 'smooth' }); e.preventDefault(); break
        case 'PageDown':  main.scrollBy({ top:  main.clientHeight * 0.9, behavior: 'smooth' }); e.preventDefault(); break
        case 'Home':      if (!e.ctrlKey) return; main.scrollTo({ top: 0, behavior: 'smooth' }); e.preventDefault(); break
        case 'End':       if (!e.ctrlKey) return; main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' }); e.preventDefault(); break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <main ref={mainRef} className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
