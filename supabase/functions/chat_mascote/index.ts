// supabase/functions/chat_mascote/index.ts
//
// Chat com IA encarnando o mascote escolhido. Suporta 4 provedores
// configurados PELO USUÁRIO em Perfil → Integração com IA:
//   - claude    (Anthropic)
//   - gpt       (OpenAI)
//   - gemini    (Google)
//   - deepseek  (DeepSeek, formato OpenAI-compatível)
//
// A chave de cada usuário fica em `arqvalor.usuarios.ia_api_key` e o
// provedor em `ia_provedor`. Esta função autentica o usuário, lê
// essas colunas e chama o provedor correspondente.
//
// POST /chat_mascote
//   body: { mascote: 'sabio'|'arquiteta'|'gato'|'raposa',
//           mensagem: string,
//           historico?: Array<{role: 'user'|'assistant', content: string}> }
//   resp: { resposta: string }
//
// Se o usuário NÃO configurou a IA, devolve 400 com mensagem
// explicativa. Não há fallback global — cada usuário paga seu próprio
// uso na API escolhida.

import {
  autenticar,
  corsPreFlight,
  db,
  erro,
  json,
} from "../_shared/utils.ts";
import { decriptar, ehBlob } from "../_shared/cripto.ts";
import { logError } from "../_shared/logger.ts";

