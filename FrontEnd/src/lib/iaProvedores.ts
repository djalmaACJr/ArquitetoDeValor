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
    custo: 'Pago desde o início, mas barato (modelo "mini" custa centavos por hora de conversa).',
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
    custo: 'Tier gratuito + tarifas muito baixas (~10x mais barato que o GPT-4o-mini para conversa).',
    formato: /^sk-[\w-]{32,}$/,
    formatoDica: 'sk-...',
    passos: [
      'Acesse platform.deepseek.com e crie conta (e-mail + senha).',
      'Vá em "API Keys" no menu lateral.',
      'Clique "Create new API key", dê um nome e copie o valor.',
      'A chave começa com "sk-" — DeepSeek usa formato compatível com OpenAI.',
      'Cole no campo abaixo e salve. Resposta em pt-BR fica adequada para esse uso.',
    ],
  },
]

export const PROVEDOR_PADRAO: IAProvedor['id'] = 'claude'

export function provedorPorId(id: string | null | undefined): IAProvedor | null {
  if (!id) return null
  return PROVEDORES.find(p => p.id === id) ?? null
}
