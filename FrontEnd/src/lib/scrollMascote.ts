// Store simples (fora do React) que diz, no app Android, se o <main> já
// rolou passado de um pequeno limiar — usado pra esconder o mascote
// (dica/tutorial) e recuperar espaço vertical numa tela pequena. Escrito
// pelo único listener de scroll de AppLayout (src/components/layout/AppLayout.tsx);
// lido via useSyncExternalStore em MascoteDica/MascoteTutorial.
let escondeMascote = false
const ouvintes = new Set<() => void>()

export function setEscondeMascotePorScroll(valor: boolean) {
  if (valor === escondeMascote) return
  escondeMascote = valor
  ouvintes.forEach(fn => fn())
}

export function subscribeEscondeMascotePorScroll(fn: () => void) {
  ouvintes.add(fn)
  return () => { ouvintes.delete(fn) }
}

export function getEscondeMascotePorScroll() {
  return escondeMascote
}
