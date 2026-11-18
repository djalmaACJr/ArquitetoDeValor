import { Link } from 'react-router-dom'
import { ExternalLink, Trash2, Check, AlertTriangle, ThumbsUp, ShieldAlert } from 'lucide-react'
import { formatData } from '../../lib/utils'
import type { AnaliseRelatorioFii, VereditoRelatorio } from '../../types'

const MUTED = '#8b92a8'

const VEREDITO: Record<VereditoRelatorio, { label: string; cor: string }> = {
  POSITIVO: { label: 'Positivo',  cor: '#22c55e' },
  NEUTRO:   { label: 'Neutro',    cor: '#8b92a8' },
  ATENCAO:  { label: 'Atenção',   cor: '#f0b429' },
  NEGATIVO: { label: 'Negativo',  cor: '#ff5c7a' },
}

function Lista({ titulo, itens, cor, Icone }: { titulo: string; itens: string[]; cor: string; Icone: typeof Check }) {
  if (itens.length === 0) return null
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wide flex items-center gap-1.5 mb-1.5" style={{ color: cor }}>
        <Icone size={13} /> {titulo}
      </p>
      <ul className="space-y-1">
        {itens.map((t, i) => <li key={i} className="text-[13px] text-white/85 pl-3 relative before:content-['•'] before:absolute before:left-0" style={{ lineHeight: 1.45 }}>{t}</li>)}
      </ul>
    </div>
  )
}

// Cartão de uma análise de Relatório Gerencial de FII. Usado na página
// "Análise de Relatórios" e no quadro da página do ativo.
// `semLinkAtivo`: na página do próprio ativo o ticker não precisa ser link.
export default function CartaoAnaliseRelatorio({ a, onVisto, onExcluir, semLinkAtivo = false }: {
  a: AnaliseRelatorioFii; onVisto: () => void; onExcluir: () => void; semLinkAtivo?: boolean
}) {
  const v = VEREDITO[a.veredito]
  const nova = !a.visto_em
  const ticker = a.inv_ativos?.ticker ?? '—'
  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: nova ? `${v.cor}55` : 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-white font-semibold text-[15px] flex items-center gap-2">
            {semLinkAtivo ? <span>{ticker}</span> : <Link to={`/investimentos/ativos/${a.ativo_id}`} className="hover:underline">{ticker}</Link>}
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ color: v.cor, background: `${v.cor}1f` }}>{v.label}</span>
            {nova && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-400/15 text-blue-300">NOVA</span>}
          </p>
          <p className="text-[12px]" style={{ color: MUTED }}>
            {a.inv_documentos_resultado ? (a.inv_documentos_resultado.fonte === 'EDGAR' ? `Relatório ${a.inv_documentos_resultado.tipo_doc}` : 'Resultado') : 'Relatório'} de {a.data_referencia ? formatData(a.data_referencia) : '—'} · {a.origem === 'CRON' ? 'automática' : 'manual'}
            {a.mentor_nome || a.provedor ? ` · ${a.mentor_nome || a.provedor}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {(a.inv_relatorios_fii?.url_documento ?? a.inv_documentos_resultado?.url_documento) && (
            <a href={(a.inv_relatorios_fii?.url_documento ?? a.inv_documentos_resultado?.url_documento) as string} target="_blank" rel="noreferrer"
              title={a.inv_documentos_resultado ? (a.inv_documentos_resultado.fonte === 'EDGAR' ? 'Abrir o documento na SEC (EDGAR)' : 'Abrir a fonte dos dados (CVM)') : 'Abrir o PDF do relatório (Fundos.NET)'}
              className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-white/10 hover:border-white/25 text-white/80">
              <ExternalLink size={12} /> {a.inv_documentos_resultado ? (a.inv_documentos_resultado.fonte === 'EDGAR' ? a.inv_documentos_resultado.tipo_doc : 'Fonte') : 'PDF'}
            </a>
          )}
          {nova && (
            <button onClick={onVisto} title="Marcar como lida" className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
              <Check size={14} />
            </button>
          )}
          <button onClick={onExcluir} title="Excluir análise" className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-red-400/40" style={{ color: '#ff5c7a' }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <p className="text-[14px] text-white/90" style={{ lineHeight: 1.5 }}>{a.resumo}</p>
      {a.mudancas && (
        <p className="text-[13px] rounded-lg px-3 py-2 border border-blue-400/25 bg-blue-400/[0.05]" style={{ color: '#93c5fd' }}>
          <span className="font-semibold">Vs. relatório anterior:</span> {a.mudancas}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Lista titulo="Pontos fortes" itens={a.pontos_fortes} cor="#22c55e" Icone={ThumbsUp} />
        <Lista titulo="Pontos de atenção" itens={a.pontos_atencao} cor="#f0b429" Icone={AlertTriangle} />
        <Lista titulo="Inconsistências" itens={a.inconsistencias} cor="#ff5c7a" Icone={ShieldAlert} />
      </div>
    </div>
  )
}
