// src/lib/appLogo.ts
// Logo do Arquiteto de Valor em SVG inline (mesmo arte da Sidebar).
// Usado por exportUtils para inserir o logo no cabeçalho das planilhas.

export const APP_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="210 30 260 260">
  <g opacity="0.25">
    <line x1="230" y1="50" x2="230" y2="270" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="260" y1="50" x2="260" y2="270" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="290" y1="50" x2="290" y2="270" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="320" y1="50" x2="320" y2="270" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="350" y1="50" x2="350" y2="270" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="380" y1="50" x2="380" y2="270" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="410" y1="50" x2="410" y2="270" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="440" y1="50" x2="440" y2="270" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="215" y1="90"  x2="455" y2="90"  stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="215" y1="130" x2="455" y2="130" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="215" y1="170" x2="455" y2="170" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="215" y1="210" x2="455" y2="210" stroke="#4da6ff" stroke-width="0.8"/>
    <line x1="215" y1="250" x2="455" y2="250" stroke="#4da6ff" stroke-width="0.8"/>
  </g>
  <rect x="258" y="185" width="18" height="40"  rx="3" fill="#1a2540"/>
  <rect x="258" y="183" width="18" height="5"   rx="2" fill="#f0b429"/>
  <rect x="282" y="165" width="18" height="60"  rx="3" fill="#1a2540"/>
  <rect x="282" y="163" width="18" height="5"   rx="2" fill="#00c896"/>
  <rect x="306" y="140" width="18" height="85"  rx="3" fill="#1a2540"/>
  <rect x="306" y="138" width="18" height="5"   rx="2" fill="#00c896"/>
  <rect x="386" y="120" width="18" height="95"  rx="3" fill="#1a2540"/>
  <rect x="386" y="118" width="18" height="5"   rx="2" fill="#f0b429"/>
  <rect x="410" y="100" width="18" height="115" rx="3" fill="#1a2540"/>
  <rect x="410" y="98"  width="18" height="5"   rx="2" fill="#00c896"/>
  <polyline points="267,218 291,195 315,165 395,148 419,128"
    fill="none" stroke="#00c896" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="267" cy="218" r="4"   fill="#00c896"/>
  <circle cx="291" cy="195" r="4"   fill="#00c896"/>
  <circle cx="315" cy="165" r="4"   fill="#00c896"/>
  <circle cx="395" cy="148" r="4"   fill="#f0b429"/>
  <circle cx="419" cy="128" r="4.5" fill="#f0b429"/>
  <polygon points="419,108 426,124 419,120 412,124" fill="#f0b429"/>
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
