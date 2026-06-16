// src/lib/operacaoLonga.ts
//
// Registro global de "operação longa em andamento" (backup, restore, import,
// sincronização). É consumido pelo useAutoLogout para SUSPENDER o timer de
// inatividade enquanto uma dessas operações roda — assim um backup/restore que
// passa dos 15 min não é abortado por logout no meio. Ao terminar, a contagem
// de inatividade recomeça do zero.
//
// É um contador simples (ref-count) fora do React: várias operações podem
// estar ativas ao mesmo tempo e o timer só volta a contar quando todas
// terminarem.

let ativas = 0

// Marca o início de uma operação longa. Retorna uma função idempotente que
// marca o fim (chame em finally / cleanup de efeito).
export function registrarOperacaoLonga(): () => void {
  ativas++
  let encerrado = false
  return () => {
    if (encerrado) return
    encerrado = true
    ativas = Math.max(0, ativas - 1)
  }
}

export function temOperacaoLongaAtiva(): boolean {
  return ativas > 0
}
