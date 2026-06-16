// supabase/functions/_shared/ia.ts
//
// Camada compartilhada de acesso a provedores de IA configurados PELO
// usuário (Perfil → Integração com IA). Centraliza:
//   - os adaptadores por provedor (Claude, GPT, Gemini, DeepSeek,
//     OpenRouter, Mistral, Cohere);
//   - o despacho `chamarProvedorIA(provedor, ...)`;
//   - `lerConfigIAAtiva(cliente, userId)` que resolve a config ativa em
//     `arqvalor.usuarios.ia_configs` e devolve a api_key DECRIPTADA.
//
// Usado por `chat_mascote` (chat com mascote) e por `investimentos`
// (geração do questionário de avaliação pelo Mentor).

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decriptar, ehBlob } from "./cripto.ts";

// Teto padrão de tokens da resposta. Chamadas que esperam saídas longas
// (ex.: gerar questionário JSON) passam `maxTokens` maior.
const DEFAULT_MAX_TOKENS = 2000;

export interface Imagem {
  mediaType: string;  // ex: 'image/png', 'image/jpeg'
  base64:    string;  // dados crus (sem prefixo `data:`)
}

export interface ChamadaIA {
  apiKey:    string;
  /** System prompt (persona do mascote ou instrução de geração). */
  persona:   string;
  mensagens: Array<{ role: "user" | "assistant"; content: string }>;
  /** Anexada à última mensagem do usuário; adapter ignora se o modelo não tem visão. */
  imagem?:   Imagem;
  /** Teto de tokens da resposta (default 2000). */
  maxTokens?: number;
}

/** Provedores com suporte a imagem (visão). */
export const PROVEDORES_VISAO = new Set(["claude", "gpt", "gemini"]);

/** Extrai mediaType + base64 puro de uma data URL ou aceita base64 puro (assume image/png). */
export function parsearImagem(s: string): Imagem | null {
  if (!s) return null;
  const m = s.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (m) return { mediaType: m[1].toLowerCase(), base64: m[2] };
  if (/^[A-Za-z0-9+/=]+$/.test(s.slice(0, 100))) return { mediaType: "image/png", base64: s };
  return null;
}

const tokens = (c: ChamadaIA) => c.maxTokens ?? DEFAULT_MAX_TOKENS;

// ── Adaptadores por provedor ──────────────────────────────────────────

async function chamarClaude(c: ChamadaIA): Promise<string> {
  const { apiKey, persona, mensagens, imagem } = c;
  const msgs: unknown[] = mensagens.map((m, i) => {
    if (imagem && i === mensagens.length - 1 && m.role === "user") {
      return {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: imagem.mediaType, data: imagem.base64 } },
          { type: "text",  text: m.content },
        ],
      };
    }
    return m;
  });
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: tokens(c),
      system:     persona,
      messages:   msgs,
    }),
  });
  if (!resp.ok) throw new Error(`Claude ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { content?: Array<{ type: string; text: string }> };
  return (data.content ?? [])
    .filter(x => x.type === "text").map(x => x.text).join("\n").trim();
}

async function chamarOpenAICompat(url: string, model: string, c: ChamadaIA): Promise<string> {
  const { apiKey, persona, mensagens } = c;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: tokens(c),
      messages: [
        { role: "system", content: persona },
        ...mensagens,
      ],
    }),
  });
  if (!resp.ok) throw new Error(`${url} ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function chamarGPT(c: ChamadaIA): Promise<string> {
  const { apiKey, persona, mensagens, imagem } = c;
  const msgs: unknown[] = [
    { role: "system", content: persona },
    ...mensagens.map((m, i) => {
      if (imagem && i === mensagens.length - 1 && m.role === "user") {
        return {
          role: "user",
          content: [
            { type: "text",      text: m.content },
            { type: "image_url", image_url: { url: `data:${imagem.mediaType};base64,${imagem.base64}` } },
          ],
        };
      }
      return m;
    }),
  ];
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: tokens(c),
      messages: msgs,
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function chamarDeepSeek(c: ChamadaIA): Promise<string> {
  return chamarOpenAICompat("https://api.deepseek.com/chat/completions", "deepseek-chat", c);
}

async function chamarOpenRouter(c: ChamadaIA): Promise<string> {
  return chamarOpenAICompat(
    "https://openrouter.ai/api/v1/chat/completions",
    "meta-llama/llama-3.3-70b-instruct:free",
    c,
  );
}

async function chamarMistral(c: ChamadaIA): Promise<string> {
  return chamarOpenAICompat(
    "https://api.mistral.ai/v1/chat/completions",
    "mistral-small-latest",
    c,
  );
}

async function chamarCohere(c: ChamadaIA): Promise<string> {
  const { apiKey, persona, mensagens } = c;
  const resp = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model: "command-r-08-2024",
      max_tokens: tokens(c),
      messages: [
        { role: "system", content: persona },
        ...mensagens,
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Cohere ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { message?: { content?: Array<{ type: string; text?: string }> } };
  return (data.message?.content ?? [])
    .filter(x => x.type === "text").map(x => x.text ?? "").join("\n").trim();
}

// Modelos preferenciais do Gemini, do mais novo ao mais antigo.
const GEMINI_MODELOS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-1.5-flash-latest",
];

async function chamarGeminiModelo(modelo: string, apiKey: string, persona: string, contents: unknown[], maxTokens: number): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
  return await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: persona }] },
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
}

