// src/hooks/useAutoLogout.ts
//
// Auto-logout por inatividade. Padrão de app financeiro:
//   - Após N minutos sem interação do usuário, desloga e redireciona
//     para /login com o flag `?expirado=1` (LoginPage exibe banner).
//   - Eventos que resetam o timer: mousedown, keydown, wheel,
//     touchstart, scroll, click. `mousemove` foi removido de propósito
//     (ver EVENTOS_INTERACAO) — em multi-monitor o cursor só passando
//     por cima da janela resetava o timer e o logout nunca disparava.
//
// Uso: montar dentro do AppLayout (só rotas autenticadas).
//
//   useAutoLogout(15)  // 15 minutos
//
// Notas de implementação:
//   - Usa um único setInterval (1s) + lastActivityRef. Eventos só atualizam
//     o timestamp (custo O(1)); o tick apenas compara Date.now(), evitando
//     milhares de clearTimeout/setTimeout durante scroll. No último minuto o
//     tick publica a contagem regressiva no store `autoLogoutAviso` (Sidebar).
//   - Eventos no document, com `{ passive: true }` para não bloquear
//     scroll. `capture: false` (default) pois não precisamos interceptar.

import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { usePageState } from '../context/PageStateContext'
import { salvarRetornoPosExpiracao } from '../lib/retornoPosExpiracao'
import { temOperacaoLongaAtiva } from '../lib/operacaoLonga'
import { setAviso, registrarResetInatividade } from '../lib/autoLogoutAviso'

// IMPORTANTE: `mousemove` foi DELIBERADAMENTE removido. Em setups
// multi-monitor, o cursor apenas CRUZANDO a janela visível (no outro
// monitor) faz o SO ativar a janela — `document.hasFocus()` vira true e o
// mousemove resetava o timer de inatividade, então o logout ocioso nunca
// disparava enquanto o usuário trabalhava em outro app. Mover o cursor por
// cima NÃO é "usar o app". Só contam interações deliberadas:
const EVENTOS_INTERACAO = [
  'mousedown',
  'keydown',
  'wheel',
  'touchstart',
  'scroll',
  'click',
] as const

// Tick de 1s: barato (uma subtração) e necessário para a contagem regressiva
// fluida no último minuto. O custo real (signOut) só roda uma vez na expiração.
const INTERVALO_CHECK_MS = 1_000
// Janela final em que a Sidebar exibe a contagem regressiva chamando atenção.
const AVISO_MS = 60_000

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

    function marcarAtividade(e: Event) {
      // Defesa adicional: só conta atividade com a janela em foco. O reset
      // real foi resolvido removendo `mousemove` de EVENTOS_INTERACAO (cursor
      // cruzando a janela em multi-monitor ATIVA a janela, então hasFocus()
      // vira true e o guard sozinho não bastava). Aqui fica como reforço para
      // eventos que cheguem com a janela em segundo plano.
      if (!document.hasFocus()) return
      // Alt+Tab / Cmd+Tab / Super (troca de janela): o usuário está SAINDO para
      // outro app, não usando este. O keydown dispara enquanto a janela ainda
      // tem foco — sem este guard, "trocar de app" resetava o relógio e a
      // contagem regressiva sumia/zerava em vez de seguir até o logout.
      if (e.type === 'keydown') {
        const ke = e as KeyboardEvent
        if (ke.key === 'Tab' || ke.key === 'Alt' || ke.key === 'Meta' || ke.altKey || ke.metaKey) return
      }
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
      // Operação longa em andamento (backup/restore/import/sincronização):
      // suspende o logout e empurra o relógio de atividade, para a contagem
      // de inatividade recomeçar só quando a operação terminar.
      if (temOperacaoLongaAtiva()) { lastActivityRef.current = Date.now(); return }
      if (!forcar && Date.now() - lastActivityRef.current < limiteMs) return

      expiradoRef.current = true
      setAviso(false, 0) // some com a contagem ao deslogar
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

    // Tick de 1s: atualiza a contagem regressiva (último minuto) e dispara a
    // expiração quando o tempo zera. Durante operação longa, empurra o relógio
    // (mesma regra do checarExpiracao) e esconde a contagem.
    function tick() {
      if (expiradoRef.current) return
      if (temOperacaoLongaAtiva()) {
        lastActivityRef.current = Date.now()
        setAviso(false, 0)
        return
      }
      const restanteMs = limiteMs - (Date.now() - lastActivityRef.current)
      if (restanteMs <= 0) {
        setAviso(false, 0)
        checarExpiracao()
        return
      }
      // Só publica/limpa o aviso no último minuto (o store ignora no-ops).
      if (restanteMs <= AVISO_MS) setAviso(true, Math.ceil(restanteMs / 1000))
      else setAviso(false, 0)
    }
    const intervalId = window.setInterval(tick, INTERVALO_CHECK_MS)

    // Clique na contagem (Sidebar) zera o relógio e esconde o aviso.
    function resetarInatividade() {
      lastActivityRef.current = Date.now()
      setAviso(false, 0)
    }
    registrarResetInatividade(resetarInatividade)

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
      registrarResetInatividade(() => {}) // evita reset apontando p/ hook desmontado
      setAviso(false, 0)
    }
  }, [timeoutMinutos])
}
