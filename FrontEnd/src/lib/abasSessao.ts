// src/lib/abasSessao.ts
//
// Coordenação entre abas do MESMO navegador (a sessão desktop vive em
// localStorage compartilhado — ver "Sessão + biometria" no CLAUDE.md).
// Duas necessidades do useAutoLogout:
//   1. Saber se OUTRA aba está em uso agora, pra nunca deslogar globalmente
//      (signOut derruba todas) por causa de uma aba ociosa enquanto o
//      usuário trabalha em outra.
//   2. Avisar as demais abas quando a aba "principal" (a 1ª aberta) fecha.
//      Só avisa: nenhuma aba é fechada nem deslogada por isso.

const KEY_ATIVA = 'arqvalor:aba-ativa'
const KEY_PRINCIPAL = 'arqvalor:aba-principal'
const CANAL = 'arqvalor:abas'
const HEARTBEAT_MS = 1_000
const PRINCIPAL_VIVA_MS = 3_000
// Aguarda uma nova aba assumir como principal antes de avisar — um reload
// (F5) da principal dispara pagehide igual a um fechamento de verdade.
const ESPERA_RELOAD_MS = 3_500

export const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36)

interface Marca { id: string; ts: number }

function ler(key: string): Marca | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Marca | null
    return v && typeof v.id === 'string' && typeof v.ts === 'number' ? v : null
  } catch { return null }
}
function gravar(key: string, m: Marca): void {
  try { localStorage.setItem(key, JSON.stringify(m)) } catch { /* storage indisponível */ }
}

// ── Interação real do usuário (chamado pelo useAutoLogout) ──────
let ultimaGravacao = 0
export function registrarInteracaoAba(): void {
  const agora = Date.now()
  if (agora - ultimaGravacao < 1_000) return // throttle: scroll/wheel disparam muito
  ultimaGravacao = agora
  gravar(KEY_ATIVA, { id: TAB_ID, ts: agora })
}

/** Outra aba (não esta) teve interação do usuário dentro de `janelaMs`. */
export function outraAbaAtiva(janelaMs: number): boolean {
  const m = ler(KEY_ATIVA)
  return !!m && m.id !== TAB_ID && Date.now() - m.ts < janelaMs
}

// ── Aba principal ───────────────────────────────────────────────
function principalViva(): Marca | null {
  const m = ler(KEY_PRINCIPAL)
  return m && Date.now() - m.ts < PRINCIPAL_VIVA_MS ? m : null
}

/**
 * Registra esta aba: vira a principal se não houver uma viva. Chama
 * `aoPrincipalFechar` nas OUTRAS abas quando a principal fecha de verdade.
 * Devolve a função de limpeza.
 */
export function iniciarCoordenacaoAbas(aoPrincipalFechar: () => void): () => void {
  let souPrincipal = false
  if (!principalViva()) {
    gravar(KEY_PRINCIPAL, { id: TAB_ID, ts: Date.now() })
    souPrincipal = true
  }

  const hb = window.setInterval(() => {
    if (souPrincipal) gravar(KEY_PRINCIPAL, { id: TAB_ID, ts: Date.now() })
  }, HEARTBEAT_MS)

  let canal: BroadcastChannel | null = null
  let espera: number | null = null
  try {
    canal = new BroadcastChannel(CANAL)
    canal.onmessage = (e) => {
      if (e.data?.tipo !== 'principal-fechou' || e.data?.id === TAB_ID) return
      if (espera !== null) window.clearTimeout(espera)
      espera = window.setTimeout(() => {
        espera = null
        // Alguma aba assumiu (reload da principal)? Então não houve fechamento.
        if (!principalViva()) aoPrincipalFechar()
      }, ESPERA_RELOAD_MS)
    }
  } catch { /* BroadcastChannel indisponível — sem aviso, o resto segue */ }

  function aoSair() {
    if (!souPrincipal) return
    try { localStorage.removeItem(KEY_PRINCIPAL) } catch { /* ignore */ }
    try { canal?.postMessage({ tipo: 'principal-fechou', id: TAB_ID }) } catch { /* ignore */ }
  }
  window.addEventListener('pagehide', aoSair)

  return () => {
    window.clearInterval(hb)
    if (espera !== null) window.clearTimeout(espera)
    window.removeEventListener('pagehide', aoSair)
    canal?.close()
    // Desmontagem do hook (logout/navegação interna) não é "fechar a aba".
    if (souPrincipal) { try { localStorage.removeItem(KEY_PRINCIPAL) } catch { /* ignore */ } }
  }
}
