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
  // Momento em que a aba ficou em segundo plano (0 = visível). Usado para
  // deslogar imediatamente ao voltar a uma aba que ficou oculta tempo demais
  // (defesa contra timers estrangulados/congelados em abas inativas).
  const hiddenAtRef = useRef<number>(0)

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

    // Executa a expiração (signOut + redireciona). `forcar` ignora o cálculo
    // de ociosidade (usado quando a aba já passou do limite escondida).
    async function checarExpiracao(forcar = false) {
      if (expiradoRef.current) return
      if (!forcar && Date.now() - lastActivityRef.current < limiteMs) return

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
    }

    const intervalId = window.setInterval(() => { checarExpiracao() }, INTERVALO_CHECK_MS)

    // Ciclo de visibilidade: ao voltar a uma aba que ficou oculta além do
    // limite, desloga IMEDIATAMENTE — antes que um mousemove resete o timer.
    // Cobre o caso de timers estrangulados/congelados em segundo plano.
    function onVisibilidade() {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
      } else {
        const escondidaMs = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0
        hiddenAtRef.current = 0
        checarExpiracao(escondidaMs >= limiteMs)
      }
    }
    function onFoco() { checarExpiracao() }
    document.addEventListener('visibilitychange', onVisibilidade)
    window.addEventListener('focus', onFoco)

    return () => {
      for (const ev of EVENTOS_INTERACAO) {
        document.removeEventListener(ev, marcarAtividade)
      }
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilidade)
      window.removeEventListener('focus', onFoco)
    }
  }, [timeoutMinutos])
}
