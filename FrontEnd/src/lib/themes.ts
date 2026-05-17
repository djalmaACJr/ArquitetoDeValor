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
    label: 'Sábio',
    descricao: 'Couro envelhecido e ouro — sabedoria e visão de longo prazo.',
    mascote: 'sabio',
    cores: {
      dia:   { bg: '#fffaee', accent: '#8b4513', text: '#3a2715' },
      noite: { bg: '#2d1b0d', accent: '#e3a83a', text: '#fff4dd' },
    },
  },
  {
    id: 'engenheira',
    label: 'Engenheira',
    descricao: 'Blueprint azul vivo — precisão e cálculo estrutural.',
    mascote: 'engenheira',
    cores: {
      dia:   { bg: '#ffffff', accent: '#1976d2', text: '#0d2a4a' },
      noite: { bg: '#0e2a4a', accent: '#4dc3ff', text: '#e0eeff' },
    },
  },
  {
    id: 'mago',
    label: 'Mago Gato',
    descricao: 'Roxo profundo com brilho esmeralda — a magia dos juros compostos.',
    mascote: 'mago',
    cores: {
      dia:   { bg: '#ffffff', accent: '#6b21a8', text: '#1a0526' },
      noite: { bg: '#1f0e3e', accent: '#b48cff', text: '#f4eafa' },
    },
  },
  {
    id: 'raposa',
    label: 'Raposa',
    descricao: 'Terracota e laranja vivo — astúcia estratégica de mercado.',
    mascote: 'raposa',
    cores: {
      dia:   { bg: '#ffffff', accent: '#c14318', text: '#3a1409' },
      noite: { bg: '#2d130b', accent: '#ff7a3a', text: '#ffe8d5' },
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
