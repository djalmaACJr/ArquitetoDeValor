// ============================================================
// Arquiteto de Valor — Edge Function: app_updates v1
// POST /app_updates
// Endpoint público (sem JWT) consultado pelo plugin @capgo/capacitor-updater
// a cada abertura do app Android — devolve o bundle OTA mais recente
// publicado em arqvalor.app_releases, se houver um mais novo que o instalado.
// Contrato do plugin (self-hosted updateUrl): recebe um "AppInfos" e devolve
// { version, url, checksum, session_key } se houver update, ou { message }
// se não houver. Bundles são assinados (@capgo/cli bundle encrypt) — checksum
// aqui é o checksum CIFRADO e session_key é o ivSessionKey exigido pra
// decifrar no dispositivo (ver FrontEnd/capacitor.config.ts → publicKey e
// FrontEnd/scripts/publish-android-ota.mjs).
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, corsPreFlight, registrarOrigem, dbAdmin } from "../_shared/utils.ts";

interface AppInfos {
  platform?: string;
  device_id?: string;
  app_id?: string;
  custom_id?: string;
  plugin_version?: string;
  version_build?: string;
  version_code?: string;
  version_name?: string;
  version_os?: string;
  is_emulator?: boolean;
  is_prod?: boolean;
}

// Compara versões "X.Y.Z" — true se `nova` for mais recente que `atual`.
// "builtin" (bundle original do APK, nunca atualizado via OTA) e valores
// vazios sempre contam como mais antigos que qualquer release publicada.
function versaoMaisNova(nova: string, atual: string): boolean {
  if (!atual || atual === "builtin") return true;
  const a = nova.split(".").map((n) => parseInt(n, 10) || 0);
  const b = atual.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const na = a[i] ?? 0;
    const nb = b[i] ?? 0;
    if (na !== nb) return na > nb;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  registrarOrigem(req);
  if (req.method === "OPTIONS") return corsPreFlight();
  if (req.method !== "POST") return erro("Método não permitido", 405);

  let body: AppInfos;
  try {
    body = await req.json();
  } catch {
    return erro("Corpo inválido", 400);
  }

  const plataforma = body.platform ?? "android";

  const { data, error } = await dbAdmin()
    .from("app_releases")
    .select("versao, bundle_url, checksum, session_key")
    .eq("plataforma", plataforma)
    .eq("canal", "production")
    .eq("ativo", true)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return erro("Erro ao consultar releases", 500);
  if (!data || !versaoMaisNova(data.versao, body.version_name ?? "")) {
    return json({ message: "Nenhuma atualização disponível" });
  }

  return json({
    version: data.versao,
    url: data.bundle_url,
    checksum: data.checksum,
    session_key: data.session_key,
  });
});
