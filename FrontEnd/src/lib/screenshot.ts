// src/lib/screenshot.ts
//
// Captura o `<main>` (área visível da aplicação) como imagem PNG usando
// html2canvas e retorna um data URL pronto pra enviar à IA via campo
// `screenshot` da edge function `chat_mascote`.
//
// Limitações conhecidas:
//   - Charts em <canvas> (Chart.js) precisam de `useCORS: true` e bem
//     desenhados, html2canvas faz cópia OK.
//   - Vídeos (<video>) não são capturados — só primeiro frame fica preto.
//   - Elementos com `background-image` externo precisam de CORS válido.
//   - Em mobile, a captura pode ser grande — escalamos para no máximo
//     1200px de largura pra economizar tokens.

import html2canvas from 'html2canvas'

const LARGURA_MAX = 1200
const QUALIDADE_JPEG = 0.85   // 85% de qualidade — bom balanço tamanho/qualidade

/**
 * Captura o `<main>` (ou um elemento específico) e retorna data URL JPEG.
 * Retorna null se a captura falhar (e.g., navegador antigo, CORS bloqueado).
 */
export async function capturarTela(alvo?: HTMLElement): Promise<string | null> {
  const elemento = alvo ?? (document.querySelector('main') as HTMLElement | null)
  if (!elemento) return null

  try {
    const canvas = await html2canvas(elemento, {
      useCORS:    true,
      logging:    false,
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#0a0f1a',
      // Escala 1 (sem retina x2) pra reduzir tamanho. Pra alta qualidade subir pra 2.
      scale:      1,
    })

    // Redimensiona se passar do limite — reduz tokens enviados pra IA.
    let cFinal: HTMLCanvasElement = canvas
    if (canvas.width > LARGURA_MAX) {
      const ratio = LARGURA_MAX / canvas.width
      const novaW = LARGURA_MAX
      const novaH = Math.round(canvas.height * ratio)
      const c2 = document.createElement('canvas')
      c2.width = novaW
      c2.height = novaH
      const ctx = c2.getContext('2d')!
      ctx.drawImage(canvas, 0, 0, novaW, novaH)
      cFinal = c2
    }

    // JPEG é mais leve que PNG e adequado pra screenshots de UI.
    return cFinal.toDataURL('image/jpeg', QUALIDADE_JPEG)
  } catch (e) {
    console.error('Falha ao capturar tela:', e)
    return null
  }
}
