// src/lib/themes.ts
//
// Registro central de famílias de layout. Cada família tem dois modos:
//   - "noite"  → versão escura  (html.dark)
//   - "dia"    → versão clara   (html sem .dark)
//
// O picker em Perfil escolhe a FAMÍLIA. O botão sol/lua na sidebar alterna
// o MODO dentro da família ativa.
//
// O id efetivo armazenado em localStorage e em `arqvalor.usuarios.layout`
// é composto: `<familia>-<modo>` (ex.: "sabio-noite", "classico-dia").
//
// Para adicionar uma NOVA família:
//   1. Defina dois blocos CSS em `src/styles/globals.css`:
//        html.dark[data-theme="<id>"]            (modo noite)
//        html:not(.dark)[data-theme="<id>"]      (modo dia)
//   2. Registre aqui no array FAMILIAS com cores de preview para os dois modos.

import type { MascoteNome } from '../components/ui/Mascote'

export type Modo = 'dia' | 'noite'

export interface CorPreview {
  bg:     string  // fundo do card
  accent: string  // cor de sotaque (borda, destaque)
  text:   string  // texto exemplo
}

export interface Familia {
  id:         string
  label:      string
  descricao:  string
  mascote?:   MascoteNome
  cores: {
    dia:   CorPreview
    noite: CorPreview
  }
}

export const FAMILIAS: Familia[] = [
  {
    id: 'classico',
    label: 'Clássico',
    descricao: 'Identidade original do app — azul-grafite com verde-água.',
    cores: {
      dia:   { bg: '#ffffff', accent: '#00c896', text: '#111827' },
      noite: { bg: '#1a1f2e', accent: '#00c896', text: '#e8eaf0' },
    },
  },
  {
    id: 'sabio',
    label: 'Conselheiro',
    descricao: 'Marrom claro e caramelo — sabedoria e visão de longo prazo.',
    mascote: 'sabio',
    cores: {
      dia:   { bg: '#fdf6e8', accent: '#aa7846', text: '#5a3e22' },
      noite: { bg: '#4d3a26', accent: '#d4a86e', text: '#f7eada' },
    },
  },
  {
    id: 'arquiteta',
    label: 'Arquiteta',
    descricao: 'Rosa-bebê pastel — leveza com precisão e cálculo.',
    mascote: 'arquiteta',
    cores: {
      dia:   { bg: '#ffffff', accent: '#e878a8', text: '#5a1f3a' },
      noite: { bg: '#3d2235', accent: '#f8a8c8', text: '#ffe0ee' },
    },
  },
  {
    id: 'gato',
    label: 'Mago Gato',
    descricao: 'Roxo profundo com brilho esmeralda — a magia dos juros compostos.',
    mascote: 'gato',
    cores: {
      dia:   { bg: '#ffffff', accent: '#6b21a8', text: '#1a0526' },
      noite: { bg: '#1f0e3e', accent: '#b48cff', text: '#f4eafa' },
    },
  },
  {
    id: 'raposa',
    label: 'Raposa',
    descricao: 'Money green — astúcia estratégica de mercado.',
    mascote: 'raposa',
    cores: {
      dia:   { bg: '#ffffff', accent: '#28823c', text: '#0d2818' },
      noite: { bg: '#0f2b18', accent: '#50c86e', text: '#dcf5dc' },
    },
  },
]

export const FAMILIA_PADRAO: Familia['id'] = 'classico'
export const MODO_PADRAO:    Modo          = 'noite'

export function familiaPorId(id: string | null | undefined): Familia {
  return FAMILIAS.find(f => f.id === id) ?? FAMILIAS.find(f => f.id === FAMILIA_PADRAO)!
}

/** Compõe o id armazenado (`<familia>-<modo>`). */
export function gerarLayoutId(familia: Familia['id'], modo: Modo): string {
  return `${familia}-${modo}`
}

/** Quebra um id composto. Aliases legados (dark/light/classico/escuro/etc)
 *  são convertidos para o par família + modo equivalente. */
export function parseLayoutId(raw: string | null | undefined): { familia: Familia['id']; modo: Modo } {
  if (!raw) return { familia: FAMILIA_PADRAO, modo: MODO_PADRAO }
  // Aliases de versões anteriores
  if (raw === 'dark' || raw === 'escuro')   return { familia: 'classico', modo: 'noite' }
  if (raw === 'light' || raw === 'claro')   return { familia: 'classico', modo: 'dia' }
  if (raw === 'classico')                   return { familia: 'classico', modo: 'noite' }
  if (raw === 'midnight')                   return { familia: 'classico', modo: 'noite' }
  if (raw === 'sepia')                      return { familia: 'classico', modo: 'dia' }
  // Aliases dos nomes antigos dos mascotes
  if (raw === 'engenheira')                 return { familia: 'arquiteta', modo: 'noite' }
  if (raw === 'engenheira-noite')           return { familia: 'arquiteta', modo: 'noite' }
  if (raw === 'engenheira-dia')             return { familia: 'arquiteta', modo: 'dia' }
  if (raw === 'mago')                       return { familia: 'gato', modo: 'noite' }
  if (raw === 'mago-noite')                 return { familia: 'gato', modo: 'noite' }
  if (raw === 'mago-dia')                   return { familia: 'gato', modo: 'dia' }
  // Formato composto família-modo
  const partes = raw.split('-')
  if (partes.length === 2) {
    const f = familiaPorId(partes[0])
    const m: Modo = partes[1] === 'dia' ? 'dia' : 'noite'
    return { familia: f.id, modo: m }
  }
  // ID nu (família sem modo) — assume noite
  const f = familiaPorId(raw)
  return { familia: f.id, modo: MODO_PADRAO }
}
