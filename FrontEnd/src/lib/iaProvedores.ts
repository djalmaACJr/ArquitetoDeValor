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

export interface IAProvedor {
  id:          string
  label:       string
  url:         string
  custo:       string
  /** true = tem tier 100% grátis e usável (sem cartão). false = exige pagamento ou só crédito de trial. */
  gratuito:    boolean
  /** Identificador do modelo usado na edge function `chat_mascote`. Mantenha em sincronia. */
  modelo:      string
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
    custo: 'Acesso unificado a vários modelos. Inclui modelos marcados ":free" (Llama, DeepSeek-R1, etc.) sem cartão.',
    gratuito: true,
    modelo:  'meta-llama/llama-3.3-70b-instruct:free',
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
