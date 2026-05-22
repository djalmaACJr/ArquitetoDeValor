// src/components/ui/TutorialTour.tsx
//
// Engine de tutorial guiado. Dispara automaticamente na 1ª visita da
// página (rastreado em localStorage por `key`) e também via botão "?".
//
// Como funciona:
//   1. Cada `passo` referencia um seletor CSS de um elemento da tela
//   2. O elemento é destacado com brilho + retângulo (recorte do backdrop)
//   3. Mascote aparece num canto apontando pro elemento, com balão
//   4. Botões: Pular / Voltar / Próximo (ou Concluir no último)
//
// Uso:
//   <TutorialTour
//     pageKey="dashboard-v1"
//     passos={[
//       { seletor: '[data-tutorial="cabecalho"]', titulo: '...', texto: '...' },
//       ...
//     ]}
//   />
//
// O componente recebe a sequência de passos e gerencia visibilidade e
// progresso. Não é controlado de fora — auto-trigger + persistência.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Mascote, { type MascoteNome } from './Mascote'
import { useMascotePreferido } from '../../hooks/useMascotePreferido'

export interface PassoTutorial {
  /** Seletor CSS do elemento a destacar (ex.: `[data-tutorial="filtros"]`). */
  seletor:   string
  /** Título curto que aparece em destaque no balão. */
  titulo:    string
  /** Texto explicativo (pode usar quebras de linha; markdown não). */
  texto:     string
  /** Se true, não tenta encontrar o elemento — exibe o passo "flutuante" no centro. */
  flutuante?: boolean
  /**
   * Força a posição do painel em relação ao elemento.
   *   'auto'    (default) — tenta abaixo, depois lateral, depois acima
   *   'abaixo'  — painel sob o elemento; mascote aponta pra cima
   *   'direita' — painel à direita; mascote aponta esquerda (lateral)
   *   'esquerda'— painel à esquerda; mascote aponta direita (lateral)
   *   'acima'   — painel sobre o elemento; mascote aponta pra baixo
   *               (renderizado com flip vertical sobre a sprite "acima")
   */
  posicao?: 'auto' | 'abaixo' | 'direita' | 'esquerda' | 'acima'
  /** Grupo lógico do passo — usado pela página-pai via `onStep` para coordenar ações (ex.: abrir drawer). */
  grupo?: string
}

interface Props {
  /** Chave única da página, ex.: 'dashboard-v1'. Usada pra persistir "já viu". */
  pageKey: string
  /** Lista ordenada de passos. */
  passos:  PassoTutorial[]
  /** Callback disparado ao entrar em cada passo. A página-pai pode reagir (ex.: abrir um drawer). */
  onStep?: (idx: number, passo: PassoTutorial) => void
}

const STORAGE_PREFIX = 'av-tut-tour-'

interface BoxRect { x: number; y: number; w: number; h: number }