async function chamarGemini(c: ChamadaIA): Promise<string> {
  const { apiKey, persona, mensagens, imagem } = c;
  const contents = mensagens.map((m, i) => {
    const parts: unknown[] = [{ text: m.content }];
    if (imagem && i === mensagens.length - 1 && m.role === "user") {
      parts.unshift({ inline_data: { mime_type: imagem.mediaType, data: imagem.base64 } });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  let ultimoErro = "";
  for (const modelo of GEMINI_MODELOS) {
    const resp = await chamarGeminiModelo(modelo, apiKey, persona, contents, tokens(c));
    if (resp.ok) {
      const data = await resp.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return (data.candidates?.[0]?.content?.parts ?? [])
        .map(p => p.text ?? "").join("").trim();
    }
    const corpo = await resp.text();
    ultimoErro = `${modelo} ${resp.status}: ${corpo.slice(0, 200)}`;
    if (resp.status !== 404) throw new Error(`Gemini ${ultimoErro}`);
  }
  throw new Error(`Gemini: nenhum modelo disponível para sua chave. Último erro: ${ultimoErro}`);
}

// ── Despacho ──────────────────────────────────────────────────────────

/** Chama o provedor informado. Lança Error em falha de rede/HTTP. */
export async function chamarProvedorIA(provedor: string, c: ChamadaIA): Promise<string> {
  // Visão só para provedores que suportam — descarta imagem nos demais.
  const chamada: ChamadaIA = c.imagem && PROVEDORES_VISAO.has(provedor)
    ? c
    : { ...c, imagem: undefined };
  switch (provedor) {
    case "claude":     return await chamarClaude(chamada);
    case "gpt":        return await chamarGPT(chamada);
    case "gemini":     return await chamarGemini(chamada);
    case "deepseek":   return await chamarDeepSeek(chamada);
    case "openrouter": return await chamarOpenRouter(chamada);
    case "mistral":    return await chamarMistral(chamada);
    case "cohere":     return await chamarCohere(chamada);
    default:           throw new Error(`Provedor desconhecido: ${provedor}`);
  }
}

// ── Resolução da config ativa de IA do usuário ────────────────────────

interface IAConfig {
  id:       string;
  provedor: string;
  api_key:  unknown;   // BlobCriptografado (novo) ou string (legado, ignorado)
  modelo?:  string;
  nome?:    string;
}
interface IAConfigsCol {
  ativa:   string | null;
  configs: IAConfig[];
}

export interface ConfigIAAtiva {
  provedor: string;
  modelo:   string | null;
  apiKey:   string;     // já decriptada
}

export type ResultadoConfigIA =
  | { ok: true;  config: ConfigIAAtiva }
  | { ok: false; erro: string; status: number };

/** Lê `usuarios.ia_configs`, resolve a config ATIVA e decripta a chave. */
export async function lerConfigIAAtiva(cliente: SupabaseClient, userId: string): Promise<ResultadoConfigIA> {
  const { data: prefs, error } = await cliente
    .from("usuarios")
    .select("ia_configs")
    .eq("id", userId)
    .single();

  if (error || !prefs) {
    return { ok: false, erro: "Não foi possível ler suas preferências de IA.", status: 500 };
  }

  const col = (prefs.ia_configs as IAConfigsCol | null) ?? { ativa: null, configs: [] };
  const ativa = col.configs.find(c => c.id === col.ativa);

  if (!ativa || !ativa.provedor || !ehBlob(ativa.api_key)) {
    return {
      ok: false,
      erro: "Integração com IA não configurada (ou em formato antigo). Vá em Perfil → Integração com IA e cadastre uma chave.",
      status: 400,
    };
  }

  let apiKey: string;
  try {
    apiKey = await decriptar(ativa.api_key);
  } catch {
    return {
      ok: false,
      erro: "Falha ao decriptar a chave da API. Recadastre a configuração em Perfil → Integração com IA.",
      status: 500,
    };
  }

  return { ok: true, config: { provedor: ativa.provedor, modelo: ativa.modelo ?? null, apiKey } };
}
