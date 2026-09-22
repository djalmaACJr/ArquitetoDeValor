// src/lib/avisoFecharAba.ts
//
// Ponte entre useAutoLogout e o modal AvisoFecharAba (mesmo padrão de
// autoLogoutAviso.ts). Quando o timer de inatividade DESTA aba expira, um
// signOut() direto derrubaria TODAS as abas — a sessão desktop fica em
// localStorage compartilhado entre abas (ver "Sessão + biometria" no
// CLAUDE.md). Em vez de deslogar na hora, avisa e oferece fechar só esta
// aba; se o usuário preferir continuar aqui, ou não responder a tempo, ou o
// navegador não deixar fechar (aba não aberta via window.open — caso
// comum), cai no signOut() global de qualquer forma (defesa contra
// computador compartilhado sem ninguém pra decidir).

export interface AvisoFecharAba {
  mostrando: boolean
  segundos: number
  // true após o clique em "Fechar esta aba": se o navegador não fechar em
  // poucos segundos (aba não aberta via script), cai no signOut normal.
  fechando: boolean
}

let estado: AvisoFecharAba = { mostrando: false, segundos: 0, fechando: false }
const listeners = new Set<() => void>()

export function subscribeAvisoFecharAba(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// getSnapshot precisa devolver referência ESTÁVEL enquanto nada muda (regra do
// useSyncExternalStore).
export function getAvisoFecharAbaSnapshot(): AvisoFecharAba {
  return estado
}

export function setAvisoFecharAba(next: AvisoFecharAba): void {
  const e = estado
  if (e.mostrando === next.mostrando && e.segundos === next.segundos && e.fechando === next.fechando) return
  estado = next
  for (const l of listeners) l()
}

let acoes: { fechar: () => void; continuar: () => void } | null = null

// useAutoLogout registra como agir; o modal só dispara os cliques.
export function registrarAcoesFecharAba(a: { fechar: () => void; continuar: () => void } | null): void {
  acoes = a
}

export function fecharAbaAtual(): void { acoes?.fechar() }
export function continuarNestaAba(): void { acoes?.continuar() }
