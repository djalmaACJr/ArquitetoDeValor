// Gera os PNGs de entrada pro `@capacitor/assets generate` a partir do
// favicon.svg — placeholder inicial do ícone/splash do app Android; troque
// os SVGs abaixo (ou os arquivos gerados em assets/) por um design dedicado
// quando houver um.
//
// Uso: node scripts/generate-icons.mjs && npx capacitor-assets generate --android
import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'assets')
mkdirSync(OUT_DIR, { recursive: true })

const NAVY = '#0d1220'
const GREEN = '#00c896'
const GOLD = '#f0b429'

// Ícone completo (com fundo navy arredondado) — usado como "icon-only".
const iconOnly = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="${NAVY}"/>
  <polyline points="6,22 12,16 18,10 26,14" fill="none" stroke="${GREEN}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="26" cy="14" r="3" fill="${GOLD}"/>
</svg>`

// Camada de fundo do ícone adaptativo (Android) — cor sólida, sem o traçado.
const iconBackground = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${NAVY}"/>
</svg>`

// Camada de frente do ícone adaptativo — só o traçado, fundo transparente,
// com margem extra (safe zone) pra não ser cortado pela máscara do Android.
const iconForeground = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <polyline points="6,22 12,16 18,10 26,14" fill="none" stroke="${GREEN}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="26" cy="14" r="3" fill="${GOLD}"/>
</svg>`

// Splash: canvas grande navy com o mesmo traçado centralizado e reduzido —
// o corte central de qualquer proporção de tela mantém o motivo visível.
const splash = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="${NAVY}"/>
  <g transform="translate(84,84) scale(2)">
    <polyline points="6,22 12,16 18,10 26,14" fill="none" stroke="${GREEN}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="26" cy="14" r="3" fill="${GOLD}"/>
  </g>
</svg>`

const jobs = [
  { name: 'icon-only.png', svg: iconOnly, size: 1024 },
  { name: 'icon-background.png', svg: iconBackground, size: 1024 },
  { name: 'icon-foreground.png', svg: iconForeground, size: 1024 },
  { name: 'splash.png', svg: splash, size: 2732 },
  { name: 'splash-dark.png', svg: splash, size: 2732 },
]

for (const job of jobs) {
  await sharp(Buffer.from(job.svg), { density: 384 })
    .resize(job.size, job.size)
    .png()
    .toFile(join(OUT_DIR, job.name))
  console.log('gerado', job.name)
}
