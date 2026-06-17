// src/lib/iaProvedores.ts
//
// Registro central dos provedores de IA suportados pelo chat do mascote.
// Cada entrada inclui:
//   - id estável (salvo em `arqvalor.usuarios.ia_provedor`)
//   - label exibido pro usuário
//   - URL pra obter a chave da API
//   - instruções passo-a-passo (rendered em <ol>)
//   - dica sobre tier gratuito / custo
//   - hint do formato da chave (pra detectar erro óbvio)
//
// A edge function `chat_mascote` mantém um mapeamento espelhado deste
// arquivo — se você adicionar um provedor aqui, adicione também lá.

/** Um modelo selecionável dentro de um provedor. */
export interface ModeloIA {
  /** Identificador enviado à API do provedor. */
  id:        string
  /** Rótulo amigável exibido no select. */
  label:     string
  /** Dica curta (custo / velocidade / contexto). */
  nota?:     string
  /** true = recomendado para uso em finanças (melhor raciocínio/qualidade). */
  financas?: boolean
  /** true = utilizável no tier gratuito do provedor. */
  gratuito?: boolean
}

export interface IAProvedor {
  id:          string
  label:       string
  url:         string
  custo:       string
  /** true = tem tier 100% grátis e usável (sem cartão). false = exige pagamento ou só crédito de trial. */
  gratuito:    boolean
  /** Modelo PADRÃO usado quando o usuário não escolhe um (mantém compat. com a edge function). */
  modelo:      string
  /** Modelos selecionáveis pelo usuário (o 1º recomendado vira sugestão). Mantenha em sincronia com a edge function. */
  modelos:     ModeloIA[]
  /** true = o usuário pode digitar um ID de modelo livre (catálogo grande/volátil, ex.: OpenRouter). */
  permiteCustom?: boolean
  /** true = aceita imagens (multimodal). Liberado: claude-haiku-4-5, gpt-4o-mini, gemini-2.5-flash. */
  visao:       boolean
  formato:     RegExp   // valida formato da chave (best effort)
  formatoDica: string   // ajuda visual sobre o formato esperado
  passos:      string[]
}

