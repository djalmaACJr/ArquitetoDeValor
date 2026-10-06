// e2e/tests/14_teclado_mobile.spec.ts
// Celular: ao focar um campo de digitação, ele é trazido pra área visível
// (lib/tecladoMobile.ts). O teclado virtual em si não existe no navegador de
// teste — aqui cobre-se a rolagem automática do campo focado, que é a parte em JS.
// O redimensionamento nativo (adjustResize/Keyboard.resizeOnFullScreen) só dá pra
// validar no aparelho/emulador Android real.
import { test, expect } from '@playwright/test'

test.describe('Teclado no celular', () => {
  test('E2E-KBD01 — campo focado fora da tela é trazido pra área visível', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'só no projeto mobile (toque)')

    await page.goto('/perfil')
    await page.waitForLoadState('networkidle').catch(() => {})
    const alturaTela = page.viewportSize()!.height

    // Campo de texto mais abaixo da página (fora da primeira dobra).
    const idx = await page.evaluate(() => {
      const campos = [...document.querySelectorAll('main input:not([type=checkbox]):not([type=radio]):not([type=hidden]), main textarea')] as HTMLElement[]
      let melhor = -1, maxY = 0
      campos.forEach((c, i) => {
        const r = c.getBoundingClientRect()
        if (r.width > 0 && r.top > maxY) { maxY = r.top; melhor = i }
      })
      return maxY > window.innerHeight ? melhor : -1
    })
    test.skip(idx < 0, 'nenhum campo abaixo da primeira dobra nesta página')

    const campo = page.locator('main input:not([type=checkbox]):not([type=radio]):not([type=hidden]), main textarea').nth(idx)
    await campo.focus()
    await page.waitForTimeout(1200)   // 350ms de espera do teclado + rolagem suave

    const caixa = (await campo.boundingBox())!
    expect(caixa.y).toBeGreaterThanOrEqual(0)
    expect(caixa.y + caixa.height).toBeLessThanOrEqual(alturaTela)
  })
})
