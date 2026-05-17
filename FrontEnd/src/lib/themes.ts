// src/lib/themes.ts
//
// Registro central de temas. Para adicionar um novo tema:
//   1. Defina um bloco CSS em `src/styles/globals.css` setando os tokens
//      (procure pela seção "TEMA:" — os exemplos atuais são modelo).
//   2. Adicione uma entrada aqui com:
//        - `id`     único (usado no localStorage e no atributo data-theme)
//        - `label`  exibido pro usuário
//        - `escuro` true se for um tema "escuro" do ponto de vista do
//                   Tailwind (vai aplicar a classe .dark no html, ativando
//                   modificadores como `dark:bg-...`)
//
// O `useTheme` lê este registro pra montar o picker e validar a escolha
// salva — temas removidos no futuro caem no padrão automaticamente.

export interface Tema {
  id:     string
  label:  string
  escuro: boolean
}

export const TEMAS: Tema[] = [
  { id: 'escuro',   label: 'Escuro (padrão)', escuro: true  },
  { id: 'claro',    label: 'Claro',           escuro: false },
  { id: 'midnight', label: 'Midnight',        escuro: true  },
  { id: 'sepia',    label: 'Sépia',           escuro: false },
]

export const TEMA_PADRAO: Tema['id'] = 'escuro'

export function temaPorId(id: string | null | undefined): Tema {
  return TEMAS.find(t => t.id === id) ?? TEMAS.find(t => t.id === TEMA_PADRAO)!
}
