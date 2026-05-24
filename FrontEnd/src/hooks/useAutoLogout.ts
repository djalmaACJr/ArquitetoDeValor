// src/hooks/useAutoLogout.ts
//
// Auto-logout por inatividade. Padrão de app financeiro:
//   - Após N minutos sem interação do usuário, desloga e redireciona
//     para /login com o flag `?expirado=1` (LoginPage exibe banner).
//   - Eventos que resetam o timer: mousemove, mousedown, keydown,
//     touchstart, scroll, click.
//
// Uso: montar dentro do AppLayout (só rotas autenticadas).
//
//   useAutoLogout(15)  // 15 minutos
//
// Notas de implementação:
//   - Usa um único setTimeout + lastActivityRef. Eventos só atualizam
//     o timestamp (custo O(1)); o timer é re-armado apenas após um
//     intervalo de checagem (1 min), evitando milhares de
//     clearTimeout/setTimeout durante scroll/mousemove.
//   - Eventos no document, com `{ passive: true }` para não bloquear
//     scroll. `capture: false` (default) pois não precisamos interceptar.

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const EVENTOS_INTERACAO = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'click',
] as const

const INTERVALO_CHECK_MS = 60_000 // confere a cada 1 min

export function useAutoLogout(timeoutMinutos: number = 15): void {
  const navigate = useNavigate()
  const lastActivityRef = useRef<number>(Date.now())
  const expiradoRef = useRef<boolean>(false)

  useEffect(() => {
    if (timeoutMinutos <= 0) return // 0 desliga o auto-logout

    const limiteMs = timeoutMinutos * 60_000

    function marcarAtividade() {
      lastActivityRef.current = Date.now()
    }

    // Registra listeners de interação. `passive: true` para não bloquear
    // performance de scroll/mousemove em telas pesadas.
    for (const ev of EVENTOS_INTERACAO) {
      document.addEventListener(ev, marcarAtividade, { passive: true })
    }

    const intervalId = window.setInterval(async () => {
      if (expiradoRef.current) return
      const ocioso = Date.now() - lastActivityRef.current
      if (ocioso < limiteMs) return

      // Evita dispara múltiplas vezes em sequência
      expiradoRef.current = true
      try {
        await supabase.auth.signOut()
      } catch {
        /* mesmo se signOut falhar, redireciona pra forçar reauth */
      }
      navigate('/login?expirado=1', { replace: true })
    }, INTERVALO_CHECK_MS)

    return () => {
      for (const ev of EVENTOS_INTERACAO) {
        document.removeEventListener(ev, marcarAtividade)
      }
      window.clearInterval(intervalId)
    }
  }, [timeoutMinutos, navigate])
}
