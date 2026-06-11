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
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { usePageState } from '../context/PageStateContext'
import { salvarRetornoPosExpiracao } from '../lib/retornoPosExpiracao'

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
  const location = useLocation()
  const { session } = useAuth()
  const { lancamentos, dashboard, relatorios } = usePageState()

  // Date.now() é impura — não pode rodar durante o render. Inicializa
  // como 0 e o useEffect abaixo seta o timestamp real ao montar.
  const lastActivityRef = useRef<number>(0)
  const expiradoRef = useRef<boolean>(false)

  // Snapshot "sempre atual" de rota/filtros/usuário em ref — o timer lê
  // daqui na hora da expiração sem precisar reiniciar o efeito a cada
  // navegação ou mudança de filtro.
  const snapshotRef = useRef<{ userId: string | null; rota: string; filtros: unknown }>({
    userId: null, rota: '/', filtros: null,
  })
  // `navigate` do react-router pode trocar de identidade entre renders. Se
  // o efeito do timer dependesse dele, re-armaria o setInterval e ZERARIA o
  // lastActivityRef a cada re-render — e como este hook agora assina
  // usePageState/useLocation/useAuth, os re-renders ficaram frequentes, o
  // ocioso nunca chegava ao limite e o logout deixava de acontecer. Por
  // isso o timer roda UMA vez (deps [timeoutMinutos]) e lê navigate da ref.
  const navigateRef = useRef(navigate)
  // Sem array de deps: roda após todo commit, mantendo snapshot/navigate
  // frescos (regra react-hooks/refs proíbe escrever em ref durante o render).
  useEffect(() => {
    navigateRef.current = navigate
    snapshotRef.current = {
      userId: session?.user?.id ?? null,
      rota:   location.pathname + location.search,
      filtros: {
        lancamentos,
        dashboard,
        // Relatórios: guarda só os filtros — a lista de lançamentos buscada
        // pode ser grande (quota do sessionStorage) e é refeita sob demanda.
        relatorios: { ...relatorios, lancamentos: [], buscado: false },
      },
    }
  })

  useEffect(() => {
    if (timeoutMinutos <= 0) return // 0 desliga o auto-logout

    const limiteMs = timeoutMinutos * 60_000
    lastActivityRef.current = Date.now()

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

      // Guarda rota + filtros para retomar após o próximo login do
      // mesmo usuário nesta aba (LoginPage e PageStateProvider consomem).
      const snap = snapshotRef.current
      if (snap.userId) {
        salvarRetornoPosExpiracao(snap.userId, snap.rota, snap.filtros)
      }

      try {
        await supabase.auth.signOut()
      } catch {
        /* mesmo se signOut falhar, redireciona pra forçar reauth */
      }
      navigateRef.current('/login?expirado=1', { replace: true })
    }, INTERVALO_CHECK_MS)

    return () => {
      for (const ev of EVENTOS_INTERACAO) {
        document.removeEventListener(ev, marcarAtividade)
      }
      window.clearInterval(intervalId)
    }
  }, [timeoutMinutos])
}
