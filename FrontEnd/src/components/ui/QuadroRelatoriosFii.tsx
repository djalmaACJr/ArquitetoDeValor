import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ExternalLink, FileSearch, RefreshCw, Sparkles } from 'lucide-react'
import CartaoAnaliseRelatorio from './CartaoAnaliseRelatorio'
import { useRelatoriosFii, listarRelatoriosDisponiveis, sincronizarRelatoriosFii } from '../../hooks/useRelatoriosFii'
import { formatData } from '../../lib/utils'
import type { AnaliseRelatorioFii, RelatorioFiiDisponivel } from '../../types'

const MUTED = '#8b92a8'

// Competência do relatório (ou, sem ela, a data de entrega/criação) — base da
// ordenação "do mais novo para o mais velho".
const dataAnalise = (a: AnaliseRelatorioFii) =>
  a.data_referencia ?? a.inv_relatorios_fii?.data_entrega?.slice(0, 10) ?? a.inv_documentos_resultado?.data_entrega?.slice(0, 10) ?? a.created_at.slice(0, 10)
const dataDisponivel = (r: RelatorioFiiDisponivel) => r.data_referencia ?? r.data_entrega.slice(0, 10)
const entregaAnalise = (a: AnaliseRelatorioFii) =>
  a.inv_relatorios_fii?.data_entrega ?? a.inv_documentos_resultado?.data_entrega ?? a.created_at
type ItemLista =
  | { tipo: 'pendente'; r: RelatorioFiiDisponivel; mes: string; entrega: string }
  | { tipo: 'analise'; a: AnaliseRelatorioFii; mes: string; entrega: string }

// Quadro da página de um FII: relatórios gerenciais (Fundos.NET) disponíveis
// com link pro PDF + análises da IA já feitas. Sempre sobre o ativo do PRÓPRIO
// usuário (a análise gasta a chave de IA dele) — a página não monta este
// quadro dentro do espaço de um dono.
const FONTE_TXT: Record<string, { titulo: string; sync: string; vazio: string }> = {
  FII:    { titulo: 'Relatórios gerenciais', sync: 'Busca relatórios dos últimos ~100 dias no Fundos.NET', vazio: 'Nenhum relatório gerencial deste fundo no cache. Clique em "Buscar relatórios" para consultar o Fundos.NET.' },
  ACOES:  { titulo: 'Resultados trimestrais', sync: 'Busca o último resultado (ITR/DFP) nos dados abertos da CVM', vazio: 'Nenhum resultado desta empresa no cache. Clique em "Buscar relatórios" para consultar os dados da CVM.' },
  STOCKS: { titulo: 'Relatórios 10-Q/10-K', sync: 'Busca os últimos relatórios na SEC (EDGAR)', vazio: 'Nenhum relatório desta empresa no cache. Clique em "Buscar relatórios" para consultar a SEC (EDGAR).' },
}
FONTE_TXT.REIT = FONTE_TXT.STOCKS

