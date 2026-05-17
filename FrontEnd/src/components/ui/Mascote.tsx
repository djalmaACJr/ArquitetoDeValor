// src/components/ui/Mascote.tsx
//
// Componente unificado para exibir os mascotes do app. Aceita um `nome` (a
// personagem) e uma `pose` (a expressão/cena). Procura por um PNG
// individual em `/mascotes/<nome>-<pose>.png` e, se não encontrar,
// gracefulmente esconde o elemento — assim a UI não quebra enquanto as
// imagens individuais ainda não foram exportadas.
//
// Personagens (`nome`):
//   - sabio       Financial Advisor — sabedoria de longo prazo
//   - engenheira  Structural Engineer — estrutura/cálculo
//   - mago        Cat Wizard — magia dos juros compostos
//   - raposa      Strategic Fox — visão estratégica de mercado
//
// Poses (vocabulário alinhado com os arquivos exportados):
//   - sentado     calmo, pensativo (default ideal para dicas)
//   - curioso     descoberta, exploração (empty states)
//   - pensando    reflexão, cálculo em andamento
//   - andando     transição, ação, jornada
//   - feliz       resultado positivo, conquista
//   - espantado   surpresa, alerta, "novo"
//   - hero        pose principal (cena cinematográfica, opcional)
//
// Arquivos esperados: `public/mascotes/<nome>-<pose>.png` (PNG-32 com
// transparência). Sem o arquivo, o componente renderiza nada (no-op).

import { useState } from 'react'

export type MascoteNome  = 'sabio' | 'engenheira' | 'mago' | 'raposa'
export type MascotePose  =
  | 'sentado' | 'curioso' | 'pensando' | 'andando' | 'feliz' | 'espantado' | 'hero'

const LABEL: Record<MascoteNome, string> = {
  sabio:      'Sábio',
  engenheira: 'Engenheira',
  mago:       'Mago Gato',
  raposa:     'Raposa',
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
  /** Tamanho em pixels (lado maior). Default 96. */
  size?:  number
  className?: string
  alt?:   string
}) {
  const [erro, setErro] = useState(false)
  if (erro) return null

  const src = `/mascotes/${nome}-${pose}.png`
  return (
    <img
      src={src}
      alt={alt ?? `${LABEL[nome]} (${pose})`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setErro(true)}
      className={`object-contain select-none pointer-events-none ${className}`}
      style={{ maxWidth: size, maxHeight: size }}
    />
  )
}
