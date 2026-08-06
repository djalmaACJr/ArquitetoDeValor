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
//   - A última atividade também é persistida em localStorage (não só em
//     memória) — necessário no app Android/Capacitor, onde o SO pode matar
//     o processo inteiro ao minimizar, sem rodar nenhum código de cleanup
//     (ver LS_ULTIMA_ATIVIDADE abaixo).
//   - No app nativo (Android/iOS), usa @capacitor/app (pause/resume) para
//     detectar segundo-plano — MAIS CONFIÁVEL que visibilitychange/focus
//     dentro de uma WebView Capacitor: o caso comum (Activity pausada mas
//     NÃO morta pelo SO — usuário só minimizou e voltou) não passa pelo
//     "processo reiniciado" que a persistência acima cobre, e a WebView nem
//     sempre repassa visibilitychange/blur corretamente a partir do ciclo de
//     vida nativo real da Activity. pause/resume do Capacitor mapeiam direto
//     pra onPause()/onResume() nativos, sem essa reinterpretação.

import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
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

// Persistência da última atividade — ESSENCIAL no app Android (Capacitor).
// No browser desktop, a aba costuma ficar viva em memória mesmo oculta, então
// o useRef + visibilitychange (abaixo) já bastava. No Android, o SO pode
// pausar/matar o processo do app inteiro ao ser minimizado (Home, troca de
// app, tela bloqueada) — sem aviso ao JS (não roda beforeunload/pagehide em
// kill de processo). Ao reabrir, o React remonta do zero e o useRef voltava
// para Date.now(), zerando a contagem — o app parecia nunca deslogar por
// inatividade por mais tempo que o usuário ficasse fora. localStorage
// sobrevive ao processo ser morto; ao montar, comparamos com o relógio real
// e deslogamos na hora se o limite já passou enquanto o app estava fechado.
const LS_ULTIMA_ATIVIDADE = 'arqvalor:ultima-atividade'

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

    // Retoma a última atividade persistida (sobrevive ao app Android ser
    // pausado/morto pelo SO — ver comentário de LS_ULTIMA_ATIVIDADE acima).
    // Sem valor salvo (1º carregamento após login) começa do zero normalmente.
    const persistida = Number(localStorage.getItem(LS_ULTIMA_ATIVIDADE) ?? 0)
    lastActivityRef.current = persistida > 0 ? persistida : Date.now()

    function persistirAtividade() {
      try { localStorage.setItem(LS_ULTIMA_ATIVIDADE, String(lastActivityRef.current)) }
      catch { /* quota cheia ou storage indisponível — auto-logout ainda funciona em memória */ }
    }
    persistirAtividade()

    function marcarAtividade(e: Event) {
      // Defesa adicional: só conta atividade com a janela em foco (Desktop).
      // No Android/iOS Capacitor, document.hasFocus() nem sempre é confiável
      // e o app é a única coisa na tela, então ignoramos essa trava no nativo.
      if (!Capacitor.isNativePlatform() && !document.hasFocus()) return
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
      if (temOperacaoLongaAtiva()) { lastActivityRef.current = Date.now(); persistirAtividade(); return }
      if (!forcar && Date.now() - lastActivityRef.current < limiteMs) return

      expiradoRef.current = true
      setAviso(false, 0) // some com a contagem ao deslogar
      localStorage.removeItem(LS_ULTIMA_ATIVIDADE) // não herdar pro próximo login
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

    // Se o valor persistido (de antes do app ser pausado/morto pelo SO) já
    // ultrapassou o limite, desloga IMEDIATAMENTE ao montar — sem isso, o
    // app Android reaberto depois do tempo de inatividade continuava logado
    // até o próximo tick "perceber" (e um tick só roda com o app já aberto).
    if (persistida > 0 && Date.now() - persistida >= limiteMs) {
      checarExpiracao(true)
    }

    // Tick de 1s: atualiza a contagem regressiva (último minuto) e dispara a
    // expiração quando o tempo zera. Durante operação longa, empurra o relógio
    // (mesma regra do checarExpiracao) e esconde a contagem.
    function tick() {
      if (expiradoRef.current) return
      if (temOperacaoLongaAtiva()) {
        lastActivityRef.current = Date.now()
        persistirAtividade()
        setAviso(false, 0)
        return
      }
      const restanteMs = limiteMs - (Date.now() - lastActivityRef.current)
      if (restanteMs <= 0) {
        setAviso(false, 0)
        checarExpiracao()
        return
      }
      // Persiste a cada tick (1s) — barato, e garante que o valor salvo
      // fique atualizado a qualquer momento em que o SO decida pausar/matar
      // o app (ver LS_ULTIMA_ATIVIDADE).
      persistirAtividade()
      // Só publica/limpa o aviso no último minuto (o store ignora no-ops).
      if (restanteMs <= AVISO_MS) setAviso(true, Math.ceil(restanteMs / 1000))
      else setAviso(false, 0)
    }
    const intervalId = window.setInterval(tick, INTERVALO_CHECK_MS)

    // Clique na contagem (Sidebar) zera o relógio e esconde o aviso.
    function resetarInatividade() {
      lastActivityRef.current = Date.now()
      persistirAtividade()
      setAviso(false, 0)
    }
    registrarResetInatividade(resetarInatividade)

    // Ciclo de visibilidade: ao voltar a uma aba que ficou oculta além do
    // limite, desloga IMEDIATAMENTE — antes que um mousemove resete o timer.
    // Cobre o caso de timers estrangulados/congelados em segundo plano.
    function onVisibilidade() {
      // No Capacitor, priorizamos os listeners de pause/resume nativos
      // (addListener) que são disparados exatamente no ciclo nativo,
      // enquanto o visibilitychange do navegador pode ser inconsistente.
      if (Capacitor.isNativePlatform()) return

      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
        // Momento mais importante para persistir: no Android é exatamente
        // aqui (app indo pra segundo plano) que o processo pode ser
        // pausado/morto pelo SO a qualquer momento, sem chance de rodar
        // mais nenhum código JS depois disso.
        persistirAtividade()
      } else {
        const escondidaMs = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0
        hiddenAtRef.current = 0
        checarExpiracao(escondidaMs >= limiteMs)
      }
    }
    function onFoco() { checarExpiracao() }
    document.addEventListener('visibilitychange', onVisibilidade)
    window.addEventListener('focus', onFoco)

    // Sinal nativo (Android/iOS) — ver nota no topo do arquivo. `then` em vez
    // de `await` porque addListener é assíncrono e o efeito precisa ficar
    // síncrono para poder devolver a função de cleanup abaixo. `cancelado`
    // cobre o caso raro do cleanup rodar ANTES da Promise resolver — sem
    // isso, o listener chegaria a existir depois do unmount (vazamento).
    let handlePause: { remove: () => void } | null = null
    let handleResume: { remove: () => void } | null = null
    let cancelado = false
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('pause', () => {
        // Registra o momento da saída para permitir uma tolerância (1min)
        // ao trocar de app rapidamente.
        hiddenAtRef.current = Date.now()
        persistirAtividade()
      }).then(h => { if (cancelado) h.remove(); else handlePause = h })

      CapacitorApp.addListener('resume', () => {
        const agora = Date.now()
        const escondidaMs = hiddenAtRef.current ? agora - hiddenAtRef.current : 0
        hiddenAtRef.current = 0

        // Janela de tolerância para troca rápida de app (ex: ver SMS/Token).
        const limiteTrocaAppMs = 60_000

        // Desloga se:
        // 1. Ficou em segundo plano por mais de 1 minuto;
        // 2. OU a inatividade TOTAL (antes + durante pausa) passou do limite (5min).
        if (escondidaMs >= limiteTrocaAppMs || (agora - lastActivityRef.current >= limiteMs)) {
          checarExpiracao(true)
        } else {
          // Voltou rápido: apenas garante que o timer de 1s continue
          // a partir do ponto correto.
          persistirAtividade()
        }
      }).then(h => { if (cancelado) h.remove(); else handleResume = h })
    }

    return () => {
      cancelado = true
      handlePause?.remove()
      handleResume?.remove()
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
