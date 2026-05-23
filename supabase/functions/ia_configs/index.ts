// ============================================================
// Arquiteto de Valor — Edge Function: ia_configs v1
//
// CRUD das configurações de IA do usuário, com criptografia AES-256-GCM
// da `api_key` antes de gravar. O frontend NUNCA recebe a chave em
// plaintext — só uma máscara (`sk-•••f4a2`) suficiente para identificar
// visualmente. Para editar/atualizar a chave, o usuário envia um novo
// valor; deixar vazio mantém a chave atual.
//
// Rotas (path relativo após /ia_configs):
//   GET    /              lista configs (sem api_key bruta)
//   POST   /              cria { provedor, api_key, nome? }
//   PUT    /:id           atualiza { provedor?, api_key?, nome? }
//   PUT    /:id/ativar    define como ativa
//   DELETE /:id           remove (e troca ativa pra primeira restante)
//
// Estrutura persistida em `arqvalor.usuarios.ia_configs` (JSONB):
//   {
//     ativa: '<id>' | null,
//     configs: [{
//       id:        string,                       // uuid gerado no server
//       provedor:  'claude'|'gpt'|'gemini'|'deepseek',
//       nome:      string | null,
//       api_key:   { v: 1, cipher: <b64>, iv: <b64> },  // encriptado
//       mascara:   'sk-...f4a2',                 // string só pra UI
//     }]
//   }
// ============================================================

import "@supabase/functions-js/edge-runtime.d.ts";
import {
  json, erro, db, autenticar, corsPreFlight, extrairId, extrairAcao,
} from "../_shared/utils.ts";
import { logError, logRequest, logResponse } from "../_shared/logger.ts";
import { encriptar, decriptar, mascarar, type BlobCriptografado } from "../_shared/cripto.ts";

interface IAConfigPersistida {
  id:       string;
  provedor: string;
  nome:     string | null;
  api_key:  BlobCriptografado;
  mascara:  string;
}
interface IAConfigsCol {
  ativa:   string | null;
  configs: IAConfigPersistida[];
}

const PROVEDORES_VALIDOS = ["claude", "gpt", "gemini", "deepseek", "openrouter", "mistral", "cohere"] as const;
type ProvedorId = typeof PROVEDORES_VALIDOS[number];

// Regex de validação espelha `FrontEnd/src/lib/iaProvedores.ts`.
const FORMATOS: Record<ProvedorId, RegExp> = {
  claude:     /^sk-ant-[\w-]{40,}$/,
  gpt:        /^sk-(proj-)?[\w-]{20,}$/,
  gemini:     /^AIza[\w-]{30,}$/,
  deepseek:   /^sk-[\w-]{32,}$/,
  openrouter: /^sk-or-[\w-]{20,}$/,
  mistral:    /^[A-Za-z0-9]{20,}$/,
  cohere:     /^[\w-]{20,}$/,
};

function uuid(): string {
  // crypto.randomUUID é nativo no Deno
  return crypto.randomUUID();
}

function ehProvedor(s: unknown): s is ProvedorId {
  return typeof s === "string" && (PROVEDORES_VALIDOS as readonly string[]).includes(s);
}

/** Versão "pública" sem o api_key bruto pra retornar ao cliente. */
function exportar(c: IAConfigsCol) {
  return {
    ativa: c.ativa,
    configs: c.configs.map(cfg => ({
      id:       cfg.id,
      provedor: cfg.provedor,
      nome:     cfg.nome,
      mascara:  cfg.mascara,
    })),
  };
}

async function lerConfigs(cliente: ReturnType<typeof db>, userId: string): Promise<IAConfigsCol> {
  const { data, error } = await cliente
    .from("usuarios")
    .select("ia_configs")
    .eq("id", userId)
    .single();
  if (error) {
    logError("Ler ia_configs", error);
    throw new Error("Falha ao ler configurações.");
  }
  const raw = data?.ia_configs as IAConfigsCol | null | undefined;
  if (!raw || !Array.isArray(raw.configs)) {
    return { ativa: null, configs: [] };
  }
  // Filtra configs em formato antigo (api_key string plain) — descartadas
  // por segurança. Migration acompanhante zera essas entradas.
  const limpas = raw.configs.filter(c =>
    c && typeof c === "object"
      && typeof (c as IAConfigPersistida).api_key === "object"
      && (c as IAConfigPersistida).api_key !== null
  );
  return { ativa: raw.ativa ?? null, configs: limpas };
}

