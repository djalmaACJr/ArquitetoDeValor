import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Trash2, Check, AlertTriangle, ThumbsUp, ShieldAlert, UserRound, Sparkles } from 'lucide-react'
import { formatData } from '../../lib/utils'
import type { AnaliseRelatorioFii, AlinhamentoPessoal, VereditoRelatorio } from '../../types'

const MUTED = '#8b92a8'

const VEREDITO: Record<VereditoRelatorio, { label: string; cor: string }> = {
  POSITIVO: { label: 'Positivo',  cor: '#22c55e' },
  NEUTRO:   { label: 'Neutro',    cor: '#8b92a8' },
  ATENCAO:  { label: 'Atenção',   cor: '#f0b429' },
  NEGATIVO: { label: 'Negativo',  cor: '#ff5c7a' },
}

const ALINHAMENTO: Record<AlinhamentoPessoal, { label: string; cor: string }> = {
  ADEQUADO: { label: 'Combina com você', cor: '#22c55e' },
  ATENCAO:  { label: 'Acompanhar',       cor: '#f0b429' },
  REVISAR:  { label: 'Vale revisar',     cor: '#ff5c7a' },
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
export default function CartaoAnaliseRelatorio({ a, onVisto, onExcluir, onPersonalizar, semLinkAtivo = false }: {
  a: AnaliseRelatorioFii; onVisto: () => void; onExcluir: () => void; semLinkAtivo?: boolean
  // Etapa 2 (opcional): gera/refaz "o que isso significa para mim". Devolve o erro, se houver.
  onPersonalizar?: () => Promise<{ ok: boolean; erro?: string | null }>
}) {
  const [gerando, setGerando] = useState(false)
  const [erroPessoal, setErroPessoal] = useState<string | null>(null)
  const p = a.analise_pessoal ?? null
  async function personalizar() {
    if (!onPersonalizar) return
    setGerando(true); setErroPessoal(null)
    const r = await onPersonalizar()
    setGerando(false)
    if (!r.ok) setErroPessoal(r.erro ?? 'Não foi possível personalizar agora.')
  }
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
            {a.inv_documentos_resultado ? (a.inv_documentos_resultado.fonte === 'EDGAR' ? `Relatório ${a.inv_documentos_resultado.tipo_doc}` : a.inv_documentos_resultado.fonte === 'MANUAL' ? 'Relatório enviado' : 'Resultado') : 'Relatório'} de {a.data_referencia ? formatData(a.data_referencia) : '—'} · {a.origem === 'CRON' ? 'automática' : 'manual'}
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

      {onPersonalizar && (
        <div className="rounded-lg border border-white/10 p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.02)' }} data-tutorial="analise-pessoal">
          {p ? (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[12px] font-semibold uppercase tracking-wide flex items-center gap-1.5 text-white/80">
                  <UserRound size={13} /> Para você
                  <span className="text-[11px] normal-case font-semibold px-2 py-0.5 rounded" style={{ color: ALINHAMENTO[p.alinhamento].cor, background: `${ALINHAMENTO[p.alinhamento].cor}1f` }}>
                    {ALINHAMENTO[p.alinhamento].label}
                  </span>
                </p>
                <button onClick={personalizar} disabled={gerando} className="text-[12px] underline disabled:opacity-50" style={{ color: MUTED }}>
                  {gerando ? 'Refazendo…' : 'Refazer'}
                </button>
              </div>
              <p className="text-[14px] text-white/90" style={{ lineHeight: 1.5 }}>{p.resumo}</p>
              <Lista titulo="O que observar" itens={p.pontos} cor="#93c5fd" Icone={AlertTriangle} />
              <p className="text-[11px]" style={{ color: MUTED }}>
                Leva em conta seu perfil, quanto você tem, o peso na carteira e há quanto tempo o ativo está com você
                {p.mentor_nome || p.provedor ? ` · ${p.mentor_nome || p.provedor}` : ''}. Não é recomendação de compra ou venda.
              </p>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[13px]" style={{ color: MUTED }}>O que essa análise significa para a sua carteira, o seu perfil e o tempo que você está com o ativo?</p>
              <button onClick={personalizar} disabled={gerando}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>
                <Sparkles size={13} className={gerando ? 'animate-pulse' : ''} /> {gerando ? 'Personalizando…' : 'Personalizar para mim'}
              </button>
            </div>
          )}
          {erroPessoal && <p className="text-[12px]" style={{ color: '#ff5c7a' }}>{erroPessoal}</p>}
        </div>
      )}
    </div>
  )
}