export default function QuadroRelatoriosFii({ ativoId, ticker, tipo = 'FII' }: { ativoId: string; ticker: string; tipo?: string }) {
  const txt = FONTE_TXT[tipo] ?? FONTE_TXT.FII
  const { analises, loading, analisar, personalizar, marcarVisto, excluir } = useRelatoriosFii(ativoId)
  const [disponiveis, setDisponiveis] = useState<RelatorioFiiDisponivel[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null) // 'sync' ou id do relatório
  const [msg, setMsg] = useState<string | null>(null)
  // Link vindo do aviso de login (#relatorios-fii): leva o quadro à vista.
  const ancora = useRef<HTMLElement>(null)
  const { hash } = useLocation()
  useEffect(() => {
    if (hash !== '#relatorios-fii') return
    const t = setTimeout(() => ancora.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
    return () => clearTimeout(t)
  }, [hash])

  const carregar = useCallback(async () => {
    setDisponiveis(await listarRelatoriosDisponiveis(ativoId))
    setCarregando(false)
  }, [ativoId])
  // `carregando` começa true; o pai usa key={ativoId}, então trocar de ativo remonta.
  useEffect(() => {
    let vivo = true
    listarRelatoriosDisponiveis(ativoId).then((d) => { if (vivo) { setDisponiveis(d); setCarregando(false) } })
    return () => { vivo = false }
  }, [ativoId])

  async function buscar() {
    setOcupado('sync'); setMsg(null)
    const ok = await sincronizarRelatoriosFii(100, tipo === 'FII' ? undefined : ativoId)
    await carregar()
    setOcupado(null)
    if (!ok) setMsg('Não foi possível buscar agora. Tente novamente em instantes.')
  }

  async function rodar(id: number | string) {
    setOcupado(String(id)); setMsg(null)
    const res = await analisar(ativoId, id)
    await carregar()
    setOcupado(null)
    if (!res.ok) setMsg(res.erro ?? 'Erro ao analisar')
  }

  // Lista única, sempre do mês mais novo para o mais velho (analisado ou não). No mesmo mês
  // (reapresentações/mais de uma entrega), a entrega mais recente vem primeiro.
  const itens: ItemLista[] = [
    ...disponiveis.filter((r) => !r.analisado).map((r): ItemLista => ({ tipo: 'pendente', r, mes: dataDisponivel(r).slice(0, 7), entrega: r.data_entrega })),
    ...analises.map((a): ItemLista => ({ tipo: 'analise', a, mes: dataAnalise(a).slice(0, 7), entrega: entregaAnalise(a) })),
  ].sort((x, y) => y.mes.localeCompare(x.mes) || y.entrega.localeCompare(x.entrega))
  const porMes = new Map<string, number>()
  for (const i of itens) porMes.set(i.mes, (porMes.get(i.mes) ?? 0) + 1)
  const maisDeUm = (mes: string) => (porMes.get(mes) ?? 0) > 1
  const rotuloEntrega = (entrega: string) => `entregue em ${formatData(entrega.slice(0, 10))}${entrega.length > 10 ? ` às ${new Date(entrega).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}`
  const novas = analises.filter((a) => !a.visto_em).length

  return (
    <section ref={ancora} id="relatorios-fii" className="h-full rounded-xl border p-4 space-y-3 scroll-mt-4"
      style={{ borderColor: novas > 0 ? "rgba(59,130,246,0.55)" : "rgba(255,255,255,0.1)", background: novas > 0 ? "rgba(59,130,246,0.05)" : "rgba(255,255,255,0.02)" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-[14px] font-semibold text-white/80 flex items-center gap-2">
          <FileSearch size={15} style={{ color: '#3b82f6' }} /> {txt.titulo} — {ticker}
          {novas > 0 && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ color: '#93c5fd', background: 'rgba(59,130,246,0.18)' }}>
              {novas === 1 ? '1 nova análise para verificar' : `${novas} novas análises para verificar`}
            </span>
          )}
        </h2>
        <button onClick={buscar} disabled={ocupado !== null} title={txt.sync}
          className="flex items-center gap-1.5 text-[12px] px-2 py-1 rounded-md border border-white/10 hover:border-white/25 text-white/80 disabled:opacity-50">
          <RefreshCw size={12} className={ocupado === 'sync' ? 'animate-spin' : ''} /> {ocupado === 'sync' ? 'Buscando…' : 'Buscar relatórios'}
        </button>
      </div>

      {msg && <p className="text-[12.5px]" style={{ color: '#ff5c7a' }}>{msg}</p>}

      {carregando ? (
        <p className="text-[13px]" style={{ color: MUTED }}>Carregando…</p>
      ) : disponiveis.length === 0 && analises.length === 0 ? (
        <p className="text-[13px]" style={{ color: MUTED }}>
          {txt.vazio}
        </p>
      ) : null}

      {loading ? null : itens.map((i) => (
        <div key={i.tipo === 'pendente' ? `p${i.r.id}` : `a${i.a.id}`} className="space-y-1">
          {maisDeUm(i.mes) && (
            <p className="text-[11px]" style={{ color: MUTED }}>{rotuloEntrega(i.entrega)}</p>
          )}
          {i.tipo === 'pendente' ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2">
              <span className="text-[13px] text-white/85">
                {formatData(dataDisponivel(i.r))} <span className="text-[11px] ml-1" style={{ color: MUTED }}>· não analisado</span>
              </span>
              <span className="flex items-center gap-1.5">
                {i.r.url_documento && (
                  <a href={i.r.url_documento} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-white/10 hover:border-white/25 text-white/80">
                    <ExternalLink size={12} /> {i.r.fonte === 'CVM' ? 'Fonte' : i.r.fonte === 'EDGAR' ? (i.r.tipo_doc ?? 'SEC') : 'PDF'}
                  </a>
                )}
                <button onClick={() => rodar(i.r.id)} disabled={ocupado !== null}
                  className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>
                  <Sparkles size={12} className={ocupado === String(i.r.id) ? 'animate-pulse' : ''} /> {ocupado === String(i.r.id) ? 'Analisando…' : 'Analisar'}
                </button>
              </span>
            </div>
          ) : (
            <CartaoAnaliseRelatorio a={i.a} semLinkAtivo onPersonalizar={() => personalizar(i.a.id)}
              onVisto={async () => { await marcarVisto(i.a.id) }}
              onExcluir={async () => { const r = await excluir(i.a.id); if (!r.ok) setMsg(r.erro ?? 'Erro ao excluir'); else void carregar() }} />
          )}
        </div>
      ))}
    </section>
  )
}