async function gravarConfigs(
  cliente: ReturnType<typeof db>,
  userId: string,
  col: IAConfigsCol,
) {
  const { error } = await cliente
    .from("usuarios")
    .update({ ia_configs: col })
    .eq("id", userId);
  if (error) {
    logError("Gravar ia_configs", error);
    throw new Error("Falha ao salvar configurações.");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id    = extrairId(req, "ia_configs");
  const acao  = extrairAcao(req, "ia_configs");
  const m     = req.method;
  const c     = db(req);

  try {
    if (m === "GET"    && !id)                return await listar(c, userId);
    if (m === "POST"   && !id)                return await criar(c, userId, await req.json());
    if (m === "PUT"    &&  id && acao === "ativar") return await ativar(c, userId, id);
    if (m === "PUT"    &&  id && acao === "testar") return await testar(c, userId, id);
    if (m === "PUT"    &&  id && !acao)       return await atualizar(c, userId, id, await req.json());
    if (m === "DELETE" &&  id)                return await remover(c, userId, id);
    return erro("Rota não encontrada", 404);
  } catch (e) {
    logError("Handler ia_configs", e);
    return erro((e as Error).message || "Erro interno", 500);
  }
});

async function listar(cliente: ReturnType<typeof db>, userId: string): Promise<Response> {
  logRequest("GET", "/ia_configs", { userId });
  const col = await lerConfigs(cliente, userId);
  logResponse(200, { count: col.configs.length });
  return json({ dados: exportar(col) });
}

async function criar(cliente: ReturnType<typeof db>, userId: string, body: Record<string, unknown>): Promise<Response> {
  logRequest("POST", "/ia_configs", { provedor: body.provedor });

  const provedor = body.provedor;
  const api_key  = body.api_key;
  const nome     = body.nome;

  if (!ehProvedor(provedor))     return erro("Provedor inválido.");
  if (typeof api_key !== "string" || !api_key.trim()) return erro("Informe a chave da API.");
  const keyTrim = api_key.trim();
  if (!FORMATOS[provedor].test(keyTrim)) {
    return erro("Formato da chave parece incorreto.");
  }
  if (nome !== undefined && nome !== null && typeof nome !== "string") {
    return erro("Nome deve ser texto.");
  }

  const blob = await encriptar(keyTrim);
  const nova: IAConfigPersistida = {
    id:       uuid(),
    provedor,
    nome:     (typeof nome === "string" && nome.trim()) ? nome.trim().slice(0, 60) : null,
    api_key:  blob,
    mascara:  mascarar(keyTrim),
  };

  const col = await lerConfigs(cliente, userId);
  col.configs.push(nova);
  if (!col.ativa) col.ativa = nova.id;
  await gravarConfigs(cliente, userId, col);

  logResponse(200, { id: nova.id });
  return json({ dados: exportar(col), id: nova.id });
}

async function atualizar(
  cliente: ReturnType<typeof db>,
  userId:  string,
  id:      string,
  body:    Record<string, unknown>,
): Promise<Response> {
  logRequest("PUT", `/ia_configs/${id}`, { campos: Object.keys(body) });

  const col = await lerConfigs(cliente, userId);
  const idx = col.configs.findIndex(c => c.id === id);
  if (idx < 0) return erro("Configuração não encontrada.", 404);
  const atual = col.configs[idx];

  const novoProvedor: ProvedorId = ehProvedor(body.provedor) ? body.provedor : (atual.provedor as ProvedorId);

  let novoBlob = atual.api_key;
  let novaMascara = atual.mascara;
  if (typeof body.api_key === "string" && body.api_key.trim()) {
    const keyTrim = body.api_key.trim();
    if (!FORMATOS[novoProvedor].test(keyTrim)) {
      return erro("Formato da chave parece incorreto.");
    }
    novoBlob = await encriptar(keyTrim);
    novaMascara = mascarar(keyTrim);
  }

  let novoNome = atual.nome;
  if (body.nome !== undefined) {
    if (body.nome === null || body.nome === "") {
      novoNome = null;
    } else if (typeof body.nome === "string") {
      novoNome = body.nome.trim().slice(0, 60) || null;
    }
  }

  col.configs[idx] = {
    ...atual,
    provedor: novoProvedor,
    nome:     novoNome,
    api_key:  novoBlob,
    mascara:  novaMascara,
  };
  await gravarConfigs(cliente, userId, col);

  logResponse(200, { id });
  return json({ dados: exportar(col) });
}

async function ativar(cliente: ReturnType<typeof db>, userId: string, id: string): Promise<Response> {
  logRequest("PUT", `/ia_configs/${id}/ativar`, {});
  const col = await lerConfigs(cliente, userId);
  if (!col.configs.find(c => c.id === id)) {
    return erro("Configuração não encontrada.", 404);
  }
  col.ativa = id;
  await gravarConfigs(cliente, userId, col);
  return json({ dados: exportar(col) });
}

async function remover(cliente: ReturnType<typeof db>, userId: string, id: string): Promise<Response> {
  logRequest("DELETE", `/ia_configs/${id}`, {});
  const col = await lerConfigs(cliente, userId);
  const restantes = col.configs.filter(c => c.id !== id);
  if (restantes.length === col.configs.length) {
    return erro("Configuração não encontrada.", 404);
  }
  col.configs = restantes;
  if (col.ativa === id) {
    col.ativa = restantes[0]?.id ?? null;
  }
  await gravarConfigs(cliente, userId, col);
  return json({ dados: exportar(col) });
}

