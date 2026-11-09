import { useEffect, useRef } from 'react'

// Atalho Backspace para "voltar um nível" em gráficos/quadros com drill-down.
// `ativo` = há um nível anterior para onde voltar (senão o atalho fica inerte).
// Ignora quando o foco está num campo de digitação, quando há modal aberto
// ou com Ctrl/Alt/Meta/Shift (Backspace comum só).
export function useAtalhoVoltarNivel(ativo: boolean, voltar: () => void) {
  const voltarRef = useRef(voltar)
  useEffect(() => { voltarRef.current = voltar })

  useEffect(() => {
    if (!ativo) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' || e.defaultPrevented) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      e.preventDefault()
      voltarRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [ativo])
}