export default function TutorialTour({ pageKey, passos, onStep }: Props) {
  const { mascote } = useMascotePreferido()
  const [aberto,  setAberto]  = useState(false)
  const [idx,     setIdx]     = useState(0)
  const [rect,    setRect]    = useState<BoxRect | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const storageKey = `${STORAGE_PREFIX}${pageKey}`

  // Auto-trigger na 1ª visita (somente se houver passos)
  useEffect(() => {
    if (!passos.length) return
    if (localStorage.getItem(storageKey) === '1') return
    // Pequeno delay pra esperar a página renderizar
    const t = setTimeout(() => { setAberto(true); setIdx(0) }, 600)
    return () => clearTimeout(t)
  }, [storageKey, passos.length])

  // Trigger global — qualquer lugar do app pode disparar `av-abrir-tutorial`
  // e o tour da página atual abre. F1 também aciona (handler em AppLayout).
  useEffect(() => {
    if (!passos.length) return
    const fn = () => { setIdx(0); setAberto(true) }
    window.addEventListener('av-abrir-tutorial', fn)
    return () => window.removeEventListener('av-abrir-tutorial', fn)
  }, [passos.length])

  // Pré-carrega as 4 direções do mascote ativo + pose de boas-vindas.
  // Sem isso, ao trocar de passo o browser baixava o PNG na hora, causando
  // flicker/delay de algumas centenas de ms. Imagens ficam em memória do
  // browser durante o tour.
  useEffect(() => {
    if (!aberto) return
    const arquivos = [
      `/mascotes/${mascote}-apontando-esquerda.png`,
      `/mascotes/${mascote}-apontando-direita.png`,
      `/mascotes/${mascote}-apontando-esquerda-acima.png`,
      `/mascotes/${mascote}-apontando-direita-acima.png`,
      `/mascotes/${mascote}-comprimento-inicio.png`,
    ]
    const imgs: HTMLImageElement[] = arquivos.map(src => {
      const img = new Image()
      img.src = src
      return img
    })
    return () => { imgs.length = 0 }
  }, [aberto, mascote])

  const passo = passos[idx]

  // Atualiza retângulo do elemento destacado (e re-mede em resize/scroll)
  const atualizarRect = useCallback(() => {
    if (!passo || passo.flutuante) { setRect(null); return }
    const el = document.querySelector<HTMLElement>(passo.seletor)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    setRect({ x: r.left, y: r.top, w: r.width, h: r.height })
  }, [passo])

  useLayoutEffect(() => {
    if (!aberto) return
    atualizarRect()
    const fn = () => atualizarRect()
    window.addEventListener('resize', fn)
    window.addEventListener('scroll', fn, true)  // capture, pega scroll de containers
    return () => {
      window.removeEventListener('resize', fn)
      window.removeEventListener('scroll', fn, true)
    }
  }, [aberto, atualizarRect])

  // Scroll automático até o elemento destacado.
  // Estratégia por posicao forçada:
  //   'acima'  → 'end'     (elemento no rodapé do viewport, maximiza espaço acima para o painel)
  //   elementos altos (>40% vh) → 'nearest' (scroll mínimo, evita jogar o topo para cima da tela)
  //   demais   → 'center'  (elemento centralizado, espaço razoável em todas as direções)
  useEffect(() => {
    if (!aberto || !passo || passo.flutuante) return
    const el = document.querySelector<HTMLElement>(passo.seletor)
    if (!el) return
    const r = el.getBoundingClientRect()
    const block: ScrollLogicalPosition =
      passo.posicao === 'acima'          ? 'end'     :
      r.height > window.innerHeight * 0.4 ? 'nearest' : 'center'
    el.scrollIntoView({ behavior: 'smooth', block })
  }, [aberto, idx, passo])

  // Notifica a página-pai de cada passo + retry de rect apenas para passos
  // cujos elementos aparecem no DOM após uma ação assíncrona (ex.: grupo 'drawer').
  // Passos normais já são cobertos pelo useLayoutEffect acima — não interferir neles.
  useEffect(() => {
    if (!aberto) return
    const p = passos[idx]
    if (!p) return
    onStep?.(idx, p)
    // Retry só para passos que dependem de DOM atrasado (drawer aberto via onStep).
    // Grupos válidos: 'drawer' (extrato), 'drawer-conta', 'drawer-cat', e futuros.
    const gruposComDomAtrasado = ['drawer', 'drawer-conta', 'drawer-cat']
    if (!gruposComDomAtrasado.includes(p.grupo ?? '') || !p.seletor) return
    let cancelled = false
    let attempts = 0
    function retry() {
      if (cancelled) return
      const el = document.querySelector<HTMLElement>(p.seletor)
      if (el) {
        const r = el.getBoundingClientRect()
        setRect({ x: r.left, y: r.top, w: r.width, h: r.height })
      } else if (attempts++ < 8) {
        setTimeout(retry, 150)
      }
    }
    // Aguarda animação de entrada do drawer (~300ms) antes de medir
    const t = setTimeout(retry, 300)
    return () => { cancelled = true; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, idx])

  // ESC fecha
  useEffect(() => {
    if (!aberto) return
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { fechar() }
      if (e.key === 'ArrowRight') { proximo() }
      if (e.key === 'ArrowLeft')  { voltar() }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, idx])

  function fechar() {
    setAberto(false)
    localStorage.setItem(storageKey, '1')
  }
  function proximo() {
    if (idx + 1 < passos.length) setIdx(i => i + 1)
    else fechar()
  }
  function voltar() {
    if (idx > 0) setIdx(i => i - 1)
  }

  // ── Render ──────────────────────────────────────────────────────────

  // Fechado: nada renderizado. O atalho pra reabrir vem do botão de
  // versão na sidebar, do F1 ou do evento `av-abrir-tutorial`.
  if (!aberto) return null

  // Decide ONDE colocar o painel (perto do elemento) e QUAL pose o mascote
  // assume. Pode ser forçado via `passo.posicao` ou auto-detectado.
  // Auto-prioridade:
  //   1. Abaixo do elemento     → pose aponta-acima
  //   2. À direita do elemento  → pose aponta-esquerda (lateral)
  //   3. À esquerda do elemento → pose aponta-direita  (lateral)
  //   4. Acima do elemento      → pose aponta-X-acima + flip vertical (aponta pra baixo)
  type PoseTutorial = 'apontando-esquerda' | 'apontando-direita'
                    | 'apontando-esquerda-acima' | 'apontando-direita-acima'
                    | 'comprimento-inicio'
  interface Posicao {
    estilo:           React.CSSProperties
    pose:             PoseTutorial
    mascoteAEsquerda: boolean
    /** true = aplica scaleY(-1) no mascote (usado em posicao='acima' pra ele apontar pra baixo). */
    flipVertical?:    boolean
  }

  const PAINEL_W   = 360
  const PAINEL_H   = 280
  const MASCOTE_W  = 140
  const GAP        = 14

  let posicao: Posicao
  const vw = typeof window !== 'undefined' ? window.innerWidth  : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768

  /** Calcula posicao 'abaixo' do elemento. */
  function posAbaixo(): Posicao {
    const centroEl = rect!.x + rect!.w / 2
    const mascoteEsq = centroEl > vw / 2
    const totalW    = PAINEL_W + MASCOTE_W + GAP
    let left = centroEl - totalW / 2
    left = Math.max(GAP, Math.min(vw - totalW - GAP, left))
    return {
      estilo:           { top: rect!.y + rect!.h + GAP, left },
      pose:             mascoteEsq ? 'apontando-direita-acima' : 'apontando-esquerda-acima',
      mascoteAEsquerda: mascoteEsq,
    }
  }
  /** Calcula posicao 'acima' do elemento.
   *  Usa `bottom` em vez de `top` para ancorar a borda inferior do painel
   *  a rect.y − GAP, garantindo que o painel cresce para cima sem cobrir o elemento. */
  function posAcima(): Posicao {
    const centroEl = rect!.x + rect!.w / 2
    const mascoteEsq = centroEl > vw / 2
    const totalW    = PAINEL_W + MASCOTE_W + GAP
    let left = centroEl - totalW / 2
    left = Math.max(GAP, Math.min(vw - totalW - GAP, left))
    return {
      estilo:           { bottom: vh - rect!.y + GAP, left },
      pose:             mascoteEsq ? 'apontando-direita' : 'apontando-esquerda',
      mascoteAEsquerda: mascoteEsq,
    }
  }
  /** Calcula posicao lateral direita.
   *  Mascote fica entre o elemento e o balão (lado esquerdo), apontando para o elemento. */
  function posDireita(): Posicao {
    const top = Math.max(GAP, Math.min(vh - PAINEL_H - GAP, rect!.y))
    return {
      estilo:           { top, left: rect!.x + rect!.w + GAP },
      pose:             'apontando-esquerda',
      mascoteAEsquerda: true,
    }
  }
  /** Calcula posicao lateral esquerda.
   *  Balão fica mais próximo do elemento (lado direito do grupo); mascote fica à esquerda.
   *  Isso garante que o balão não transborde para fora da tela em telas menores. */
  function posEsquerda(): Posicao {
    const top = Math.max(GAP, Math.min(vh - PAINEL_H - GAP, rect!.y))
    return {
      estilo:           { top, right: vw - rect!.x + GAP },
      pose:             'apontando-direita',
      mascoteAEsquerda: true,
    }
  }

  if (rect && !passo?.flutuante) {
    const totalW = PAINEL_W + MASCOTE_W + GAP
    const fitAbaixo = vh - (rect.y + rect.h) >= PAINEL_H + GAP
    const fitDir    = vw - (rect.x + rect.w) >= totalW + GAP
    const fitEsq    = rect.x                  >= totalW + GAP
    const fitAcima  = rect.y                  >= PAINEL_H + GAP

    // Elemento muito grande (ocupa >50% da altura ou >80% da largura):
    // painel flutuante centralizado — elemento ainda fica destacado no backdrop.
    const elementoGrande = rect.h > vh * 0.5 || rect.w > vw * 0.8
    const flutuanteCentral: Posicao = {
      estilo: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
      pose:   'comprimento-inicio',
      mascoteAEsquerda: true,
    }

    // Último recurso para elementos médios sem espaço em nenhuma direção.
    function posUltimoRecurso(): Posicao {
      const mascoteEsq = (rect!.x + rect!.w / 2) > vw / 2
      const left = Math.max(GAP, Math.min(vw - totalW - GAP, vw / 2 - totalW / 2))
      return {
        estilo:           { bottom: GAP * 2, left },
        pose:             mascoteEsq ? 'apontando-direita-acima' : 'apontando-esquerda-acima',
        mascoteAEsquerda: mascoteEsq,
      }
    }

    // Posições forçadas são respeitadas SOMENTE se o espaço for suficiente;
    // caso contrário caem no fluxo automático abaixo (evita overflow em telas pequenas).
    // elementoGrande é último recurso antes de posUltimoRecurso — só usado quando nenhuma
    // das 4 direções cabe (ex.: listas que ocupam toda a tela).
    const forcada = passo?.posicao && passo.posicao !== 'auto' ? passo.posicao : null
    if      (forcada === 'abaixo'   && fitAbaixo) posicao = posAbaixo()
    else if (forcada === 'acima'    && fitAcima)  posicao = posAcima()
    else if (forcada === 'direita'  && fitDir)    posicao = posDireita()
    else if (forcada === 'esquerda' && fitEsq)    posicao = posEsquerda()
    else if (fitAbaixo)                           posicao = posAbaixo()
    else if (fitDir)                              posicao = posDireita()
    else if (fitEsq)                              posicao = posEsquerda()
    else if (fitAcima)                            posicao = posAcima()
    else if (elementoGrande)                      posicao = flutuanteCentral
    else                                          posicao = posUltimoRecurso()
  } else {
    // Flutuante (1º e último passo): mascote no centro da tela em pose
    // de boas-vindas / despedida (sem apontar pra nada específico).
    posicao = {
      estilo: {
        top:    '50%',
        left:   '50%',
        transform: 'translate(-50%, -50%)',
      },
      pose:             'comprimento-inicio',
      mascoteAEsquerda: true,
    }
  }

  return (
    <div ref={containerRef} className="fixed inset-0 z-[200] pointer-events-none">
      {/* Backdrop com "recorte" (4 retângulos) cobrindo tudo menos o elemento */}
      {rect ? (
        <>
          {/* topo */}
          <div className="fixed inset-x-0 top-0 bg-black/70 pointer-events-auto" style={{ height: Math.max(rect.y, 0) }} onClick={fechar}/>
          {/* embaixo */}
          <div className="fixed inset-x-0 bottom-0 bg-black/70 pointer-events-auto"
               style={{ top: rect.y + rect.h }} onClick={fechar}/>
          {/* esquerda */}
          <div className="fixed left-0 bg-black/70 pointer-events-auto"
               style={{ top: rect.y, height: rect.h, width: Math.max(rect.x, 0) }} onClick={fechar}/>
          {/* direita */}
          <div className="fixed right-0 bg-black/70 pointer-events-auto"
               style={{ top: rect.y, left: rect.x + rect.w, height: rect.h }} onClick={fechar}/>
          {/* Halo brilhante ao redor do elemento */}
          <div
            className="fixed pointer-events-none"
            style={{
              top: rect.y - 6, left: rect.x - 6,
              width: rect.w + 12, height: rect.h + 12,
              borderRadius: 10,
              boxShadow: '0 0 0 3px rgba(77,166,255,0.85), 0 0 30px 10px rgba(77,166,255,0.35)',
              transition: 'all 200ms ease',
            }}
          />
        </>
      ) : (
        // Sem elemento (flutuante) — backdrop sólido
        <div className="fixed inset-0 bg-black/70 pointer-events-auto" onClick={fechar}/>
      )}

      {/* Painel do mascote + balão — posicionado dinamicamente ao lado do elemento */}
      <div
        className="fixed pointer-events-auto flex items-end gap-3"
        style={{
          ...posicao.estilo,
          maxWidth: PAINEL_W + MASCOTE_W + GAP,
        }}
      >
        {posicao.mascoteAEsquerda && (
          <div className="flex-shrink-0" style={posicao.flipVertical ? { transform: 'scaleY(-1)' } : undefined}>
            <Mascote nome={mascote as MascoteNome} pose={posicao.pose} size={MASCOTE_W} />
          </div>
        )}

        {/* Balão */}
        <div
          className="relative rounded-2xl border shadow-xl p-4 flex-1"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', minWidth: 240, maxWidth: PAINEL_W }}
        >
          {/* Cabeçalho: contador + fechar */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Passo {idx + 1} de {passos.length}
            </span>
            <button
              type="button"
              onClick={fechar}
              className="p-1 rounded transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
              title="Pular tutorial"
              aria-label="Pular tutorial"
            >
              <X size={14}/>
            </button>
          </div>

          <h3 className="text-[17px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            {passo?.titulo}
          </h3>
          <p className="text-[14px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-secondary)' }}>
            {passo?.texto}
          </p>

          {/* Barra de progresso */}
          <div className="mt-3 mb-3 flex gap-1">
            {passos.map((_, i) => (
              <span
                key={i}
                className="h-1 flex-1 rounded-full transition-colors"
                style={{ background: i <= idx ? '#4da6ff' : 'var(--border-subtle)' }}
              />
            ))}
          </div>

          {/* Botões */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={voltar}
              disabled={idx === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[14px] font-medium transition-colors disabled:opacity-30"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
            >
              <ChevronLeft size={13}/> Voltar
            </button>
            <button
              type="button"
              onClick={proximo}
              className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-[14px] font-semibold transition-colors"
              style={{ background: '#4da6ff', color: '#0a0f1a' }}
            >
              {idx + 1 < passos.length ? <>Próximo <ChevronRight size={13}/></> : 'Concluir'}
            </button>
          </div>
        </div>

        {!posicao.mascoteAEsquerda && (
          <div className="flex-shrink-0" style={posicao.flipVertical ? { transform: 'scaleY(-1)' } : undefined}>
            <Mascote nome={mascote as MascoteNome} pose={posicao.pose} size={MASCOTE_W} />
          </div>
        )}
      </div>
    </div>
  )
}