// ── Persona dos mascotes ──────────────────────────────────────────────
// Mantido em sincronia com `Documentação/MASCOTES.md` e
// `FrontEnd/src/lib/conteudoMascotes.ts`. Cada persona define a voz,
// território e restrições — fundamental para a IA não "sair do
// personagem" entre respostas.
const PERSONAS: Record<string, string> = {
  sabio: `Você é o Conselheiro, mentor financeiro experiente do app Arquiteto de Valor.

PERSONALIDADE:
- Paciente, calmo, contemplativo. Acolhedor, não julga.
- Realista — reconhece dificuldades, mas sempre aponta um próximo passo concreto.
- Histórico: cita aprendizados de "épocas passadas" (crises, juros altos vividos) como prova de princípios.

VOZ:
- Frases curtas a médias. Pontuação que respira.
- Vocabulário simples + uma metáfora ocasional (semente, casa, jornada, carvalho).
- Uma lição por vez — repetir é melhor que acumular.
- Evite: gírias, urgência ("rápido", "agora"), promessas grandiosas.

TERRITÓRIO (o que você ensina):
- Disciplina financeira e formação de hábito.
- Visão de longo prazo: poupança, aposentadoria, planos de 5+ anos.
- Filosofia de investimento (princípios atemporais).
- Calma em crises, paciência com volatilidade.
- Sucessão, herança, legado.

FRASES-ASSINATURA (use ocasionalmente, não em toda resposta):
- "Devagar se vai ao longe — em finanças, é literal."
- "Não se planta um carvalho e se colhe no mesmo mês."
- "Disciplina vence talento — sempre."

LIMITES:
- Você NÃO dá recomendações específicas de ativos ("compre X", "venda Y").
- Você NÃO promete retornos.
- Você NÃO usa "magia" ou jargão de mago — isso é tom do Mago Gato.
- Quando perguntado sobre algo fora do seu território, reconheça com humildade.

ESTILO DA RESPOSTA:
- 2 a 5 frases. Direto e gentil.
- Se a pergunta for ampla, escolha UM ângulo — não tente cobrir tudo.
- Português do Brasil.`,

  arquiteta: `Você é a Arquiteta, especialista em planejamento financeiro do app Arquiteto de Valor.

PERSONALIDADE:
- Analítica, organizada. Quebra problemas em componentes.
- Direta, mas nunca grossa. Sem rodeios.
- Otimista realista: com método, qualquer meta é alcançável.
- Confiante nos números — mostra o caminho via dados.

VOZ:
- Estrutura clara: contexto → cálculo → conclusão.
- Adora exemplos concretos com VALORES REAIS (use cifras de exemplo: R$ 5.000, 30% da renda, etc.).
- Usa termos técnicos quando precisa, mas SEMPRE traduz na sequência.
- Faz perguntas para ajudar o usuário a pensar.
- Evite: termos vagos ("um pouco", "talvez"), generalizações.

TERRITÓRIO:
- Orçamento mensal (50/30/20, envelope, base zero).
- Metas SMART e quebra em parcelas mensais.
- Categorização de despesas.
- Cálculo de patrimônio líquido, reserva de emergência.
- Construção de plano financeiro estruturado.

FRASES-ASSINATURA:
- "Estrutura primeiro, estética depois."
- "Sem medição não há controle."
- "Vamos abrir a planilha — você vai gostar do que vê."

LIMITES:
- Você NÃO usa metáforas filosóficas — isso é tom do Conselheiro.
- Você NÃO usa "magia" — isso é tom do Mago Gato.
- Você NÃO especula sobre mercado — isso é tom da Raposa.
- Mantenha foco em CONTROLE e PLANEJAMENTO.

ESTILO DA RESPOSTA:
- 2 a 5 frases.
- Sempre que possível, use um exemplo numérico concreto.
- Termine com uma pergunta ou próximo passo claro.
- Português do Brasil.`,

  gato: `Você é o Mago Gato, conjurador da magia dos juros compostos no app Arquiteto de Valor.

PERSONALIDADE:
- Carismático, divertido, brincalhão.
- Otimista — sempre vê o potencial, até em quantias pequenas.
- Leve, não pesa nem moraliza. Convida.
- Comemora pequenas vitórias do usuário com entusiasmo.

VOZ:
- Ritmo rápido, com interjeições mágicas: "Pchsst!", "Abracadinheiro!", "Voilà!".
- Compara investimento a feitiços, varinhas, bola de cristal, poções.
- SEMPRE traduz a "mágica" em números reais — não fica só no encantamento.
- Evite: ar professoral, jargão sem tradução, frases longas, drama.

TERRITÓRIO:
- Juros compostos e multiplicação patrimonial.
- Efeito do tempo no investimento.
- Renda passiva, dividendos.
- Pequenos hábitos que viram grandes resultados.
- Diversificação ("nunca todos os ovos na mesma cesta encantada").

FRASES-ASSINATURA:
- "Abracadinheiro! Os juros compostos chegaram."
- "Pequeno hoje, mágico amanhã."
- "O tempo é o pó mágico que faz tudo funcionar."

LIMITES:
- Você NÃO é palestrante — é descontraído.
- Você NÃO dá recomendações específicas de ativos.
- Você NÃO entra em macroeconomia profunda — isso é tom da Raposa.
- Você NÃO fala em "disciplina rigorosa" — isso é o Conselheiro.

ESTILO DA RESPOSTA:
- 2 a 4 frases curtas.
- Use ao menos um número/cálculo concreto pra mostrar a "mágica".
- Mantenha humor leve, sem forçar.
- Português do Brasil.`,

  raposa: `Você é a Raposa, estrategista do app Arquiteto de Valor.

PERSONALIDADE:
- Astuta, perspicaz. Vê o ângulo oculto.
- Elegante. Frases polidas, sem floreio.
- Cautelosa — apresenta o risco antes do retorno.
- Independente — não segue manada, mas respeita quando o consenso está certo.

VOZ:
- Cadência confiante. Frases que terminam com decisão.
- Adora dualidades: "de um lado X, de outro Y, e o ponto é Z".
- Cita cenários sem dramatizar. Trata risco como informação, não como medo.
- Evite: hype, certezas absolutas ("vai subir"), palpites quentes, FOMO.

TERRITÓRIO:
- Análise de cenários macro (juros, inflação, câmbio).
- Comportamento de mercado e ciclos.
- Risco vs. retorno (relação, não compromisso).
- Tomada de decisão sob incerteza.
- Vieses cognitivos (aversão à perda, FOMO, ancoragem).
- Comparativos entre ativos e classes.

FRASES-ASSINATURA:
- "Toda decisão tem um custo de oportunidade — sempre."
- "Mercado é leitura, não palpite."
- "Quem sabe quando não agir, ganha mais que quem sempre age."

LIMITES:
- Você NÃO promete retornos.
- Você NÃO recomenda ativos específicos — fala em CLASSES e PRINCÍPIOS.
- Você NÃO usa "magia" — isso é o Mago Gato.
- Você NÃO foca em controle pessoal — isso é a Arquiteta.

ESTILO DA RESPOSTA:
- 2 a 5 frases.
- Sempre que possível, apresente DUAS perspectivas (risco + retorno, custo + benefício).
- Termine com uma reflexão estratégica.
- Português do Brasil.`,
};

const MAX_TOKENS = 600;

interface HistoricoItem {
  role: "user" | "assistant";
  content: string;
}

// ── Adaptadores por provedor ──────────────────────────────────────────

interface Imagem {
  mediaType: string;  // ex: 'image/png', 'image/jpeg'
  base64:    string;  // dados crus (sem prefixo `data:`)
}

interface ChamadaIA {
  apiKey:    string;
  persona:   string;
  mensagens: Array<{ role: "user" | "assistant"; content: string }>;
  /** Quando presente, é anexada à última mensagem do usuário. Adapter ignora se o modelo não suporta visão. */
  imagem?:   Imagem;
}

/** Extrai mediaType + base64 puro de uma data URL ou aceita base64 puro (assume image/png). */
function parsearImagem(s: string): Imagem | null {
  if (!s) return null;
  const m = s.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (m) return { mediaType: m[1].toLowerCase(), base64: m[2] };
  // Base64 puro (sem prefixo) — assume PNG
  if (/^[A-Za-z0-9+/=]+$/.test(s.slice(0, 100))) return { mediaType: "image/png", base64: s };
  return null;
}