// ── Teste de configuração ────────────────────────────────────────────
// Faz uma chamada mínima ao provedor pra validar chave + disponibilidade.
// Mantém este código separado do chat_mascote para não acoplar — o objetivo
// aqui é APENAS validar "a chave funciona?", não conversar.

const MODELOS: Record<ProvedorId, string> = {
  claude:     "claude-haiku-4-5-20251001",
  gpt:        "gpt-4o-mini",
  gemini:     "gemini-2.5-flash",
  deepseek:   "deepseek-chat",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  mistral:    "mistral-small-latest",
  cohere:     "command-r-08-2024",
};

// Fallback de modelos para o Gemini (o Google muda muito os nomes).
const GEMINI_MODELOS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-1.5-flash-latest",
];

// URLs e nomes "amigáveis" para os provedores OpenAI-compatíveis.
const OPENAI_COMPAT: Partial<Record<ProvedorId, { url: string; label: string }>> = {
  gpt:        { url: "https://api.openai.com/v1/chat/completions",    label: "OpenAI" },
  deepseek:   { url: "https://api.deepseek.com/chat/completions",     label: "DeepSeek" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", label: "OpenRouter" },
  mistral:    { url: "https://api.mistral.ai/v1/chat/completions",    label: "Mistral" },
  cohere:     { url: "https://api.cohere.com/v2/chat",                label: "Cohere" },
};

async function pingProvedor(provedor: ProvedorId, apiKey: string): Promise<{ ok: boolean; mensagem: string }> {
  const msgPing = "Responda apenas 'ok'.";
  const modelo  = MODELOS[provedor];

  try {
    if (provedor === "claude") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
          "content-type":      "application/json",
        },
        body: JSON.stringify({
          model: modelo, max_tokens: 10,
          messages: [{ role: "user", content: msgPing }],
        }),
      });
      if (!r.ok) return { ok: false, mensagem: amigavel("Claude", r.status, await r.text()) };
      return { ok: true, mensagem: `Conectado ao ${modelo}.` };
    }
    const compat = OPENAI_COMPAT[provedor];
    if (compat) {
      const r = await fetch(compat.url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelo, max_tokens: 10,
          messages: [{ role: "user", content: msgPing }],
        }),
      });
      if (!r.ok) return { ok: false, mensagem: amigavel(compat.label, r.status, await r.text()) };
      return { ok: true, mensagem: `Conectado ao ${modelo}.` };
    }
    if (provedor === "gemini") {
      // Tenta cada modelo em ordem (o Google muda muito o que está disponível).
      let ultimoStatus = 0;
      let ultimoCorpo = "";
      for (const m of GEMINI_MODELOS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: msgPing }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
        });
        if (r.ok) return { ok: true, mensagem: `Conectado ao ${m}.` };
        ultimoStatus = r.status;
        ultimoCorpo = await r.text();
        // 404 = modelo não encontrado → tenta próximo. Outros = erro real, para.
        if (r.status !== 404) break;
      }
      return { ok: false, mensagem: amigavel("Gemini", ultimoStatus, ultimoCorpo) };
    }
    return { ok: false, mensagem: "Provedor desconhecido." };
  } catch (e) {
    return { ok: false, mensagem: `Falha de rede: ${(e as Error).message}` };
  }
}

/** Converte status code + body do provedor em mensagem clara pro usuário. */
function amigavel(nome: string, status: number, body: string): string {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) {
    return `${nome} rejeitou a chave (${status}). Verifique se está correta e ativa.`;
  }
  if (status === 402 || lower.includes("insufficient balance") || lower.includes("insufficient_quota")) {
    return `${nome}: sua conta está sem saldo. Adicione crédito no painel do provedor (cartão ou pré-pago).`;
  }
  if (status === 429 && lower.includes("quota")) {
    return `${nome}: sua conta está sem crédito ou billing ativo. Adicione cartão/crédito no painel do provedor.`;
  }
  if (status === 429) {
    return `${nome}: limite de requisições por minuto atingido. Tente novamente em alguns segundos.`;
  }
  if (status === 404) {
    return `${nome}: modelo não encontrado (${status}). Pode estar descontinuado — me avise.`;
  }
  if (status >= 500) {
    return `${nome} fora do ar (${status}). Tente de novo em alguns minutos.`;
  }
  return `${nome} ${status}: ${body.slice(0, 200)}`;
}

async function testar(cliente: ReturnType<typeof db>, userId: string, id: string): Promise<Response> {
  logRequest("PUT", `/ia_configs/${id}/testar`, {});
  const col = await lerConfigs(cliente, userId);
  const cfg = col.configs.find(c => c.id === id);
  if (!cfg) return erro("Configuração não encontrada.", 404);
  if (!ehProvedor(cfg.provedor)) return erro("Provedor da configuração é inválido.", 400);

  let chave: string;
  try {
    chave = await decriptar(cfg.api_key);
  } catch (e) {
    logError("Decriptar para teste", e);
    return erro("Falha ao decriptar a chave salva. Recadastre.", 500);
  }

  const r = await pingProvedor(cfg.provedor, chave);
  return json({ dados: { ok: r.ok, mensagem: r.mensagem } });
}
