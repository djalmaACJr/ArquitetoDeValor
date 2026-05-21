// supabase/functions/_shared/cripto.ts
//
// Criptografia simétrica AES-256-GCM para segredos do usuário (api keys
// de IAs, futuramente outros). A chave-mestra é um secret do projeto
// `IA_KEYS_ENCRYPTION_KEY` em base64 (32 bytes = 256 bits).
//
// Setup do secret (uma vez por projeto):
//   openssl rand -base64 32      # gera 32 bytes random
//   supabase secrets set IA_KEYS_ENCRYPTION_KEY=<o-valor-gerado>
//
// O blob persistido no banco tem a forma:
//   { v: 1, cipher: <base64>, iv: <base64> }
//
// - `iv` (12 bytes) é gerado random em cada operação de encriptar.
// - O TAG de autenticação do GCM (16 bytes) é appendado ao final do
//   ciphertext pelo Web Crypto API — não precisa armazenar separado.
// - `v` é o versionamento do formato (futuro: rotação de chave).

const ALGO = "AES-GCM";
const VERSAO_ATUAL = 1;

export interface BlobCriptografado {
  v:      number;
  cipher: string;  // base64
  iv:     string;  // base64
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let chaveCache: CryptoKey | null = null;

async function obterChave(): Promise<CryptoKey> {
  if (chaveCache) return chaveCache;
  const raw = Deno.env.get("IA_KEYS_ENCRYPTION_KEY");
  if (!raw) {
    throw new Error(
      "IA_KEYS_ENCRYPTION_KEY não configurada. Gere com `openssl rand -base64 32` " +
      "e rode `supabase secrets set IA_KEYS_ENCRYPTION_KEY=<valor>`."
    );
  }
  const bytes = base64Decode(raw);
  if (bytes.length !== 32) {
    throw new Error(
      `IA_KEYS_ENCRYPTION_KEY deve ter 32 bytes (256 bits); ` +
      `encontrado ${bytes.length}. Use 'openssl rand -base64 32'.`
    );
  }
  chaveCache = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: ALGO },
    false,
    ["encrypt", "decrypt"],
  );
  return chaveCache;
}

/** Criptografa um texto plano com AES-GCM. Cada chamada gera IV novo. */
export async function encriptar(plaintext: string): Promise<BlobCriptografado> {
  const chave = await obterChave();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, chave, enc);
  return {
    v:      VERSAO_ATUAL,
    cipher: base64Encode(new Uint8Array(ciphertext)),
    iv:     base64Encode(iv),
  };
}

/** Decripta um blob (lança erro se manipulado — GCM autentica). */
export async function decriptar(blob: unknown): Promise<string> {
  if (!ehBlob(blob)) {
    throw new Error("Blob criptografado inválido ou ausente.");
  }
  if (blob.v !== VERSAO_ATUAL) {
    throw new Error(`Versão de cripto desconhecida: ${blob.v}`);
  }
  const chave = await obterChave();
  const iv = base64Decode(blob.iv);
  const ct = base64Decode(blob.cipher);
  const dec = await crypto.subtle.decrypt({ name: ALGO, iv }, chave, ct);
  return new TextDecoder().decode(dec);
}

/** Type guard para BlobCriptografado. */
export function ehBlob(x: unknown): x is BlobCriptografado {
  return !!x && typeof x === "object"
    && typeof (x as Record<string, unknown>).v === "number"
    && typeof (x as Record<string, unknown>).cipher === "string"
    && typeof (x as Record<string, unknown>).iv === "string";
}

/**
 * Gera uma "máscara" segura da chave para exibir no frontend.
 * Ex.: "sk-ant-...3f4a" — só primeiros 7 e últimos 4 chars, resto oculto.
 * Para chaves curtas, usa só os últimos 4.
 */
export function mascarar(plaintext: string): string {
  if (plaintext.length <= 8) return "•".repeat(Math.max(plaintext.length - 2, 0)) + plaintext.slice(-2);
  const prefixo = plaintext.startsWith("sk-")
    ? plaintext.slice(0, plaintext.indexOf("-", 3) >= 0 ? plaintext.indexOf("-", 3) + 1 : 3)
    : plaintext.slice(0, 3);
  const sufixo = plaintext.slice(-4);
  return `${prefixo}•••${sufixo}`;
}