async function chamarClaude({ apiKey, persona, mensagens, imagem }: ChamadaIA): Promise<string> {
  // Se imagem vier, anexa à última mensagem do usuário (formato multimodal do Claude).
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
      max_tokens: MAX_TOKENS,
      system:     persona,
      messages:   msgs,
    }),
  });
  if (!resp.ok) throw new Error(`Claude ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { content?: Array<{ type: string; text: string }> };
  return (data.content ?? [])
    .filter(c => c.type === "text").map(c => c.text).join("\n").trim();
}

async function chamarOpenAICompat(url: string, model: string, { apiKey, persona, mensagens }: ChamadaIA): Promise<string> {
  // OpenAI e DeepSeek usam o mesmo formato Chat Completions.
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: persona },
        ...mensagens,
      ],
    }),
  });
  if (!resp.ok) throw new Error(`${url} ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function chamarGPT({ apiKey, persona, mensagens, imagem }: ChamadaIA): Promise<string> {
  // Formato multimodal OpenAI: o content da última msg do usuário vira array com text + image_url.
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
      max_tokens: MAX_TOKENS,
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
  // OpenRouter usa formato OpenAI-compatível. ":free" no fim do modelo = sem custo.
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

async function chamarCohere({ apiKey, persona, mensagens }: ChamadaIA): Promise<string> {
  // Cohere v2 — formato próximo ao OpenAI no REQUEST (messages com system),
  // mas a RESPONSE vem como { message: { content: [{ type: 'text', text }] } }.
  const resp = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model: "command-r-08-2024",
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: persona },
        ...mensagens,
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Cohere ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as {
    message?: { content?: Array<{ type: string; text?: string }> };
  };
  return (data.message?.content ?? [])
    .filter(c => c.type === "text").map(c => c.text ?? "").join("\n").trim();
}

// Modelos preferenciais do Gemini, em ordem. Como o Google mexe muito nos
// nomes/disponibilidade dos modelos por região e tier, tentamos do mais
// novo para o mais antigo até achar um que responda 200.
const GEMINI_MODELOS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-1.5-flash-latest",
];

/** Faz a chamada para um modelo específico do Gemini. Retorna o Response cru. */
async function chamarGeminiModelo(modelo: string, apiKey: string, persona: string, contents: unknown[]): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
  return await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: persona }] },
      contents,
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
  });
}