export const PROVEDORES: IAProvedor[] = [
  {
    id:    'claude',
    label: 'Anthropic Claude',
    url:   'https://console.anthropic.com/settings/keys',
    custo: 'US$5 de crédito grátis no cadastro · depois pague por uso (modelo Haiku é o mais barato).',
    gratuito: false,
    modelo:  'claude-haiku-4-5',
    modelos: [
      { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  nota: 'Rápido e barato — bom para o dia a dia', gratuito: false },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', nota: 'Raciocínio mais forte — melhor para análise financeira', financas: true },
    ],
    visao:   true,
    formato: /^sk-ant-[\w-]{40,}$/,
    formatoDica: 'sk-ant-...',
    passos: [
      'Acesse console.anthropic.com e crie conta (e-mail + cartão de crédito).',
      'Vá em "Settings" → "API Keys".',
      'Clique "Create Key", dê um nome (ex.: "ArquitetoDeValor") e copie o valor.',
      'A chave começa com "sk-ant-" e é mostrada UMA vez — guarde com cuidado.',
      'Cole no campo abaixo e salve. O Claude responde em português excelente.',
    ],
  },
  {
    id:    'gpt',
    label: 'OpenAI GPT',
    url:   'https://platform.openai.com/api-keys',
    custo: 'Pago desde o início — exige cartão e crédito mínimo de US$5. Sem tier gratuito.',
    gratuito: false,
    modelo:  'gpt-4o-mini',
    modelos: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', nota: 'Mais barato — bom custo-benefício', gratuito: false },
      { id: 'gpt-4o',      label: 'GPT-4o',      nota: 'Mais capaz — melhor para análise financeira', financas: true },
    ],
    visao:   true,
    formato: /^sk-(proj-)?[\w-]{20,}$/,
    formatoDica: 'sk-... ou sk-proj-...',
    passos: [
      'Acesse platform.openai.com e crie conta.',
      'Adicione um método de pagamento em "Settings" → "Billing" (mínimo US$5).',
      'Vá em "API keys" no menu lateral.',
      'Clique "Create new secret key", dê um nome e copie o valor.',
      'A chave começa com "sk-" e é mostrada UMA vez — guarde com cuidado.',
      'Cole no campo abaixo e salve.',
    ],
  },
  {
    id:    'gemini',
    label: 'Google Gemini',
    url:   'https://aistudio.google.com/app/apikey',
    custo: 'Tier gratuito generoso (15 requests/min · 1500/dia). Ideal pra começar sem cartão.',
    gratuito: true,
    modelo:  'gemini-2.5-flash',
    modelos: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', nota: 'Rápido e com tier gratuito generoso', gratuito: true },
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   nota: 'Raciocínio mais forte — melhor para finanças (pode exigir billing)', financas: true },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', nota: 'Alternativa estável caso o 2.5 falhe', gratuito: true },
    ],
    visao:   true,
    formato: /^AIza[\w-]{30,}$/,
    formatoDica: 'AIza...',
    passos: [
      'Acesse aistudio.google.com com sua conta Google.',
      'Aceite os termos de uso (não exige cartão de crédito).',
      'Clique em "Get API key" → "Create API key in new project".',
      'Copie a chave gerada (começa com "AIza").',
      'Cole no campo abaixo e salve. Free tier resolve uso pessoal.',
    ],
  },
  {
    id:    'deepseek',
    label: 'DeepSeek',
    url:   'https://platform.deepseek.com/api_keys',
    custo: 'Tarifas muito baixas (~10x mais barato que o GPT-4o-mini), mas exige saldo: adicione US$2 pré-pago para começar.',
    gratuito: false,
    modelo:  'deepseek-chat',
    modelos: [
      { id: 'deepseek-chat',     label: 'DeepSeek Chat (V3)', nota: 'Barato e rápido — uso geral', gratuito: false },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)', nota: 'Raciocínio passo a passo — melhor para análise financeira', financas: true },
    ],
    visao:   false,
    formato: /^sk-[\w-]{32,}$/,
    formatoDica: 'sk-...',
    passos: [
      'Acesse platform.deepseek.com e crie conta (e-mail + senha).',
      'Vá em "Top Up" / "Recharge" no menu e adicione saldo (mínimo US$2). DeepSeek descontinuou o tier gratuito.',
      'Vá em "API Keys" no menu lateral.',
      'Clique "Create new API key", dê um nome e copie o valor.',
      'A chave começa com "sk-" — DeepSeek usa formato compatível com OpenAI.',
      'Cole no campo abaixo e salve. Resposta em pt-BR fica adequada para esse uso.',
    ],
  },
  {
    id:    'openrouter',
    label: 'OpenRouter',
    url:   'https://openrouter.ai/keys',
    custo: 'Acesso unificado a modelos que você NÃO tem direto aqui (Meta Llama, Qwen, Grok…). Inclui opções ":free" sem cartão.',
    gratuito: true,
    modelo:  'meta-llama/llama-3.3-70b-instruct:free',
    permiteCustom: true,
    // OpenRouter só faz sentido para modelos que NÃO existem como provedor
    // direto no app (Claude, GPT, Gemini, DeepSeek, Mistral, Cohere já são
    // diretos). Por isso a lista abaixo foca em Meta Llama, Qwen, Gemma
    // (open-weights), Grok e Hermes. Os ":free" rodam sem cartão, mas têm
    // rate-limit compartilhado — bons para testar, instáveis para depender.
    modelos: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (grátis)', nota: 'Meta · grátis, mas o free tier pode ficar lento/limitado', gratuito: true },
      { id: 'qwen/qwen-2.5-72b-instruct:free',        label: 'Qwen 2.5 72B (grátis)',  nota: 'Alibaba · forte em raciocínio e multilíngue · grátis', gratuito: true, financas: true },
      { id: 'google/gemma-2-9b-it:free',              label: 'Gemma 2 9B (grátis)',    nota: 'Google open-weights · leve e grátis', gratuito: true },
      { id: 'meta-llama/llama-3.3-70b-instruct',      label: 'Llama 3.3 70B',          nota: 'Meta · versão paga, sem o rate-limit do free' },
      { id: 'qwen/qwen-2.5-72b-instruct',             label: 'Qwen 2.5 72B',           nota: 'Alibaba · versão paga e estável' },
      { id: 'x-ai/grok-2-1212',                       label: 'Grok 2',                 nota: 'xAI · indisponível direto no app (pago)' },
      { id: 'nousresearch/hermes-3-llama-3.1-70b',    label: 'Hermes 3 70B',           nota: 'Nous · Llama afinado p/ diálogo (pago)' },
    ],
    visao:   false,
    formato: /^sk-or-[\w-]{20,}$/,
    formatoDica: 'sk-or-...',
    passos: [
      'Acesse openrouter.ai e crie conta (e-mail + Google).',
      'Vá em "Keys" no menu superior.',
      'Clique "Create Key", dê um nome (ex.: "ArquitetoDeValor") e copie.',
      'A chave começa com "sk-or-" — formato similar ao do GPT.',
      'Para usar os modelos grátis, NÃO precisa adicionar cartão. Os modelos pagos exigem.',
      'Cole no campo abaixo e salve. Usaremos Llama 3.3 70B (free) por padrão.',
    ],
  },
  {
    id:    'mistral',
    label: 'Mistral',
    url:   'https://console.mistral.ai/api-keys',
    custo: 'Modelos franceses de qualidade. Tier "experimental" grátis (1 req/seg) — sem cartão para começar.',
    gratuito: true,
    modelo:  'mistral-small-latest',
    modelos: [
      { id: 'mistral-small-latest', label: 'Mistral Small', nota: 'Tier experimental gratuito', gratuito: true },
      { id: 'mistral-large-latest', label: 'Mistral Large', nota: 'Mais capaz — melhor para análise financeira', financas: true },
    ],
    visao:   false,
    formato: /^[A-Za-z0-9]{20,}$/,
    formatoDica: 'string alfanumérica de 32+ chars',
    passos: [
      'Acesse console.mistral.ai e crie conta (e-mail + senha).',
      'Confirme o e-mail e termine o cadastro.',
      'Vá em "API Keys" no menu lateral.',
      'Clique "Create new key", dê um nome e copie o valor.',
      'A chave é uma string alfanumérica (sem prefixo). Mostrada UMA vez.',
      'Cole no campo abaixo e salve. Tier experimental grátis tem 1 req/seg.',
    ],
  },
  {
    id:    'cohere',
    label: 'Cohere',
    url:   'https://dashboard.cohere.com/api-keys',
    custo: 'Trial key grátis com 1000 calls/mês. Sem cartão. Bom pra uso ocasional.',
    gratuito: true,
    modelo:  'command-r-08-2024',
    modelos: [
      { id: 'command-r-08-2024',      label: 'Command R',      nota: 'Trial gratuito (1000 calls/mês)', gratuito: true },
      { id: 'command-r-plus-08-2024', label: 'Command R+',     nota: 'Mais capaz — melhor para finanças', financas: true },
    ],
    visao:   false,
    formato: /^[\w-]{20,}$/,
    formatoDica: 'string alfanumérica',
    passos: [
      'Acesse dashboard.cohere.com e crie conta (e-mail ou Google).',
      'Confirme o e-mail.',
      'Vá em "API Keys" no menu lateral.',
      'Use o "Trial Key" já gerado OU crie uma nova clicando em "+ New Trial key".',
      'Copie o valor (string alfanumérica).',
      'Cole no campo abaixo e salve. Limite: 1000 calls/mês na trial key.',
    ],
  },
]

export const PROVEDOR_PADRAO: IAProvedor['id'] = 'claude'

export function provedorPorId(id: string | null | undefined): IAProvedor | null {
  if (!id) return null
  return PROVEDORES.find(p => p.id === id) ?? null
}

/** Modelo padrão sugerido ao escolher um provedor: o 1º recomendado p/ finanças, senão o `modelo` base. */
export function modeloSugerido(p: IAProvedor): string {
  return p.modelos.find(m => m.financas)?.id ?? p.modelo
}

/** Rótulo amigável de um modelo dentro do provedor (cai no próprio id se for custom). */
export function rotuloModelo(p: IAProvedor | null, modeloId: string | null | undefined): string {
  if (!modeloId) return p?.modelo ?? ''
  return p?.modelos.find(m => m.id === modeloId)?.label ?? modeloId
}
