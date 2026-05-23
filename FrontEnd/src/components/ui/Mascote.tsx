// src/components/ui/Mascote.tsx
//
// Componente unificado para exibir os 4 mascotes do app.
//
// Personagens (`nome`):
//   - sabio       Financial Advisor / Conselheiro — sabedoria de longo prazo
//   - arquiteta   Structural Engineer / Arquiteta — estrutura/cálculo
//   - gato        Cat Wizard / Mago Gato — magia dos juros compostos
//   - raposa      Strategic Fox — visão estratégica de mercado
//
// Poses (forma canônica masculina/neutra):
//   - sentado              calmo, pensativo (default ideal para dicas)
//   - curioso              descoberta, exploração (empty states)
//   - andando              transição, ação, jornada
//   - feliz                resultado positivo, conquista
//   - triste               resultado negativo / "trocando"
//   - espantado            surpresa, alerta, "novo"
//   - hero                 pose principal (cena cinematográfica, opcional)
//   - apontando-esquerda          tutorial — apontando lateral pra esquerda
//   - apontando-direita           tutorial — apontando lateral pra direita
//   - apontando-esquerda-acima    tutorial — apontando pra cima-esquerda
//   - apontando-direita-acima     tutorial — apontando pra cima-direita
//   - comprimento-inicio          tutorial — pose de boas-vindas / despedida
//
// Os arquivos físicos podem usar variação feminina em algumas poses
// (arquiteta-sentada, raposa-sentada, raposa-espantada). A função
// `arquivoPara` cuida disso — o consumidor sempre passa a forma canônica.

import { useState } from 'react'

export type MascoteNome  = 'sabio' | 'arquiteta' | 'gato' | 'raposa'
export type MascotePose  =
  | 'sentado' | 'curioso' | 'andando'
  | 'feliz'   | 'triste'  | 'espantado'
  | 'hero'
  | 'apontando-esquerda' | 'apontando-direita'
  | 'apontando-esquerda-acima' | 'apontando-direita-acima'
  | 'comprimento-inicio'

const LABEL: Record<MascoteNome, string> = {
  sabio:     'Conselheiro',
  arquiteta: 'Arquiteta',
  gato:      'Mago Gato',
  raposa:    'Raposa',
}

/**
 * Resolve qual arquivo carregar para (nome, pose). Em alguns casos o
 * arquivo usa variação feminina ("sentada"/"espantada"); a forma canônica
 * exposta na API é sempre a masculina/neutra para simplificar o
 * vocabulário dos consumidores.
 */
function arquivoPara(nome: MascoteNome, pose: MascotePose): string {
  if (pose === 'sentado' && (nome === 'arquiteta' || nome === 'raposa')) return `${nome}-sentada`
  if (pose === 'espantado' && nome === 'raposa') return `${nome}-espantada`
  return `${nome}-${pose}`
}

// eslint-disable-next-line react-refresh/only-export-components
export function srcMascote(nome: MascoteNome, pose: MascotePose): string {
  return `/mascotes/${arquivoPara(nome, pose)}.png`
}

export default function Mascote({
  nome,
  pose,
  size = 96,
  className = '',
  alt,
}: {
  nome:   MascoteNome
  pose:   MascotePose
  /** Largura em pixels — a altura ajusta automaticamente. */
  size?:  number
  className?: string
  alt?:   string
}) {
  const [erro, setErro] = useState(false)
  if (erro) return null

  return (
    <img
      src={srcMascote(nome, pose)}
      alt={alt ?? `${LABEL[nome]} (${pose})`}
      loading="lazy"
      onError={() => setErro(true)}
      className={`select-none pointer-events-none object-contain ${className}`}
      style={{ width: size, height: 'auto' }}
    />
  )
}