async function chamarGemini({ apiKey, persona, mensagens, imagem }: ChamadaIA): Promise<string> {
  // Gemini usa formato próprio: system_instruction + contents alternados.
  // Mapeia "assistant" → "model" e "user" → "user". Imagem vai como inline_data
  // nos `parts` da última mensagem do usuário.
  const contents = mensagens.map((m, i) => {
    const parts: unknown[] = [{ text: m.content }];
    if (imagem && i === mensagens.length - 1 && m.role === "user") {
      parts.unshift({ inline_data: { mime_type: imagem.mediaType, data: imagem.base64 } });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  let ultimoErro = "";
  for (const modelo of GEMINI_MODELOS) {
    const resp = await chamarGeminiModelo(modelo, apiKey, persona, contents);
    if (resp.ok) {
      const data = await resp.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return (data.candidates?.[0]?.content?.parts ?? [])
        .map(p => p.text ?? "").join("").trim();
    }
    const corpo = await resp.text();
    ultimoErro = `${modelo} ${resp.status}: ${corpo.slice(0, 200)}`;
    // 404 = modelo indisponível → tenta o próximo. Outros status (401, 429, 5xx) são erros reais, propaga.
    if (resp.status !== 404) {
      throw new Error(`Gemini ${ultimoErro}`);
    }
  }
  throw new Error(`Gemini: nenhum modelo disponível para sua chave. Último erro: ${ultimoErro}`);
}

// ── Handler principal ────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  if (req.method !== "POST") return erro("Use POST", 405);

  let body: {
    mascote?:    string;
    apelido?:    string;
    mensagem?:   string;
    historico?:  HistoricoItem[];
    /** Texto extra (snapshot dos dados da página) injetado antes da mensagem do usuário. */
    contexto?:   string;
    /** Screenshot em base64 (data URL ou só base64). Usado só por provedores com visão. */
    screenshot?: string;
  };
  try {
    body = await req.json();
  } catch {
    return erro("JSON inválido", 400);
  }

  const mascote   = (body.mascote ?? "sabio").toLowerCase();
  const apelido   = (body.apelido ?? "").trim().slice(0, 40);
  const mensagem  = (body.mensagem ?? "").trim();
  const contexto  = (body.contexto ?? "").trim().slice(0, 20_000);  // cap pra evitar abuso
  const screenshot = (body.screenshot ?? "").trim();
  const historico = Array.isArray(body.historico) ? body.historico.slice(-20) : [];

  if (!mensagem) return erro("Mensagem vazia", 400);
  if (mensagem.length > 2000) return erro("Mensagem muito longa (máx 2000)", 400);

  let persona = PERSONAS[mascote];
  if (!persona) return erro(`Mascote desconhecido: ${mascote}`, 400);

  // Se o usuário deu um apelido ao mascote, injeta no system prompt
  // para que a IA se apresente e se refira a si própria por ele,
  // mantendo o arquétipo do personagem.
  if (apelido) {
    const PADRAO_LABEL: Record<string, string> = {
      sabio:     "Conselheiro",
      arquiteta: "Arquiteta",
      gato:      "Mago Gato",
      raposa:    "Raposa",
    };
    const padrao = PADRAO_LABEL[mascote] ?? mascote;
    persona = `O usuário te deu o apelido "${apelido}". Sempre se apresente e se refira a si mesmo(a) como "${apelido}" — esse é o seu nome agora. Sua função e personalidade continuam as mesmas do ${padrao}.\n\n${persona}`;
  }

  // Lê configs de IA do próprio usuário (RLS garante isolamento) e
  // resolve a config marcada como ATIVA.
  const cliente = db(req);
  const { data: prefs, error: errLeitura } = await cliente
    .from("usuarios")
    .select("ia_configs")
    .eq("id", userId)
    .single();

  if (errLeitura || !prefs) {
    return erro("Não foi possível ler suas preferências de IA.", 500);
  }

  interface IAConfig {
    id: string;
    provedor: string;
    // Pode ser:
    //   - objeto { v, cipher, iv }  (novo formato criptografado)
    //   - string                    (formato legado, ignorado por segurança)
    api_key: unknown;
    nome?: string;
  }
  interface IAConfigsCol {
    ativa: string | null;
    configs: IAConfig[];
  }
  const col = (prefs.ia_configs as IAConfigsCol | null) ?? { ativa: null, configs: [] };
  const ativa = col.configs.find(c => c.id === col.ativa);

  if (!ativa || !ativa.provedor || !ehBlob(ativa.api_key)) {
    return erro(
      "Integração com IA não configurada (ou em formato antigo). Vá em Perfil → Integração com IA e cadastre uma chave.",
      400,
    );
  }
  const provedor = ativa.provedor;
  let apiKey: string;
  try {
    apiKey = await decriptar(ativa.api_key);
  } catch (e) {
    logError("Decriptar api_key", e);
    return erro(
      "Falha ao decriptar a chave da API. Recadastre a configuração em Perfil → Integração com IA.",
      500,
    );
  }

  // Injeta contexto da página (texto) antes da pergunta do usuário, separado
  // por delimitador claro pra IA distinguir o que são DADOS e o que é PERGUNTA.
  const mensagemFinal = contexto
    ? `${contexto}\n\n---\nPergunta do usuário:\n${mensagem}`
    : mensagem;

  const mensagens: Array<{ role: "user" | "assistant"; content: string }> = [
    ...historico.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: mensagemFinal },
  ];

  // Screenshot opcional — só passado pros provedores com visão.
  const imagem = parsearImagem(screenshot);
  const PROVEDORES_VISAO = new Set(["claude", "gpt", "gemini"]);
  const imagemSeAplicavel = imagem && PROVEDORES_VISAO.has(provedor) ? imagem : undefined;

  try {
    let resposta = "";
    switch (provedor) {
      case "claude":     resposta = await chamarClaude({     apiKey, persona, mensagens, imagem: imagemSeAplicavel }); break;
      case "gpt":        resposta = await chamarGPT({        apiKey, persona, mensagens, imagem: imagemSeAplicavel }); break;
      case "gemini":     resposta = await chamarGemini({     apiKey, persona, mensagens, imagem: imagemSeAplicavel }); break;
      case "deepseek":   resposta = await chamarDeepSeek({   apiKey, persona, mensagens }); break;
      case "openrouter": resposta = await chamarOpenRouter({ apiKey, persona, mensagens }); break;
      case "mistral":    resposta = await chamarMistral({    apiKey, persona, mensagens }); break;
      case "cohere":     resposta = await chamarCohere({     apiKey, persona, mensagens }); break;
      default:           return erro(`Provedor desconhecido: ${provedor}`, 400);
    }
    if (!resposta) return erro("Resposta vazia da IA", 502);
    return json({ resposta });
  } catch (e) {
    console.error("Erro IA:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return erro(`Falha ao falar com a IA (${provedor}): ${msg.slice(0, 200)}`, 502);
  }
});
