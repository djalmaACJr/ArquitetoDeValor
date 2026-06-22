import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import NovidadesProventos from '../ui/NovidadesProventos'
import { prefetchLancamentosVizinhos } from '../../hooks/useLancamentos'
import { useMascotePreferido } from '../../hooks/useMascotePreferido'
import { useAutoLogout } from '../../hooks/useAutoLogout'
import { useAuth } from '../../hooks/useAuth'
import { mesAtual } from '../../lib/utils'

export default function AppLayout() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const mainRef = useRef<HTMLElement>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const location = useLocation()
  const pathname = location.pathname
  const { primeiroAcesso } = useMascotePreferido()
  // Posição de scroll do <main> por entrada de histórico (location.key).
  const scrollPos = useRef<Map<string, number>>(new Map())
  // Chave da entrada de histórico ATUAL — atualizada de forma síncrona no
  // layout effect, ANTES de qualquer scroll programático, para o listener
  // sempre gravar na entrada certa (evita corromper a posição da página anterior).
  const chaveAtual = useRef(location.key)

  // Auto-logout após 15min de inatividade — defesa em PC compartilhado.
  // Combinado com sessionStorage (fechar aba = sair) cobre os 2 cenários
  // de "sessão esquecida" mais comuns.
  useAutoLogout(15)

  // Fecha o menu mobile ao navegar (UX)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMobileNavOpen(false) }, [pathname])

  // Pré-aquece o cache dos meses vizinhos ao mês atual logo após o login,
  // antes mesmo do usuário navegar para a tela de Lançamentos.
  useEffect(() => {
    if (!uid) return
    const mes = mesAtual()
    prefetchLancamentosVizinhos(qc, uid, mes)
  }, [qc, uid])

  // ── Restauração de scroll do <main> ao voltar ───────────────────────
  // O <main> persiste entre rotas; ao abrir o detalhe e voltar, a página
  // filha remonta e a rolagem se perderia. Guardamos a posição de cada
  // entrada de histórico e a restauramos ao revisitá-la (voltar/avançar);
  // entrada inédita (navegação nova) começa no topo.
  //
  // Listener ÚNICO (montado uma vez) que grava sempre na chave ATUAL via ref
  // — assim um scroll programático (restauração) nunca grava na página errada.
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const onScroll = () => { scrollPos.current.set(chaveAtual.current, main.scrollTop) }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => main.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    chaveAtual.current = location.key          // síncrono, antes de mexer no scroll
    const main = mainRef.current
    if (!main) return
    // Posição conhecida da entrada (revisita) → restaura; inédita → topo (0).
    const alvo = scrollPos.current.get(location.key) ?? 0
    // O conteúdo pode pintar depois (Suspense/react-query): tenta por alguns
    // frames até a altura comportar a posição salva.
    let raf = 0
    let tentativas = 0
    const restaurar = () => {
      const m = mainRef.current
      if (!m) return
      if (m.scrollHeight - m.clientHeight >= alvo || tentativas++ > 60) m.scrollTop = alvo
      else raf = requestAnimationFrame(restaurar)
    }
    raf = requestAnimationFrame(restaurar)
    return () => cancelAnimationFrame(raf)
  }, [location.key])

  // ── Delegação de scroll para ↑ / ↓ / PageUp / PageDown / Home / End ───
  //
  // O scroll real está em <main> (porque a sidebar é fixa via h-screen no
  // container). O <body> não rola, então as teclas verticais "não fazem
  // nada" quando o foco está fora de algum scrollable.
  //
  // Esta delegação intercepta as teclas no nível do document e rola o
  // <main> programaticamente — mas só se a tecla NÃO foi tratada por
  // algum elemento focado já scrollable (input, textarea, dropdown
  // aberto, etc.).
  useEffect(() => {
    function eDescendenteScrollavel(el: Element | null, ate: Element | null): boolean {
      let n: Element | null = el
      while (n && n !== ate) {
        const overflowY = getComputedStyle(n).overflowY
        if ((overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) {
          return true
        }
        n = n.parentElement
      }
      return false
    }
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const main = mainRef.current
      if (!main) return
      // Se o foco está dentro de algum container scrollável (que não é o
      // próprio <main>), o browser já cuida — não interfere.
      if (eDescendenteScrollavel(e.target as Element, main)) return

      const passoLinha = 60
      switch (e.key) {
        case 'ArrowUp':   main.scrollBy({ top: -passoLinha,         behavior: 'smooth' }); e.preventDefault(); break
        case 'ArrowDown': main.scrollBy({ top:  passoLinha,         behavior: 'smooth' }); e.preventDefault(); break
        case 'PageUp':    main.scrollBy({ top: -main.clientHeight * 0.9, behavior: 'smooth' }); e.preventDefault(); break
        case 'PageDown':  main.scrollBy({ top:  main.clientHeight * 0.9, behavior: 'smooth' }); e.preventDefault(); break
        case 'Home':      if (!e.ctrlKey) return; main.scrollTo({ top: 0, behavior: 'smooth' }); e.preventDefault(); break
        case 'End':       if (!e.ctrlKey) return; main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' }); e.preventDefault(); break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Atalho global de tutorial: F1 abre o tour da página atual.
  // Funciona em qualquer lugar do app (mesmo dentro de inputs).
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('av-abrir-tutorial'))
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  // Primeiro acesso: redireciona pra tela de apresentação dos mascotes.
  // `primeiroAcesso === undefined` significa "ainda carregando do banco" —
  // espera (não redireciona, evita flicker).
  if (primeiroAcesso === true) {
    return <Navigate to="/apresentacao" replace/>
  }

  return (
    <div className="flex flex-col md:flex-row h-screen" style={{ background: 'var(--bg-page)' }}>
      {/* Topbar — só no mobile */}
      <header className="md:hidden flex items-center gap-3 px-3 h-12 bg-av-dark border-b border-blue-400/15 flex-shrink-0 z-30">
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Abrir menu"
          className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Menu size={20}/>
        </button>
        <p className="text-[15px] font-semibold text-white">Arquiteto de Valor</p>
      </header>

      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />

      <main ref={mainRef} className="flex-1 overflow-auto min-w-0">
        <Outlet />
      </main>

      {/* Aviso de login: proventos provisionados pelo job BRL */}
      <NovidadesProventos />
    </div>
  )
}
