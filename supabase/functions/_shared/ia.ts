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

import type { Db } from "./utils.ts";
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
  /** Modelo escolhido pelo usuário. Vazio → cada adapter usa seu padrão. */
  modelo?:   string;
  /**
   * Liga a busca na web NATIVA do provedor (grounding), quando suportada
   * (claude/gpt/gemini — ver PROVEDORES_BUSCA_WEB). Opt-in por config de
   * IA (`ia_configs.busca_web`) porque aumenta custo/latência de cada
   * chamada — hoje só usado pela avaliação de ativos por mentores
   * (avaliacoes.ts), como reforço ao contexto factual já injetado no
   * prompt (ex.: Fatos Relevantes de FII). Ignorado nos demais provedores.
   */
  buscaWeb?: boolean;
}

/** Modelo padrão por provedor — usado quando o usuário não escolheu um. */
const MODELO_PADRAO: Record<string, string> = {
  claude:     "claude-haiku-4-5-20251001",
  gpt:        "gpt-4o-mini",
  gemini:     "gemini-2.5-flash",
  deepseek:   "deepseek-chat",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  mistral:    "mistral-small-latest",
  cohere:     "command-r-08-2024",
};

/** Resolve o modelo a usar: o escolhido (se houver) ou o padrão do provedor. */
function modeloDe(provedor: string, c: ChamadaIA): string {
  const m = (c.modelo ?? "").trim();
  return m || MODELO_PADRAO[provedor] || "";
}

/** Provedores com suporte a imagem (visão). */
export const PROVEDORES_VISAO = new Set(["claude", "gpt", "gemini"]);

/** Provedores com busca na web nativa (grounding) implementada. */
export const PROVEDORES_BUSCA_WEB = new Set(["claude", "gpt", "gemini"]);

/** Extrai mediaType + base64 puro de uma data URL ou aceita base64 puro (assume image/png). */
export function parsearImagem(s: string): Imagem | null {
  if (!s) return null;
  const m = s.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (m) return { mediaType: m[1].toLowerCase(), base64: m[2] };
  if (/^[A-Za-z0-9+/=]+$/.test(s.slice(0, 100))) return { mediaType: "image/png", base64: s };
  return null;
}

const tokens = (c: ChamadaIA) => c.maxTokens ?? DEFAULT_MAX_TOKENS;

// ── Tradução de erros para mensagem amigável ──────────────────────────

/** Rótulo amigável por provedor (usado nas mensagens de erro ao usuário). */
const LABEL_PROVEDOR: Record<string, string> = {
  claude:     "Claude (Anthropic)",
  gpt:        "OpenAI (GPT)",
  gemini:     "Google Gemini",
  deepseek:   "DeepSeek",
  openrouter: "OpenRouter",
  mistral:    "Mistral",
  cohere:     "Cohere",
};

/**
 * Erro de chamada a um provedor de IA, já com mensagem pronta para o
 * usuário final (em pt-BR) e o status HTTP que o backend deve devolver.
 */
export class ErroIA extends Error {
  /** Status HTTP que a edge function deve devolver ao frontend. */
  readonly statusResposta: number;
  constructor(mensagem: string, statusResposta = 502) {
    super(mensagem);
    this.name = "ErroIA";
    this.statusResposta = statusResposta;
  }
}

/** Tenta extrair a mensagem crua que o provedor devolveu (best effort). */
function detalheProvedor(corpo: string): string {
  try {
    const j = JSON.parse(corpo) as { error?: { message?: string } | string; message?: string };
    const m = (typeof j.error === "object" ? j.error?.message : j.error) ?? j.message;
    if (typeof m === "string" && m.trim()) return m.trim();
  } catch { /* corpo não-JSON: ignora */ }
  return "";
}

/**
 * Converte uma resposta HTTP de erro de um provedor numa `ErroIA` com
 * texto claro e acionável. Centraliza o tratamento para todos os
 * adaptadores (chat do mascote e geração de questionário de investimento).
 */
