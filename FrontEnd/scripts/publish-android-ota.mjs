// Publica uma atualização OTA do app Android via @capgo/capacitor-updater
// (self-hosted no nosso próprio Supabase — sem nuvem da Capgo):
//   1. builda o dist/ atual
//   2. zipa o bundle com @capgo/cli (também confere que notifyAppReady()
//      está presente no build, requisito do plugin)
//   3. sobe o zip pro bucket "app-releases" no Storage
//   4. insere a release em arqvalor.app_releases — dali em diante a edge
//      function app_updates passa a oferecer essa versão pro app instalado
//
// Uso: npm run publish:ota   (dentro de FrontEnd/)
// Requer SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no .env da raiz do repo
// (NUNCA no FrontEnd/.env — esse é o bundle público, o service_role bypassa
// RLS e não pode ir pro client).
import { execSync } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = join(__dirname, '..')
const REPO_ROOT = join(FRONTEND_DIR, '..')

dotenv.config({ path: join(REPO_ROOT, '.env') })

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env da raiz do repo.\n' +
    '(Pegue a service_role key em Supabase Dashboard > Project Settings > API — NUNCA a exponha no FrontEnd/.env.)'
  )
  process.exit(1)
}

// version.ts não é importável direto num script .mjs puro — extrai por regex
// em vez de adicionar um loader de TS só pra isso.
const versionSrc = readFileSync(join(REPO_ROOT, 'version.ts'), 'utf8')
const versionMatch = versionSrc.match(/APP_VERSION\s*=\s*"([^"]+)"/)
if (!versionMatch) throw new Error('Não achei APP_VERSION em version.ts')
const APP_VERSION = versionMatch[1]

console.log(`Publicando release Android v${APP_VERSION}...`)

console.log('1/4 — build do dist/...')
execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' })

console.log('2/4 — zipando bundle (@capgo/cli)...')
const zipOutput = execSync(
  `npx --yes @capgo/cli bundle zip --path dist --bundle ${APP_VERSION} --json`,
  { cwd: FRONTEND_DIR, encoding: 'utf8' }
)
// A CLI imprime logs de progresso antes do JSON — pega só a última linha `{...}`.
const jsonLine = zipOutput.trim().split('\n').filter(l => l.trim().startsWith('{')).pop()
const { filename, checksum } = JSON.parse(jsonLine)
const zipPath = join(FRONTEND_DIR, filename)

console.log('3/4 — upload pro bucket app-releases...')
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'arqvalor' } })
const storagePath = `android/${filename}`
const zipBuffer = readFileSync(zipPath)
const { error: erroUpload } = await supabase.storage
  .from('app-releases')
  .upload(storagePath, zipBuffer, { contentType: 'application/zip', upsert: true })
if (erroUpload) throw erroUpload
const { data: { publicUrl } } = supabase.storage.from('app-releases').getPublicUrl(storagePath)

console.log('4/4 — registrando release em arqvalor.app_releases...')
const { error: erroInsert } = await supabase.from('app_releases').insert({
  plataforma: 'android',
  canal: 'production',
  versao: APP_VERSION,
  bundle_url: publicUrl,
  checksum,
})
if (erroInsert) throw erroInsert

unlinkSync(zipPath)

console.log(`\nRelease v${APP_VERSION} publicada: ${publicUrl}`)
console.log('O app instalado vai baixar essa atualização na próxima abertura/retomada.')
