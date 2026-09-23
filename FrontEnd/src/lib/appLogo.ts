// src/lib/appLogo.ts
// Logo do Arquiteto de Valor em SVG inline (mesmo arte da Sidebar).
// Usado por exportUtils para inserir o logo no cabeçalho das planilhas.

export const APP_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32,10 L14,50" fill="none" stroke="#4da6ff" stroke-width="4" stroke-linecap="round"/>
  <path d="M32,10 L50,50" fill="none" stroke="#4da6ff" stroke-width="4" stroke-linecap="round"/>
  <circle cx="32" cy="10" r="3.5" fill="#4da6ff"/>
  <polyline points="14,50 26,38 38,42 50,26"
    fill="none" stroke="#00c896" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="50" cy="26" r="4.5" fill="#f0b429"/>
</svg>`

export const APP_NAME = 'Arquiteto de Valor'

/**
 * Renderiza o SVG do logo em um PNG (ArrayBuffer) via canvas para ser
 * inserido em planilhas Excel (ExcelJS só aceita PNG/JPG/GIF — não SVG).
 *
 * @param size — lado em pixels do PNG resultante (default 80)
 */
export async function logoComoPng(size = 80): Promise<ArrayBuffer> {
  // Garante fundo transparente; o SVG já tem viewBox quadrado
  const blob = new Blob([APP_LOGO_SVG], { type: 'image/svg+xml' })
  const url  = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload  = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas não disponível')
    ctx.drawImage(img, 0, 0, size, size)
    const blobPng = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blobPng) throw new Error('Falha ao gerar PNG do logo')
    return await blobPng.arrayBuffer()
  } finally {
    URL.revokeObjectURL(url)
  }
}
