import { useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'

// Mesmo verde usado nos destaques/gráficos de investimentos (av-green).
const VERDE = '#00c896'
const MUTED = '#8b92a8'

// ── Reordenação de quadros por arrastar-e-soltar (nativa, sem lib) ──────
// Arrasta pela alça (ícone de grip), solta em cima de outro quadro pra
// trocar de posição. `chavesAtuais` reconcilia sozinho: uma chave nova (ex.:
// tipo de ativo que passou a existir) entra no fim; uma que sumiu (ex.:
// filtro aplicado) só some da vista, sem perder a posição salva pra quando
// voltar. Usado em InvestimentosPage (quadros por tipo de ativo) e
// DestaquesInvestimentosPage (quadros gerais + por tipo).
//
// localStorage é sempre o cache SÍNCRONO (sem flash antes do banco
// responder — mesmo padrão de useOcultarValores). Se `valorRemoto` for
// passado (de arqvalor.usuarios.ordem_quadros via usePreferenciasOrdemQuadros),
// ele é adotado quando chega — MAS só se o usuário ainda não arrastou nada
// nesta sessão (`tocadoLocal`), senão um fetch tardio "borracharia" um
// arraste que acabou de acontecer. Toda reordenação de verdade dispara
// `aoMudar`, pro chamador persistir no banco.
// eslint-disable-next-line react-refresh/only-export-components -- hook + AlcaArrastar (componente pequeno e acoplado) no mesmo arquivo, mesma convenção de Mascote.tsx
export function useOrdemReordenavel<T extends string>(
  lsKey: string, chavesAtuais: T[],
  opts?: { valorRemoto?: T[] | null; aoMudar?: (ordem: T[]) => void },
) {
  const [ordem, setOrdem] = useState<T[]>(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(lsKey) ?? 'null') as T[] | null
      if (Array.isArray(salvo)) return salvo
    } catch { /* localStorage indisponível/corrompido — usa o padrão */ }
    return chavesAtuais
  })
  const tocadoLocal = useRef(false)

  useEffect(() => {
    if (!opts?.valorRemoto || tocadoLocal.current) return
    setOrdem(opts.valorRemoto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.valorRemoto])

  // Ordem COMPLETA: acrescenta no fim as chaves que passaram a existir agora,
  // mas NUNCA remove uma chave só porque ela não está em `chavesAtuais` neste
  // render — só `ordemView` (abaixo) filtra o que é de fato exibido. Persistir
  // esta versão (não a filtrada) é o que garante que uma chave temporariamente
  // fora de vista (ex.: filtro de período sem dados numa categoria) volte pra
  // MESMA posição salva, em vez de reaparecer sempre no fim — bug real (ago/2026):
  // o código antigo sincronizava `ordem` com a versão já filtrada, perdendo a
  // posição de quem saía de vista mesmo que só temporariamente.
  const chavesKey = chavesAtuais.join('|')
  const ordemCompleta = useMemo(() => {
    const novas = chavesAtuais.filter((k) => !ordem.includes(k))
    return novas.length > 0 ? [...ordem, ...novas] : ordem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordem, chavesKey])

  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify(ordemCompleta)) } catch { /* quota/privado — ignora */ }
    if (ordemCompleta.length !== ordem.length) setOrdem(ordemCompleta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordemCompleta])

  // View: só as chaves visíveis agora, na ordem completa salva.
  const ordemView = useMemo(
    () => ordemCompleta.filter((k) => chavesAtuais.includes(k)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordemCompleta, chavesKey],
  )

  // Estado (não ref) de propósito: precisa re-renderizar pra desenhar o
  // contorno de "isto está sendo arrastado" / "solte aqui".
  const [arrastando, setArrastando] = useState<T | null>(null)
  const [sobre, setSobre] = useState<T | null>(null)

  const dragHandleProps = (chave: T) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setArrastando(chave)
      // O preview padrão do navegador (a cópia semitransparente que segue o
      // cursor durante o arrasto) não tem contorno nenhum por padrão — só o
      // card original, parado no lugar, mudava de estilo. Aplica um contorno
      // no elemento ANTES do navegador tirar o "retrato" que vai seguir o
      // mouse (setDragImage) e desfaz logo em seguida — só o retrato importa,
      // o card real continua controlado pelas classes de `dropTargetClass`.
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-quadro-arrastavel]')
      if (card) {
        const outlineOriginal = card.style.outline
        const offsetOriginal  = card.style.outlineOffset
        card.style.outline = `2px solid ${VERDE}`
        card.style.outlineOffset = '-2px'
        e.dataTransfer.setDragImage(card, 20, 20)
        requestAnimationFrame(() => {
          card.style.outline = outlineOriginal
          card.style.outlineOffset = offsetOriginal
        })
      }
    },
    onDragEnd: () => { setArrastando(null); setSobre(null) },
  })
  const dropTargetProps = (chave: T) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      if (arrastando && arrastando !== chave) setSobre(chave)
    },
    onDragLeave: () => setSobre((s) => (s === chave ? null : s)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const origemChave = arrastando
      setArrastando(null)
      setSobre(null)
      if (!origemChave || origemChave === chave) return
      tocadoLocal.current = true
      // Reordena dentro da ordem COMPLETA (não só a visível) — preserva a
      // posição de chaves fora de vista no meio do arrasto.
      const semOrigem = ordemCompleta.filter((k) => k !== origemChave)
      const idx = semOrigem.indexOf(chave)
      if (idx === -1) return
      semOrigem.splice(idx, 0, origemChave)
      setOrdem(semOrigem)
      opts?.aoMudar?.(semOrigem)
    },
  })
  // Classe de BORDA pro card inteiro: tracejado + esmaecido em quem está
  // sendo arrastado, anel GROSSO com brilho em quem está por baixo do mouse
  // (o "solte aqui") — precisa ser bem chamativo pra dar a impressão real de
  // movimento, não só um detalhezinho de cor. Largura de borda CONSTANTE
  // (3px) nos três estados — só a cor/estilo muda — pra não dar um "pulo" de
  // 1px no conteúdo quando troca de estado. Usar quando o card NÃO tem
  // borda própria (ex.: os quadros de destaques).
  const dropTargetClass = (chave: T) =>
    arrastando === chave
      ? 'opacity-40 border-[3px] border-dashed border-white/70 scale-[0.98]'
      : sobre === chave
        ? 'border-[3px] border-av-green shadow-[0_0_0_4px_rgba(0,200,150,0.25),0_0_24px_rgba(0,200,150,0.45)]'
        : 'border-[3px] border-white/10'
  // Classe de OUTLINE (não ocupa espaço, não compete com uma borda própria
  // do card) — mesma lógica, mas pra usar em cima de componentes que já têm
  // sua própria borda/realce interno (ex.: QuadroTipoAtivos).
  const dropTargetOutlineClass = (chave: T) =>
    arrastando === chave
      ? 'opacity-40 outline outline-[3px] outline-dashed outline-white/70 scale-[0.98]'
      : sobre === chave
        ? 'outline outline-[3px] outline-av-green shadow-[0_0_0_4px_rgba(0,200,150,0.25),0_0_24px_rgba(0,200,150,0.45)]'
        : ''

  return { ordem: ordemView, dragHandleProps, dropTargetProps, dropTargetClass, dropTargetOutlineClass }
}

// Alça de arrastar — único elemento com `draggable`, pra não capturar
// cliques/seleção de texto do resto do card.
export function AlcaArrastar(props: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} title="Arraste pra reordenar" className="cursor-grab active:cursor-grabbing shrink-0" style={{ color: MUTED }}>
      <GripVertical size={14} />
    </span>
  )
}
