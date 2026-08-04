// Publica uma atualização OTA do app Android via @capgo/capacitor-updater
// (self-hosted no nosso próprio Supabase — sem nuvem da Capgo):
//   1. builda o dist/ atual
//   2. zipa o bundle com @capgo/cli (também confere que notifyAppReady()
//      está presente no build, requisito do plugin)
//   3. assina/cifra o zip com a chave privada (E2E v2) — o app só aceita
//      updates assinados com o par da publicKey embutida no APK
//   4. sobe o zip CIFRADO pro bucket "app-releases" no Storage
//   5. insere a release em arqvalor.app_releases — dali em diante a edge
//      function app_updates passa a oferecer essa versão pro app instalado
//
// Uso: npm run publish:ota   (dentro de FrontEnd/)
// Requer no .env da raiz do repo (NUNCA no FrontEnd/.env — esse é o bundle
// público, essas chaves não podem ir pro client):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CAPGO_UPDATER_PRIVATE_KEY
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = join(__dirname, '..')
const REPO_ROOT = join(FRONTEND_DIR, '..')

dotenv.config({ path: join(REPO_ROOT, '.env') })

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CAPGO_UPDATER_PRIVATE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CAPGO_UPDATER_PRIVATE_KEY) {
  console.error(
    'Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CAPGO_UPDATER_PRIVATE_KEY no .env da raiz do repo.\n' +
    '(service_role: Supabase Dashboard > Project Settings > API. Chave OTA: `npx @capgo/cli key create` — NUNCA reexponha nenhuma das duas no FrontEnd/.env.)'
  )
  process.exit(1)
}

// version.ts não é importável direto num script .mjs puro — extrai por regex
// em vez de adicionar um loader de TS só pra isso.
const versionSrc = readFileSync(join(REPO_ROOT, 'version.ts'), 'utf8')
const versionMatch = versionSrc.match(/APP_VERSION\s*=\s*"([^"]+)"/)
if (!versionMatch) throw new Error('Não achei APP_VERSION em version.ts')
const APP_VERSION = versionMatch[1]

// Extrai só a última linha `{...}` da saída da CLI (ela imprime logs de
// progresso antes do JSON quando chamada com --json).
function ultimoJson(saida) {
  const linha = saida.trim().split('\n').filter(l => l.trim().startsWith('{')).pop()
  return JSON.parse(linha)
}

console.log(`Publicando release Android v${APP_VERSION}...`)

console.log('1/5 — build do dist/...')
execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' })

console.log('2/5 — zipando bundle (@capgo/cli)...')
const zipOutput = execSync(
  `npx --yes @capgo/cli bundle zip --path dist --bundle ${APP_VERSION} --json`,
  { cwd: FRONTEND_DIR, encoding: 'utf8' }
)
const { filename: zipFilename, checksum: checksumPlano } = ultimoJson(zipOutput)
const zipPath = join(FRONTEND_DIR, zipFilename)

console.log('3/5 — assinando bundle (E2E v2)...')
// A chave privada só existe em memória/arquivo temporário pelo tempo da
// assinatura — nunca fica no disco do projeto.
const tmpKeyPath = join(tmpdir(), `capgo-key-${randomUUID()}.pem`)
let filename, checksum, ivSessionKey, zipEncPath
try {
  writeFileSync(tmpKeyPath, CAPGO_UPDATER_PRIVATE_KEY, { mode: 0o600 })
  const encOutput = execSync(
    `npx --yes @capgo/cli bundle encrypt "${zipPath}" ${checksumPlano} --key "${tmpKeyPath}" --json`,
    { cwd: FRONTEND_DIR, encoding: 'utf8' }
  )
  ;({ filename, checksum, ivSessionKey } = ultimoJson(encOutput))
  zipEncPath = join(FRONTEND_DIR, filename)
} finally {
  unlinkSync(tmpKeyPath)
}

console.log('4/5 — upload pro bucket app-releases...')
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'arqvalor' } })
const storagePath = `android/${filename}`
const zipBuffer = readFileSync(zipEncPath)
const { error: erroUpload } = await supabase.storage
  .from('app-releases')
  .upload(storagePath, zipBuffer, { contentType: 'application/zip', upsert: true })
if (erroUpload) throw erroUpload
const { data: { publicUrl } } = supabase.storage.from('app-releases').getPublicUrl(storagePath)

console.log('5/5 — registrando release em arqvalor.app_releases...')
const { error: erroInsert } = await supabase.from('app_releases').insert({
  plataforma: 'android',
  canal: 'production',
  versao: APP_VERSION,
  bundle_url: publicUrl,
  checksum,
  session_key: ivSessionKey,
})
if (erroInsert) throw erroInsert

unlinkSync(zipPath)
unlinkSync(zipEncPath)

console.log(`\nRelease v${APP_VERSION} publicada: ${publicUrl}`)
console.log('O app instalado vai baixar essa atualização na próxima abertura/retomada.')
