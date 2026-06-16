// src/lib/autoLogoutAviso.ts
//
// Ponte entre o useAutoLogout (que conhece o relógio de inatividade) e a UI
// (Sidebar), sem prop-drilling nem context. Quando faltam poucos segundos para
// o logout por inatividade, o hook publica aqui {avisando, segundos}; a Sidebar
// lê via useSyncExternalStore e mostra a contagem regressiva. Clicar no aviso
// chama resetarInatividade(), que o hook registra para zerar o relógio.
//
// É um store de módulo (fora do React) — uma única instância do hook escreve,
// qualquer componente lê.

export interface AvisoLogout {
  avisando: boolean
  segundos: number
}

let estado: AvisoLogout = { avisando: false, segundos: 0 }
const listeners = new Set<() => void>()
let resetFn: (() => void) | null = null

export function subscribeAviso(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// getSnapshot precisa devolver referência ESTÁVEL enquanto nada muda (regra do
// useSyncExternalStore). Só reatribuímos `estado` quando algum campo muda.
export function getAvisoSnapshot(): AvisoLogout {
  return estado
}

export function setAviso(avisando: boolean, segundos: number): void {
  if (estado.avisando === avisando && estado.segundos === segundos) return
  estado = { avisando, segundos }
  for (const l of listeners) l()
}

// O hook registra como zerar o relógio de inatividade; a UI dispara no clique.
export function registrarResetInatividade(fn: () => void): void {
  resetFn = fn
}

export function resetarInatividade(): void {
  resetFn?.()
}
