// Ativos em carteira SEM o relatório esperado, agrupados por tipo (FIIs, ações…), respeitando a
// periodicidade de cada tipo: FII é mensal (relatório do mês, divulgado até ~dia 15 do seguinte);
// ações/stocks/REITs são trimestrais (ITR/DFP, 10-Q/10-K — vale o último trimestre já vencido).
// Renda fixa, tesouro, cripto etc. não têm relatório periódico e nem aparecem. Um relatório
// enviado à mão ou uma análise já feita também contam como "tem".
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, FileX } from 'lucide-react'
import { buscarCoberturaRelatorios, type CoberturaRelatorio } from '../../hooks/useRelatoriosFii'
import { TIPO_ATIVO_LABEL } from '../../lib/constants'

const MUTED = '#8b92a8'

function mesAnterior(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function agrupar(lista: CoberturaRelatorio[]): [string, CoberturaRelatorio[]][] {
  const m = new Map<string, CoberturaRelatorio[]>()
  for (const i of lista) m.set(i.tipo_ativo, [...(m.get(i.tipo_ativo) ?? []), i])
  return [...m.entries()]
}

function Grupo({ tipo, lista, cor }: { tipo: string; lista: CoberturaRelatorio[]; cor?: string }) {
  const periodos = [...new Set(lista.map((i) => i.periodo))].join(', ')
  const periodicidade = lista[0].periodicidade === 'MENSAL' ? 'mensal' : 'trimestral'
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: MUTED }}>
        {TIPO_ATIVO_LABEL[tipo as keyof typeof TIPO_ATIVO_LABEL] ?? tipo} · {lista.length}
        <span className="normal-case tracking-normal"> — {periodicidade}, esperado {periodos}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {lista.map((a) => (
          <Link key={a.ativo_id} to={`/investimentos/ativos/${a.ativo_id}#relatorios-fii`} title={`Abrir ${a.nome ?? a.ticker}`}
            className="rounded-md border px-2 py-0.5 text-[12.5px] text-white/85 hover:text-white hover:border-white/40 transition-colors"
            style={{ borderColor: cor ?? 'rgba(255,255,255,0.1)' }}>
            {a.ticker}
          </Link>
        ))}
      </div>
    </div>
  )
}

export default function RelatoriosFaltantes({ versao = 0 }: {
  /** Muda quando um relatório é enviado — força recarregar a lista. */
  versao?: number
}) {
  const [mes, setMes] = useState(mesAnterior())
  const [itens, setItens] = useState<CoberturaRelatorio[] | null>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(mes)) return
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItens(null); setErro(false)
    buscarCoberturaRelatorios(mes).then((r) => { if (!vivo) return; if (r) setItens(r); else setErro(true) })
    return () => { vivo = false }
  }, [mes, versao])

  const faltam = useMemo(() => agrupar((itens ?? []).filter((i) => i.status === 'FALTA')), [itens])
  const noPrazo = useMemo(() => agrupar((itens ?? []).filter((i) => i.status === 'NO_PRAZO')), [itens])
  const nFaltam = faltam.reduce((s, [, l]) => s + l.length, 0)

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[12.5px] text-white/85 font-medium flex items-center gap-1.5">
          <FileX size={13} style={{ color: '#f0b429' }} /> Ativos sem relatório
        </p>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} title="Mês de referência"
          className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[12.5px] text-white" />
      </div>

      {erro && <p className="text-[12.5px]" style={{ color: '#ff5c7a' }}>Não foi possível carregar agora.</p>}
      {!erro && itens === null && <p className="text-[12.5px]" style={{ color: MUTED }}>Carregando…</p>}
      {itens !== null && itens.length === 0 && (
        <p className="text-[12.5px]" style={{ color: MUTED }}>Você não tem FIIs, ações ou stocks em carteira.</p>
      )}
      {itens !== null && itens.length > 0 && nFaltam === 0 && (
        <p className="text-[12.5px] flex items-center gap-1.5" style={{ color: '#00c896' }}>
          <CheckCircle2 size={13} /> Nenhum relatório em atraso para este mês.
        </p>
      )}

      {faltam.map(([tipo, lista]) => <Grupo key={tipo} tipo={tipo} lista={lista} cor="rgba(240,180,41,0.45)" />)}

      {noPrazo.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-white/5">
          <p className="text-[11.5px] flex items-center gap-1.5" style={{ color: MUTED }}>
            <Clock size={12} /> Ainda no prazo de divulgação (não contam como faltando)
          </p>
          {noPrazo.map(([tipo, lista]) => <Grupo key={tipo} tipo={tipo} lista={lista} />)}
        </div>
      )}

      {itens !== null && itens.length > 0 && (
        <p className="text-[11px]" style={{ color: MUTED }}>
          FIIs: relatório gerencial do mês (divulgado até ~dia 15 do mês seguinte). Ações e stocks: resultado trimestral
          (ITR/DFP e 10-Q/10-K) — vale o último trimestre já vencido. Renda fixa, tesouro e cripto não têm relatório periódico.
        </p>
      )}
    </div>
  )
}