export function erroHttpIA(provedor: string, status: number, corpo: string): ErroIA {
  const nome = LABEL_PROVEDOR[provedor] ?? provedor;

  if (status === 429) {
    return new ErroIA(
      `O ${nome} está sobrecarregado e limitou as requisições no momento (erro 429). ` +
      `Aguarde alguns segundos e tente de novo. Se continuar, abra Perfil → Integração com IA e ` +
      `troque o modelo ou o provedor — modelos gratuitos (":free") costumam atingir esse limite com frequência.`,
      429,
    );
  }
  if (status === 401 || status === 403) {
    return new ErroIA(
      `A chave da API do ${nome} foi recusada (não autorizada). Confira em Perfil → Integração com IA se ` +
      `ela está correta, ativa e com permissão para o modelo escolhido.`,
      400,
    );
  }
  if (status === 402) {
    return new ErroIA(
      `Sua conta no ${nome} está sem saldo/créditos para esta chamada. Adicione saldo ou troque para um ` +
      `modelo gratuito em Perfil → Integração com IA.`,
      402,
    );
  }
  if (status === 404) {
    return new ErroIA(
      `O modelo selecionado não foi encontrado no ${nome}. Edite a configuração em Perfil → Integração com IA ` +
      `e escolha outro modelo.`,
      400,
    );
  }
  if (status === 408 || status === 504) {
    return new ErroIA(`O ${nome} demorou demais para responder. Tente novamente em instantes.`, 504);
  }
  if (status >= 500) {
    return new ErroIA(`O ${nome} está instável no momento (erro ${status}). Tente novamente em alguns instantes.`, 502);
  }

  // Demais casos: mensagem genérica + detalhe curto do provedor, se houver.
  const detalhe = detalheProvedor(corpo);
  return new ErroIA(
    `O ${nome} recusou a requisição (erro ${status}).` + (detalhe ? ` Detalhe: ${detalhe.slice(0, 160)}` : ""),
    502,
  );
}

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
      model:      modeloDe("claude", c),
      max_tokens: tokens(c),
      system:     persona,
      messages:   msgs,
      // Tool nativa da Anthropic — o modelo decide sozinho se/quando
      // pesquisar; a resposta ainda vem com blocos `text` normais (+
      // blocos `server_tool_use`/`web_search_tool_result` que o filtro
      // abaixo já ignora), então não precisa de mais nada pra usar o
      // resultado.
      ...(c.buscaWeb ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] } : {}),
    }),
  });
  if (!resp.ok) throw erroHttpIA("claude", resp.status, await resp.text());
  const data = await resp.json() as { content?: Array<{ type: string; text: string }> };
  return (data.content ?? [])
    .filter(x => x.type === "text").map(x => x.text).join("\n").trim();
}

async function chamarOpenAICompat(provedor: string, url: string, model: string, c: ChamadaIA, extraHeaders?: Record<string, string>): Promise<string> {
  const { apiKey, persona, mensagens } = c;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
      ...extraHeaders,
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
  if (!resp.ok) throw erroHttpIA(provedor, resp.status, await resp.text());
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
      model: modeloDe("gpt", c),
      max_tokens: tokens(c),
      messages: msgs,
      // `web_search_options` só tem efeito nos modelos "-search-preview"
      // da OpenAI (Chat Completions) — em outros modelos a API ignora o
      // campo. Documentado na UI (Perfil → Integração com IA) pro usuário
      // saber que precisa trocar de modelo pra fazer efeito.
      ...(c.buscaWeb ? { web_search_options: {} } : {}),
    }),
  });
  if (!resp.ok) throw erroHttpIA("gpt", resp.status, await resp.text());
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function chamarDeepSeek(c: ChamadaIA): Promise<string> {
  return chamarOpenAICompat("deepseek", "https://api.deepseek.com/chat/completions", modeloDe("deepseek", c), c);
}

async function chamarOpenRouter(c: ChamadaIA): Promise<string> {
  // OpenRouter recomenda estes headers para identificar o app (afeta
  // ranking e disponibilidade de modelos :free).
  return chamarOpenAICompat(
    "openrouter",
    "https://openrouter.ai/api/v1/chat/completions",
    modeloDe("openrouter", c),
    c,
    {
      "HTTP-Referer": "https://arquitetodevalor.app",
      "X-Title":      "Arquiteto de Valor",
    },
  );
}

async function chamarMistral(c: ChamadaIA): Promise<string> {
  return chamarOpenAICompat(
    "mistral",
    "https://api.mistral.ai/v1/chat/completions",
    modeloDe("mistral", c),
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
      model: modeloDe("cohere", c),
      max_tokens: tokens(c),
      messages: [
        { role: "system", content: persona },
        ...mensagens,
      ],
    }),
  });
  if (!resp.ok) throw erroHttpIA("cohere", resp.status, await resp.text());
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

async function chamarGeminiModelo(modelo: string, apiKey: string, persona: string, contents: unknown[], maxTokens: number, buscaWeb: boolean): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
  return await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: persona }] },
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
      // Grounding nativo do Gemini — não precisa de loop de tool-use, o
      // texto final já vem pronto em `candidates[0].content.parts[].text`
      // (metadados de citação ficam num campo à parte que ignoramos).
      ...(buscaWeb ? { tools: [{ google_search: {} }] } : {}),
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

  // Modelo escolhido pelo usuário primeiro; depois os fallbacks (Google muda nomes).
  const escolhido = (c.modelo ?? "").trim();
  const ordem = escolhido
    ? [escolhido, ...GEMINI_MODELOS.filter(m => m !== escolhido)]
    : GEMINI_MODELOS;

  let ultimoErro = "";
  for (const modelo of ordem) {
    const resp = await chamarGeminiModelo(modelo, apiKey, persona, contents, tokens(c), !!c.buscaWeb);
    if (resp.ok) {
      const data = await resp.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return (data.candidates?.[0]?.content?.parts ?? [])
        .map(p => p.text ?? "").join("").trim();
    }
    const corpo = await resp.text();
    ultimoErro = `${modelo} ${resp.status}: ${corpo.slice(0, 200)}`;
    // 404 = nome de modelo inexistente → tenta o próximo fallback. Demais
    // erros (429, 401, 5xx…) são definitivos: devolve mensagem amigável.
    if (resp.status !== 404) throw erroHttpIA("gemini", resp.status, corpo);
  }
  throw new ErroIA(
    `Nenhum modelo do Google Gemini está disponível para a sua chave. Verifique em Perfil → Integração com IA ` +
    `se a chave tem acesso à Generative Language API. (detalhe: ${ultimoErro.slice(0, 120)})`,
    400,
  );
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
  busca_web?: boolean; // opt-in de busca na web nativa (só claude/gpt/gemini)
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

