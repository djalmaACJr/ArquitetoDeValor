import { useState } from 'react'
import { Coins, X } from 'lucide-react'
import { useNovidadesProventos, type NovidadeProventoItem } from '../../hooks/useNovidadesProventos'
import { formatBRL, formatData } from '../../lib/utils'
import { Drawer } from './shared'

// Novos antes de atualizados; dentro de cada grupo, por ticker.
function ordenarItens(itens: NovidadeProventoItem[]): NovidadeProventoItem[] {
  return [...itens].sort((a, b) =>
    a.acao !== b.acao
      ? (a.acao === 'criado' ? -1 : 1)
      : a.ticker.localeCompare(b.ticker))
}

const MUTED = '#8b92a8'

// Card de notificação exibido no login quando o job de proventos BRL criou
// ou atualizou lançamentos. Montado uma vez em AppLayout. Some ao descartar.
// "Ver proventos" abre um Drawer só com os itens desta notificação (não a
// tela geral de Proventos, que mistura todo o histórico do usuário).
export default function NovidadesProventos() {
  const { novidades, descartar } = useNovidadesProventos()
  const [aberto, setAberto] = useState(false)
  if (!novidades) return null

  const { criados, atualizados, itens: itensBrutos } = novidades
  const itens = ordenarItens(itensBrutos)
  const partes: string[] = []
  if (criados > 0)     partes.push(`${criados} novo${criados > 1 ? 's' : ''}`)
  if (atualizados > 0) partes.push(`${atualizados} atualizado${atualizados > 1 ? 's' : ''}`)
  const resumo = partes.join(' e ')

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl"
        style={{ borderColor: 'rgba(59,130,246,0.4)', background: '#0f1729' }}>
        <div className="flex items-start gap-3 p-4">
          <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.15)' }}>
            <Coins size={16} style={{ color: '#3b82f6' }} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-white">Proventos provisionados</p>
            <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
              A busca automática registrou {resumo} provento{(criados + atualizados) > 1 ? 's' : ''} para você.
            </p>
          </div>
          <button onClick={descartar} aria-label="Fechar"
            className="shrink-0 p-1 rounded-md hover:bg-white/10" style={{ color: MUTED }}>
            <X size={16} />
          </button>
        </div>

        {itens.length > 0 && (
          <ul className="px-4 pb-2 space-y-1 max-h-44 overflow-auto">
            {itens.slice(0, 6).map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="text-white truncate">
                  {it.ticker} <span style={{ color: MUTED }}>· {formatData(it.data_pagamento)}</span>
                </span>
                <span className="shrink-0 font-medium" style={{ color: it.acao === 'criado' ? '#4ade80' : '#ffb74d' }}>
                  {formatBRL(it.valor)}
                </span>
              </li>
            ))}
            {itens.length > 6 && (
              <li className="text-[11px] pt-0.5" style={{ color: MUTED }}>+{itens.length - 6} outro(s)…</li>
            )}
          </ul>
        )}

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
          <button onClick={descartar} className="px-3 py-1.5 rounded-lg text-[13px] hover:bg-white/10" style={{ color: MUTED }}>
            Dispensar
          </button>
          <button onClick={() => setAberto(true)}
            className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white" style={{ background: '#3b82f6' }}>
            Ver proventos
          </button>
        </div>
      </div>

      <Drawer open={aberto} onClose={() => setAberto(false)} titulo="Proventos desta notificação"
        subtitulo={`${resumo} provento${(criados + atualizados) > 1 ? 's' : ''}`}
        rodape={
          <button onClick={() => { setAberto(false); descartar() }}
            className="w-full px-3 py-2 rounded-lg text-[13px] font-medium text-white" style={{ background: '#3b82f6' }}>
            Marcar como visto
          </button>
        }>
        <ul className="space-y-2">
          {itens.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-white truncate">{it.ticker}</p>
                <p className="text-[12px]" style={{ color: MUTED }}>{it.tipo} · {formatData(it.data_pagamento)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[13px] font-semibold text-white">{formatBRL(it.valor)}</p>
                <p className="text-[11px]" style={{ color: it.acao === 'criado' ? '#4ade80' : '#ffb74d' }}>
                  {it.acao === 'criado' ? 'novo' : 'atualizado'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Drawer>
    </>
  )
}
