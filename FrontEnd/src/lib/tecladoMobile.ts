// src/lib/tecladoMobile.ts
//
// Em celular (toque), ao focar um campo de digitação o teclado ocupa ~40% da tela;
// sem ajuda o campo (e o contexto ao redor) fica escondido ou mal posicionado.
// Esta rotina traz o campo focado pro centro da área visível depois que o teclado
// termina de abrir, e de novo se a área visível mudar enquanto ele está aberto.
//
// Complementa (não substitui) o redimensionamento nativo: no app Android isso vem de
// `android:windowSoftInputMode="adjustResize"` + `Keyboard.resizeOnFullScreen`
// (capacitor.config.ts); na web mobile, de `interactive-widget=resizes-content`
// no viewport (index.html).

import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

// Campos que abrem teclado (exclui checkbox/radio/botões, que não abrem).
const CAMPOS = [
  'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button])',
  ':not([type=submit]):not([type=file]):not([type=color])',
].join('') + ', textarea, select, [contenteditable="true"]'

function campoFocado(): HTMLElement | null {
  const a = document.activeElement
  return a instanceof HTMLElement && a.matches(CAMPOS) ? a : null
}

function trazerParaVista(el: HTMLElement) {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export function iniciarTecladoMobile(): void {
  if (typeof window === 'undefined') return
  // Só dispositivos de toque — no desktop não há teclado virtual.
  if (!window.matchMedia('(pointer: coarse)').matches) return

  document.addEventListener('focusin', (e) => {
    const alvo = e.target
    if (!(alvo instanceof HTMLElement) || !alvo.matches(CAMPOS)) return
    // Espera a animação do teclado; só rola se o campo ainda estiver focado.
    window.setTimeout(() => { if (document.activeElement === alvo) trazerParaVista(alvo) }, 350)
  })

  // Área visível mudou (teclado abriu/fechou/trocou de altura) com um campo focado.
  window.visualViewport?.addEventListener('resize', () => {
    const el = campoFocado()
    if (el) trazerParaVista(el)
  })

  if (Capacitor.isNativePlatform()) {
    // .catch: um bundle novo entregue por OTA a um APK ANTIGO (sem o plugin nativo) rejeita
    // aqui — o resto (focusin/visualViewport) continua funcionando.
    Keyboard.addListener('keyboardDidShow', () => {
      const el = campoFocado()
      if (el) trazerParaVista(el)
    }).catch(() => {})
  }
}
