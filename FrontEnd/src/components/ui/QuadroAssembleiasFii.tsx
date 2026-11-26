import { useMemo, useState } from 'react'
import { CalendarClock, ExternalLink, Sparkles, Trash2 } from 'lucide-react'
import { useAssembleiasFii } from '../../hooks/useAssembleiasFii'
import type { AnaliseAssembleiaFii } from '../../types'

const MUTED = '#8b92a8'

// Data/hora no fuso de Brasília ("qua., 09/12/2026 às 18:00").
function quandoBR(iso: string | null): string {
  if (!iso) return 'Data não informada'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Data não informada'
  const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return `${data} às ${hora}`
}

function diasAte(iso: string | null): number | null {
  if (!iso) return null
  const alvo = new Date(iso).getTime()
  return Number.isNaN(alvo) ? null : Math.ceil((alvo - Date.now()) / 86_400_000)
}

function Cartao({ a, onVisto, onExcluir }: { a: AnaliseAssembleiaFii; onVisto: () => void; onExcluir: () => void }) {
  const dias = diasAte(a.data_evento)
  const importante = a.relevancia === 'IMPORTANTE'
  const cor = importante ? '#f0b429' : MUTED
  return (
    <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: a.visto_em ? 'rgba(255,255,255,0.1)' : 'rgba(59,130,246,0.5)', background: 'rgba(255,255,255,0.02)' }}
      onMouseEnter={() => { if (!a.visto_em) onVisto() }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white text-[15px] font-semibold">
            {a.inv_ativos?.ticker ?? '—'} <span className="text-[12px] font-normal" style={{ color: MUTED }}>· {a.inv_assembleias_fii?.tipo ?? 'Assembleia'}</span>
            {!a.visto_em && <span className="ml-2 text-[11px] text-blue-300">NOVA</span>}
          </p>
          <p className="text-[13px] mt-0.5" style={{ color: cor }}>
            {importante ? 'Pauta importante' : 'Pauta de rotina'} · {quandoBR(a.data_evento)}
            {dias !== null && dias >= 0 && ` · ${dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`}`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {a.inv_assembleias_fii?.url_documento && (
            <a href={a.inv_assembleias_fii.url_documento} target="_blank" rel="noopener noreferrer" title="Abrir o documento oficial (PDF) no Fundos.NET"
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium hover:bg-white/10" style={{ color: '#3b82f6', border: '1px solid rgba(59,130,246,0.4)' }}>
              <ExternalLink size={13} /> Documento oficial
            </a>
          )}
          <button onClick={onExcluir} title="Excluir" aria-label="Excluir" className="p-1.5 rounded-md hover:bg-white/10" style={{ color: MUTED }}><Trash2 size={15} /></button>
        </div>
      </div>
      <p className="text-[14px] text-white/90">{a.resumo}</p>
      {a.como_participar && <p className="text-[13px] text-white/80"><span style={{ color: MUTED }}>Como participar: </span>{a.como_participar}</p>}
      {a.prazo_voto && <p className="text-[13px] text-white/80"><span style={{ color: MUTED }}>Prazo para votar: </span>{a.prazo_voto}</p>}
      {(a.inv_assembleias_fii?.links?.length ?? 0) > 0 && (
        <div className="text-[13px]">
          <p style={{ color: MUTED }}>Links e contatos citados no documento:</p>
          <ul className="space-y-0.5 mt-0.5">
            {a.inv_assembleias_fii!.links!.map((c, i) => (
              <li key={i} className="truncate">
                {c.tipo === 'link'
                  ? <a href={c.valor} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#3b82f6' }}>{c.valor}</a>
                  : <a href={`mailto:${c.valor}`} className="underline" style={{ color: '#3b82f6' }}>{c.valor}</a>}
              </li>
            ))}
          </ul>
          <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>O link individual de votação, quando existe, costuma chegar por e-mail do administrador.</p>
        </div>
      )}
      {a.pauta.length > 0 && (
        <ul className="text-[13px] space-y-1 list-disc pl-5 text-white/85">
          {a.pauta.map((p, i) => <li key={i}><span className="font-medium">{p.item}</span>{p.explicacao && <span style={{ color: MUTED }}> — {p.explicacao}</span>}</li>)}
        </ul>
      )}
      {a.pontos_atencao.length > 0 && (
        <ul className="text-[13px] space-y-0.5 list-disc pl-5" style={{ color: '#f0b429' }}>
          {a.pontos_atencao.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
      <p className="text-[11px]" style={{ color: MUTED }}>
        Resumo gerado por IA a partir do documento oficial no Fundos.NET. Confira o PDF antes de votar; não é recomendação de voto.
      </p>
    </div>
  )
}

// Assembleias de FIIs convocadas para os fundos da carteira.
export default function QuadroAssembleiasFii({ fiis, avisar, filtro, onMostrarTodos }: { fiis: { id: string; ticker: string }[]; avisar: (m: string) => void; filtro?: (a: AnaliseAssembleiaFii) => boolean; onMostrarTodos?: () => void }) {
  const { assembleias: todas, loading, analisar, marcarVisto, excluir } = useAssembleiasFii()
  const assembleias = useMemo(() => (filtro ? todas.filter(filtro) : todas), [todas, filtro])
  const [buscando, setBuscando] = useState(false)
  const novas = useMemo(() => assembleias.filter((a) => !a.visto_em).length, [assembleias])

  async function buscar() {
    if (fiis.length === 0) return
    setBuscando(true)
    let analisadas = 0, sem = 0
    const erros: string[] = []
    for (let i = 0; i < fiis.length; i++) {
      const f = fiis[i]
      const r = await analisar(f.id, undefined, i === 0)   // consulta o Fundos.NET só na 1ª chamada
      if (!r.ok) { erros.push(`${f.ticker}: ${r.erro ?? 'erro'}`); continue }
      const n = r.dados?.analisadas ?? 0
      if (n > 0) analisadas += n; else sem++
    }
    setBuscando(false)
    avisar(`${analisadas} assembleia(s) analisada(s) · ${sem} fundo(s) sem convocação${erros.length ? ` · ${erros.length} falha(s): ${erros[0]}` : ''}`)
  }

  return (
    <div className="space-y-3" data-tutorial="assembleias-fii">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-white text-[16px] font-semibold flex items-center gap-2">
          <CalendarClock size={16} style={{ color: '#3b82f6' }} /> Assembleias {novas > 0 && <span className="text-[12px] font-normal text-blue-300">· {novas} nova(s)</span>}
        </h2>
        <button onClick={buscar} disabled={buscando || fiis.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>
          <Sparkles size={14} className={buscando ? 'animate-pulse' : ''} /> {buscando ? 'Buscando… (pode levar alguns minutos)' : 'Buscar assembleias dos meus FIIs'}
        </button>
      </div>
      <p className="text-[12px]" style={{ color: MUTED }}>
        A IA lê as convocações de assembleia dos FIIs que você possui e explica, em linguagem simples, quando é, como votar, até quando dá para votar e o que vão decidir.
        Com a análise automática ligada (aba Relatórios), isso chega sozinho todo dia. É uma leitura de apoio — confira o PDF e não trate como recomendação de voto.
      </p>
      {loading ? (
        <p className="text-[13px]" style={{ color: MUTED }}>Carregando…</p>
      ) : assembleias.length === 0 ? (
        <div className="text-[13px] text-center py-6 space-y-2" style={{ color: MUTED }}>
          <p>{filtro && todas.length > 0 ? 'Nenhuma assembleia com esses filtros.' : 'Nenhuma assembleia convocada encontrada para os seus FIIs.'}</p>
          {filtro && todas.length > 0 && onMostrarTodos && (
            <button onClick={onMostrarTodos} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#3b82f6' }}>Mostrar todas ({todas.length})</button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {assembleias.map((a) => (
            <Cartao key={a.id} a={a} onVisto={() => { void marcarVisto(a.id) }}
              onExcluir={async () => { const r = await excluir(a.id); if (!r.ok) avisar(r.erro ?? 'Erro ao excluir') }} />
          ))}
        </div>
      )}
    </div>
  )
}