/**
 * Lê `usuarios.ia_configs` e decripta a chave de uma config.
 *
 * Por padrão resolve a config ATIVA. Quando `configId` é informado,
 * resolve essa config específica (sem alterar qual está ativa) — usado
 * pelo botão "Conversar" do Perfil, que conversa com uma config pontual
 * sem trocar a ativa do usuário.
 */
export async function lerConfigIAAtiva(
  cliente: Db,
  userId: string,
  configId?: string,
): Promise<ResultadoConfigIA> {
  const { data: prefs, error } = await cliente
    .from("usuarios")
    .select("ia_configs")
    .eq("id", userId)
    .single();

  if (error || !prefs) {
    return { ok: false, erro: "Não foi possível ler suas preferências de IA.", status: 500 };
  }

  const col = (prefs.ia_configs as IAConfigsCol | null) ?? { ativa: null, configs: [] };
  const alvo = configId
    ? col.configs.find(c => c.id === configId)
    : col.configs.find(c => c.id === col.ativa);

  if (!alvo || !alvo.provedor || !ehBlob(alvo.api_key)) {
    return {
      ok: false,
      erro: configId
        ? "Configuração de IA não encontrada (ou em formato antigo). Recadastre em Perfil → Integração com IA."
        : "Integração com IA não configurada (ou em formato antigo). Vá em Perfil → Integração com IA e cadastre uma chave.",
      status: 400,
    };
  }

  let apiKey: string;
  try {
    apiKey = await decriptar(alvo.api_key);
  } catch {
    return {
      ok: false,
      erro: "Falha ao decriptar a chave da API. Recadastre a configuração em Perfil → Integração com IA.",
      status: 500,
    };
  }

  return { ok: true, config: { provedor: alvo.provedor, modelo: alvo.modelo ?? null, apiKey } };
}

// ── Resolução de TODAS as configs de IA do usuário (mentores) ──────────

export interface MentorIA {
  id:       string;
  nome:     string | null;
  provedor: string;
  modelo:   string | null;
  apiKey:   string;     // já decriptada
  buscaWeb: boolean;     // opt-in do usuário + suporte do provedor (ver PROVEDORES_BUSCA_WEB)
}

export type ResultadoMentoresIA =
  | { ok: true;  mentores: MentorIA[] }
  | { ok: false; erro: string; status: number };

/**
 * Lê `usuarios.ia_configs` e devolve TODAS as configs válidas (cada uma é
 * um "mentor"), com a api_key decriptada. Configs em formato antigo (sem
 * blob criptografado) são ignoradas. Usado pela avaliação da carteira,
 * onde todos os mentores configurados opinam sobre cada ativo.
 */
export async function lerMentoresIA(cliente: Db, userId: string): Promise<ResultadoMentoresIA> {
  const { data: prefs, error } = await cliente
    .from("usuarios")
    .select("ia_configs")
    .eq("id", userId)
    .single();

  if (error || !prefs) {
    return { ok: false, erro: "Não foi possível ler suas preferências de IA.", status: 500 };
  }

  const col = (prefs.ia_configs as IAConfigsCol | null) ?? { ativa: null, configs: [] };
  const validas = (col.configs ?? []).filter((c) => c.provedor && ehBlob(c.api_key));

  if (validas.length === 0) {
    return {
      ok: false,
      erro: "Nenhum mentor configurado. Vá em Perfil → Integração com IA e cadastre ao menos uma chave.",
      status: 400,
    };
  }

  const mentores: MentorIA[] = [];
  for (const c of validas) {
    try {
      const apiKey = await decriptar(c.api_key);
      mentores.push({
        id:       c.id,
        nome:     c.nome ?? null,
        provedor: c.provedor,
        modelo:   c.modelo ?? null,
        apiKey,
        buscaWeb: !!c.busca_web && PROVEDORES_BUSCA_WEB.has(c.provedor),
      });
    } catch {
      // Config com chave indecifrável é pulada (não derruba as demais).
    }
  }

  if (mentores.length === 0) {
    return {
      ok: false,
      erro: "Falha ao decriptar as chaves dos mentores. Recadastre em Perfil → Integração com IA.",
      status: 500,
    };
  }

  return { ok: true, mentores };
}
