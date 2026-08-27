import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListFilter, X, Download } from 'lucide-react'
import InvestimentosNav from '../components/ui/InvestimentosNav'
import { Field, Drawer, Input } from '../components/ui/shared'
import { MultiSelect } from '../components/ui/MultiSelect'
import { MonthPicker } from '../components/ui/MonthPicker'
import LoadingMascote from '../components/ui/LoadingMascote'
import { useInvestimentosOperacoes } from '../hooks/useInvestimentosOperacoes'
import { useDividendos } from '../hooks/useDividendos'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useContas } from '../hooks/useContas'
import { apiFetch, extrairLista } from '../lib/api'
import { formatMoeda, formatData, hojeLocal, mesAtual, ultimoDiaMes, proximoMes } from '../lib/utils'
import { TIPO_ATIVO_LABEL, TIPO_OPERACAO_LABEL, TIPOS_ATIVO_INV, TIPOS_OPERACAO_INV } from '../lib/constants'
import type {
  TipoAtivoInvestimento, TipoOperacaoInvestimento, InvestimentoOperacao, InvestimentoDividendo,
} from '../types'

const MUTED = '#8b92a8'
const COR_PROVENTO = '#e8b84b'

// Cor por tipo de operação: entrada (compra/aplicação) verde, saída (venda/
// resgate) vermelho — mesmo espírito das cores já usadas em Movimentações,
// mas aqui num rótulo (badge) da linha do extrato.
const COR_OPERACAO: Record<TipoOperacaoInvestimento, string> = {
  COMPRA: '#00c896', APORTE: '#00c896',
  VENDA: '#ff5c7a', RESGATE: '#ff5c7a',
  DIVIDENDO: COR_PROVENTO, RENDIMENTO: '#7dd6e8',
}
const ENTRADA = new Set<TipoOperacaoInvestimento>(['COMPRA', 'APORTE'])
const SAIDA   = new Set<TipoOperacaoInvestimento>(['VENDA', 'RESGATE'])
function corValor(v: number): string { return v > 0 ? '#00c896' : v < 0 ? '#ff5c7a' : MUTED }

// Linha unificada — operação (compra/venda/aplicação/resgate/rendimento, de
// inv_operacoes) OU provento (inv_dividendos, tabela separada — proventos NÃO
// entram em inv_operacoes, ver DividendosPage) na mesma tabela/ordem
// cronológica, já que ambos compõem o "extrato" completo da carteira.
interface LinhaExtrato {
  id: string
  data: string
  rotulo: string
  cor: string
  categoria: 'ENTRADA' | 'SAIDA' | 'PROVENTO' | 'OUTRO'
  // Tipo bruto da operação (null pra provento) — usado no filtro "Tipo"; o
  // `rotulo`/`cor` acima é só o que é EXIBIDO (proventos têm rótulo próprio,
  // o nome do tipo de dividendo cadastrado, não "Dividendo").
  tipoOperacao: TipoOperacaoInvestimento | null
  ticker: string | null
  nome: string | null
  ativoId: string | null
  tipoAtivo: TipoAtivoInvestimento | null
  rfTaxa: string | null
  contaId: string | null
  contaNome: string | null
  quantidade: number | null
  precoUnitario: number | null
  valorTotal: number
  moeda: string
  // "programado" (operação com data futura, ex.: resgate agendado no
  // vencimento) ou "provisionado" (provento com status PROJECAO — ainda não
  // recebido, independe da data) — mesmo conceito, rótulo diferente.
  futuro: boolean
  rotuloFuturo: string
}

// Junta operações + proventos num só array ordenado (mais recente primeiro).
// Extraída da tela pra ser reusada pela exportação (que busca um período
// PRÓPRIO, independente do mês exibido na tela — ver `exportarExtrato`).
function montarLinhas(
  operacoes: InvestimentoOperacao[], dividendos: InvestimentoDividendo[],
  contaNomePorId: Map<string, string>, de: string, ate: string,
): LinhaExtrato[] {
  const hoje = hojeLocal()
  const deOps: LinhaExtrato[] = operacoes.map((o) => {
    const ativo = o.inv_posicoes?.inv_ativos
    const categoria: LinhaExtrato['categoria'] =
      ENTRADA.has(o.tipo_operacao) ? 'ENTRADA' : SAIDA.has(o.tipo_operacao) ? 'SAIDA' : 'OUTRO'
    return {
      id: `op-${o.id}`, data: o.data_operacao,
      rotulo: TIPO_OPERACAO_LABEL[o.tipo_operacao], cor: COR_OPERACAO[o.tipo_operacao], categoria,
      tipoOperacao: o.tipo_operacao,
      ticker: ativo?.ticker ?? null, nome: ativo?.nome ?? null,
      ativoId: o.inv_posicoes?.ativo_id ?? null, tipoAtivo: ativo?.tipo_ativo ?? null,
      rfTaxa: o.inv_posicoes?.rf_taxa ?? null,
      contaId: o.conta_id ?? null, contaNome: o.contas?.nome ?? null,
      quantidade: Number(o.quantidade), precoUnitario: Number(o.preco_unitario),
      valorTotal: Number(o.valor_total), moeda: ativo?.moeda ?? 'BRL',
      futuro: o.data_operacao > hoje, rotuloFuturo: 'PROGRAMADO',
    }
  })
  const deDiv: LinhaExtrato[] = dividendos
    .filter((d) => (!de || d.data_pagamento >= de) && (!ate || d.data_pagamento <= ate))
    .map((d) => ({
      id: `div-${d.id}`, data: d.data_pagamento,
      rotulo: d.inv_tipos_dividendo?.nome ?? 'Provento', cor: COR_PROVENTO, categoria: 'PROVENTO',
      tipoOperacao: null,
      ticker: d.inv_ativos?.ticker ?? null, nome: d.inv_ativos?.nome ?? null,
      ativoId: d.ativo_id, tipoAtivo: d.tipo_ativo,
      rfTaxa: null,
      contaId: d.conta_id ?? null, contaNome: contaNomePorId.get(d.conta_id) ?? null,
      // Sem "quantidade" própria — valor_por_cota (quando disponível) entra
      // como "preço unit." só de referência.
      quantidade: null, precoUnitario: d.valor_por_cota ?? null,
      // inv_dividendos.valor já vem convertido pra BRL na gravação (PTAX),
      // mesmo pra ativos em moeda estrangeira — diferente de inv_operacoes,
      // que fica na moeda nativa do ativo.
      valorTotal: Number(d.valor), moeda: 'BRL',
      futuro: d.transacoes?.status === 'PROJECAO', rotuloFuturo: 'PROVISIONADO',
    }))
  return [...deOps, ...deDiv].sort((a, b) => b.data.localeCompare(a.data))
}

// Todos os 4 filtros (Tipo de ativo/Ativo/Tipo de movimentação/Conta) são
// multi-seleção e aplicados em memória sobre o já buscado — Tipo de
// movimentação e Conta nunca existiram como parâmetro de backend (nem
// operações nem dividendos aceitam); Tipo de ativo/Ativo aceitariam um único
// valor no backend, mas com múltipla seleção é mais simples manter os 4 no
// mesmo padrão do que ensinar a API a filtrar por lista. Array vazio = sem
// filtro (mostra tudo), mesmo critério usado na tela e na exportação.

function filtrarPorTiposAtivo(linhas: LinhaExtrato[], tipos: TipoAtivoInvestimento[]): LinhaExtrato[] {
  if (tipos.length === 0) return linhas
  return linhas.filter((l) => l.tipoAtivo !== null && tipos.includes(l.tipoAtivo))
}

function filtrarPorAtivos(linhas: LinhaExtrato[], ativoIds: string[]): LinhaExtrato[] {
  if (ativoIds.length === 0) return linhas
  return linhas.filter((l) => l.ativoId !== null && ativoIds.includes(l.ativoId))
}

function filtrarPorTiposMov(
  linhas: LinhaExtrato[], tipos: (TipoOperacaoInvestimento | 'PROVENTO')[],
): LinhaExtrato[] {
  if (tipos.length === 0) return linhas
  return linhas.filter((l) =>
    l.categoria === 'PROVENTO' ? tipos.includes('PROVENTO') : l.tipoOperacao !== null && tipos.includes(l.tipoOperacao),
  )
}

function filtrarPorContas(linhas: LinhaExtrato[], contaIds: string[]): LinhaExtrato[] {
  if (contaIds.length === 0) return linhas
  return linhas.filter((l) => l.contaId !== null && contaIds.includes(l.contaId))
}

// Aplica os 4 filtros em sequência — usado tanto pela tela quanto pela
// exportação (períodos/datasets diferentes, mesmos critérios).
function aplicarFiltros(
  linhas: LinhaExtrato[],
  f: { tiposAtivo: TipoAtivoInvestimento[]; ativoIds: string[]; tiposMov: (TipoOperacaoInvestimento | 'PROVENTO')[]; contaIds: string[] },
): LinhaExtrato[] {
  return filtrarPorContas(filtrarPorTiposMov(filtrarPorAtivos(filtrarPorTiposAtivo(linhas, f.tiposAtivo), f.ativoIds), f.tiposMov), f.contaIds)
}

export default function ExtratoInvestimentosPage() {
  const [tiposAtivo, setTiposAtivo] = useState<TipoAtivoInvestimento[]>([])
  const [ativoIds,   setAtivoIds]   = useState<string[]>([])
  // Tipo de MOVIMENTAÇÃO (compra/venda/aplicação/resgate/rendimento/provento)
  // — diferente do filtro "Tipo de ativo" acima. 'PROVENTO' é um valor
  // sintético (não existe em TipoOperacaoInvestimento): agrupa os proventos,
  // que não têm tipo_operacao próprio (vêm de inv_dividendos, não inv_operacoes).
  const [tiposMov,   setTiposMov]   = useState<(TipoOperacaoInvestimento | 'PROVENTO')[]>([])
  const [contaIds, setContaIds] = useState<string[]>([])
  // Lista paginada por mês (como o Extrato financeiro) em vez de um período
  // livre — evita carregar/rolar anos de movimentações de uma vez só.
  const [mes, setMes] = useState(mesAtual)
  const de  = `${mes}-01`
  const ate = ultimoDiaMes(mes)

  // Lista de ativos pro seletor "Ativo" — busca todos (múltipla seleção de
  // Tipo de ativo não dá pra mandar como parâmetro único ao backend) e
  // filtra em memória pelos tipos escolhidos, pra não oferecer um ativo que
  // não bate com o filtro de tipo ao lado.
  const { ativos } = useInvestimentosAtivos()
  const ativosDisponiveis = useMemo(
    () => (tiposAtivo.length > 0 ? ativos.filter((a) => tiposAtivo.includes(a.tipo_ativo)) : ativos),
    [ativos, tiposAtivo],
  )
  // Proventos não trazem o nome da conta embutido (diferente de operações) —
  // resolve pelo mapa de contas do usuário.
  const { contas } = useContas()
  const contaNomePorId = useMemo(() => new Map(contas.map((c) => [c.conta_id, c.nome])), [contas])

  // Tipo de ativo/Ativo/Tipo de movimentação/Conta são filtrados em memória
  // (ver `aplicarFiltros`) — só o mês (de/ate) vai pro backend de operações.
  const { operacoes, loading: loadingOps, error: erroOps } = useInvestimentosOperacoes({ de, ate })
  // Dividendos não tem filtro de período no backend (dataset tipicamente bem
  // menor que operações) — filtra por data no cliente, junto com o merge.
  const { dividendos, loading: loadingDiv, error: erroDiv } = useDividendos()

  const loading = loadingOps || loadingDiv
  const error = erroOps ?? erroDiv

  // Trocar os tipos pode invalidar ativos selecionados (não pertencem mais à
  // lista filtrada) — poda pra evitar um filtro de ativo "órfão" e confuso.
  function mudarTiposAtivo(tipos: TipoAtivoInvestimento[]) {
    setTiposAtivo(tipos)
    if (tipos.length === 0) return
    const idsValidos = new Set(ativos.filter((a) => tipos.includes(a.tipo_ativo)).map((a) => a.id))
    setAtivoIds((prev) => prev.filter((id) => idsValidos.has(id)))
  }
  // "Limpar filtros" não mexe no mês — isso é navegação/paginação, não um
  // filtro a limpar (equivalente ao Extrato financeiro, que também mantém
  // o mês ao limpar os demais filtros).
  const temFiltro = tiposAtivo.length > 0 || ativoIds.length > 0 || tiposMov.length > 0 || contaIds.length > 0
  function limparFiltros() { setTiposAtivo([]); setAtivoIds([]); setTiposMov([]); setContaIds([]) }

  // Exportação — período PRÓPRIO (não o mês paginado na tela): abre um
  // drawer pra escolher De/Até antes de gerar o arquivo. Mantém tipo de
  // ativo/ativo/tipo de movimentação já selecionados na tela (só o período
  // é perguntado à parte).
  const [modalExport, setModalExport] = useState(false)
  const [expDe,  setExpDe]  = useState(de)
  const [expAte, setExpAte] = useState(ate)
  const [exportando, setExportando] = useState(false)
  const [erroExport, setErroExport] = useState<string | null>(null)

  function abrirExportacao() {
    setExpDe(de); setExpAte(ate); setErroExport(null); setModalExport(true)
  }

  async function exportarExtrato() {
    if (!expDe || !expAte || expDe > expAte) { setErroExport('Informe um período válido (De ≤ Até).'); return }
    setExportando(true)
    setErroExport(null)
    try {
      const paramsOps = new URLSearchParams({ de: expDe, ate: expAte })
      const [resOps, resDiv] = await Promise.all([
        apiFetch<InvestimentoOperacao[]>(`/investimentos/operacoes?${paramsOps.toString()}`),
        apiFetch<InvestimentoDividendo[]>('/investimentos/dividendos'),
      ])
      if (!resOps.ok) throw new Error(resOps.erro ?? 'Erro ao buscar movimentações')
      if (!resDiv.ok) throw new Error(resDiv.erro ?? 'Erro ao buscar proventos')

      const opsRaw = extrairLista<InvestimentoOperacao>(resOps.dados)
      const divRaw = extrairLista<InvestimentoDividendo>(resDiv.dados)
      const linhasExport = aplicarFiltros(
        montarLinhas(opsRaw, divRaw, contaNomePorId, expDe, expAte), { tiposAtivo, ativoIds, tiposMov, contaIds },
      ).sort((a, b) => a.data.localeCompare(b.data)) // cronológico no arquivo (a tela é do mais recente pro mais antigo)

      if (linhasExport.length === 0) { setErroExport('Nada para exportar nesse período/filtro.'); return }

      const { exportToExcel } = await import('../lib/exportUtils')
      type Sheet = import('../lib/exportUtils').ExportSheet
      const sheet: Sheet = {
        name: 'Extrato',
        title: 'Investimentos — Extrato',
        subtitle: `${formatData(expDe)} – ${formatData(expAte)}`,
        columns: [
          { key: 'data',          label: 'Data',          type: 'date',     width: 13 },
          { key: 'ticker',        label: 'Ativo',         type: 'text',     width: 14 },
          { key: 'nome',          label: 'Nome',          type: 'text',     width: 28 },
          { key: 'tipoAtivo',     label: 'Tipo de ativo', type: 'text',     width: 16 },
          { key: 'movimentacao',  label: 'Movimentação',  type: 'text',     width: 16 },
          { key: 'conta',         label: 'Conta',         type: 'text',     width: 20 },
          { key: 'moeda',         label: 'Moeda',         type: 'text',     width: 8, align: 'center' },
          { key: 'quantidade',    label: 'Quantidade',    type: 'number',   width: 14 },
          { key: 'precoUnitario', label: 'Preço unit.',   type: 'currency', width: 14 },
          { key: 'valorTotal',    label: 'Valor total',   type: 'currency', width: 16 },
          { key: 'status',        label: 'Status',        type: 'text',     width: 14 },
        ],
        rows: linhasExport.map((l) => ({
          data: new Date(`${l.data}T12:00:00`),
          ticker: l.ticker ?? '', nome: l.nome ?? '',
          tipoAtivo: l.tipoAtivo ? TIPO_ATIVO_LABEL[l.tipoAtivo] : '',
          movimentacao: l.rotulo, conta: l.contaNome ?? '', moeda: l.moeda,
          quantidade: l.quantidade ?? '', precoUnitario: l.precoUnitario ?? '',
          // Saída (venda/resgate) sai negativa no arquivo — mesma convenção
          // do export de Transações (despesa negativa) em ImportExportPage.
          // Na tela o valor continua positivo (o sinal já vem da cor/badge).
          valorTotal: l.categoria === 'SAIDA' ? -Math.abs(l.valorTotal) : l.valorTotal,
          status: l.futuro ? l.rotuloFuturo : '',
        })),
      }
      await exportToExcel({ filename: `arqvalor_extrato_investimentos_${expDe}_${expAte}`, sheets: [sheet] })
      setModalExport(false)
    } catch (e) {
      setErroExport((e as Error).message)
    } finally {
      setExportando(false)
    }
  }

  // Navegação por teclado ←/→ entre meses — mesmo padrão do Extrato
  // financeiro (LancamentosPage). Ignora quando o foco está num campo/botão
  // (não atrapalha digitação/seleção) ou com o drawer de exportação aberto.
  const navMes = useCallback((delta: number) => setMes((m) => proximoMes(m, delta)), [])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return
      if (modalExport) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowLeft')       { e.preventDefault(); navMes(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); navMes(1) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navMes, modalExport])

  const linhas = useMemo<LinhaExtrato[]>(
    () => aplicarFiltros(
      montarLinhas(operacoes, dividendos, contaNomePorId, de, ate), { tiposAtivo, ativoIds, tiposMov, contaIds },
    ),
    [operacoes, dividendos, contaNomePorId, de, ate, tiposAtivo, ativoIds, tiposMov, contaIds],
  )

  // Resumo do período/filtro atual: entradas e saídas somadas por moeda de
  // origem (evita misturar BRL com USD); proventos sempre em BRL.
  const resumo = useMemo(() => {
    const entradas = new Map<string, number>()
    const saidas   = new Map<string, number>()
    let proventos = 0
    // Breakdown por tipo de movimentação DENTRO de cada moeda (ex.: BRL →
    // Compra R$X, Aplicação R$Y) — mostrado abaixo do total de cada card.
    const entradasPorTipo = new Map<string, Map<string, number>>() // moeda → { tipo → valor }
    const saidasPorTipo   = new Map<string, Map<string, number>>()
    const somaPorTipo = (mapa: Map<string, Map<string, number>>, moeda: string, tipo: string, v: number) => {
      const porMoeda = mapa.get(moeda) ?? new Map<string, number>()
      porMoeda.set(tipo, (porMoeda.get(tipo) ?? 0) + v)
      mapa.set(moeda, porMoeda)
    }
    for (const l of linhas) {
      const tipoLabel = l.tipoOperacao ? TIPO_OPERACAO_LABEL[l.tipoOperacao] : l.rotulo
      if (l.categoria === 'ENTRADA') {
        entradas.set(l.moeda, (entradas.get(l.moeda) ?? 0) + l.valorTotal)
        somaPorTipo(entradasPorTipo, l.moeda, tipoLabel, l.valorTotal)
      } else if (l.categoria === 'SAIDA') {
        saidas.set(l.moeda, (saidas.get(l.moeda) ?? 0) + l.valorTotal)
        somaPorTipo(saidasPorTipo, l.moeda, tipoLabel, l.valorTotal)
      } else if (l.categoria === 'PROVENTO') proventos += l.valorTotal
    }
    // Líquido = entradas − saídas + proventos, por moeda (proventos sempre
    // somam na cesta BRL — ver nota acima sobre conversão na gravação).
    const liquido = new Map<string, number>()
    for (const [moeda, v] of entradas) liquido.set(moeda, (liquido.get(moeda) ?? 0) + v)
    for (const [moeda, v] of saidas)   liquido.set(moeda, (liquido.get(moeda) ?? 0) - v)
    liquido.set('BRL', (liquido.get('BRL') ?? 0) + proventos)
    // Contagem por tipo de movimentação (Compra/Venda/.../Provento) — cada
    // provento conta como "Provento", não pelo nome do tipo de dividendo
    // (senão "Dividendos"/"JCP"/etc fragmentariam a contagem).
    const porTipo = new Map<string, number>()
    for (const l of linhas) {
      const chave = l.categoria === 'PROVENTO' ? 'Provento' : (l.tipoOperacao ? TIPO_OPERACAO_LABEL[l.tipoOperacao] : l.rotulo)
      porTipo.set(chave, (porTipo.get(chave) ?? 0) + 1)
    }
    return {
      entradas: [...entradas.entries()], saidas: [...saidas.entries()], proventos,
      liquido: [...liquido.entries()],
      porTipo: [...porTipo.entries()].sort((a, b) => b[1] - a[1]),
      entradasPorTipo, saidasPorTipo,
    }
  }, [linhas])

  return (
    <div className="p-5">
      <InvestimentosNav />
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-white">Extrato</h1>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
            Todas as movimentações e proventos da carteira
          </p>
        </div>
        <button onClick={abrirExportacao}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white"
          style={{ background: '#00c896' }}>
          <Download size={15} /> Exportar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-end gap-3 flex-wrap mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <Field label="Tipo de ativo">
          <MultiSelect className="w-52" placeholder="Todos os tipos"
            values={tiposAtivo} onChange={(v) => mudarTiposAtivo(v as TipoAtivoInvestimento[])}
            options={TIPOS_ATIVO_INV.map((t) => ({ value: t, label: TIPO_ATIVO_LABEL[t] }))} />
        </Field>
        <Field label="Ativo">
          <MultiSelect className="w-52" placeholder="Todos os ativos"
            values={ativoIds} onChange={setAtivoIds}
            options={ativosDisponiveis.map((a) => ({ value: a.id, label: a.ticker }))} />
        </Field>
        <Field label="Tipo Movimentação">
          <MultiSelect className="w-56" placeholder="Todas as movimentações"
            values={tiposMov} onChange={(v) => setTiposMov(v as (TipoOperacaoInvestimento | 'PROVENTO')[])}
            options={[
              // DIVIDENDO existe no enum mas não é usado na prática — proventos
              // vêm de inv_dividendos, não inv_operacoes (ver "Provento" abaixo).
              ...TIPOS_OPERACAO_INV.filter((t) => t !== 'DIVIDENDO').map((t) => ({ value: t, label: TIPO_OPERACAO_LABEL[t] })),
              { value: 'PROVENTO', label: 'Provento' },
            ]} />
        </Field>
        <Field label="Conta">
          <MultiSelect className="w-52" placeholder="Todas as contas"
            values={contaIds} onChange={setContaIds}
            options={contas.map((c) => ({ value: c.conta_id, label: c.nome, cor: c.cor ?? undefined }))} />
        </Field>
        <Field label="Mês">
          <MonthPicker value={mes} onChange={setMes} />
        </Field>
        {temFiltro && (
          <button onClick={limparFiltros}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] border border-white/10 hover:border-white/25"
            style={{ color: MUTED }}>
            <X size={13} /> Limpar filtros
          </button>
        )}
      </div>

      {loading ? <LoadingMascote /> : error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] text-red-300">{error}</div>
      ) : (
        <>
          {/* Resumo do período/filtro atual */}
          {linhas.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide mb-1" style={{ color: MUTED }}>
                  Entradas (compra/aplicação)
                </p>
                {resumo.entradas.length === 0
                  ? <p className="text-[15px]" style={{ color: MUTED }}>—</p>
                  : resumo.entradas.map(([moeda, v]) => (
                      <div key={moeda} className="mb-1.5 last:mb-0">
                        <p className="text-[18px] font-bold" style={{ color: '#00c896' }}>{formatMoeda(v, moeda)}</p>
                        {[...(resumo.entradasPorTipo.get(moeda) ?? [])].map(([tipo, vt]) => (
                          <p key={tipo} className="text-[11px] flex justify-between gap-2" style={{ color: MUTED }}>
                            <span>{tipo}</span><span>{formatMoeda(vt, moeda)}</span>
                          </p>
                        ))}
                      </div>
                    ))}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide mb-1" style={{ color: MUTED }}>
                  Saídas (venda/resgate)
                </p>
                {resumo.saidas.length === 0
                  ? <p className="text-[15px]" style={{ color: MUTED }}>—</p>
                  : resumo.saidas.map(([moeda, v]) => (
                      <div key={moeda} className="mb-1.5 last:mb-0">
                        <p className="text-[18px] font-bold" style={{ color: '#ff5c7a' }}>{formatMoeda(v, moeda)}</p>
                        {[...(resumo.saidasPorTipo.get(moeda) ?? [])].map(([tipo, vt]) => (
                          <p key={tipo} className="text-[11px] flex justify-between gap-2" style={{ color: MUTED }}>
                            <span>{tipo}</span><span>{formatMoeda(vt, moeda)}</span>
                          </p>
                        ))}
                      </div>
                    ))}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide mb-1" style={{ color: MUTED }}>
                  Proventos
                </p>
                <p className="text-[18px] font-bold" style={{ color: COR_PROVENTO }}>{formatMoeda(resumo.proventos, 'BRL')}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide mb-1" style={{ color: MUTED }}>
                  Totais
                </p>
                <p className="text-[18px] font-bold text-white">{linhas.length} movimentações</p>
                {resumo.porTipo.map(([label, n]) => (
                  <p key={label} className="text-[11px] flex justify-between gap-2" style={{ color: MUTED }}>
                    <span>{label}</span><span>{n}</span>
                  </p>
                ))}
                <div className="mt-2 pt-2 border-t border-white/5">
                  <p className="text-[11px] mb-0.5" style={{ color: MUTED }}>Líquido (entradas − saídas + proventos)</p>
                  {resumo.liquido.map(([moeda, v]) => (
                    <p key={moeda} className="text-[15px] font-bold" style={{ color: corValor(v) }}>
                      {v >= 0 ? '+' : ''}{formatMoeda(v, moeda)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {linhas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
              <ListFilter size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
              <p className="text-white font-medium">Nenhuma movimentação neste mês</p>
              <p className="text-[13px] mt-1" style={{ color: MUTED }}>
                {temFiltro ? 'Ajuste os filtros ou troque o período acima.' : 'Troque o mês acima ou registre movimentações em "Meus ativos" → Movimentações.'}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]" style={{ minWidth: 780 }}>
                  <thead>
                    <tr className="border-b border-white/10" style={{ color: MUTED }}>
                      <th className="text-left font-medium px-3 py-2.5">Data</th>
                      <th className="text-left font-medium px-3 py-2.5">Ativo</th>
                      <th className="text-left font-medium px-3 py-2.5">Tipo</th>
                      <th className="text-left font-medium px-3 py-2.5">Conta</th>
                      <th className="text-right font-medium px-3 py-2.5">Quantidade</th>
                      <th className="text-right font-medium px-3 py-2.5">Preço unit.</th>
                      <th className="text-right font-medium px-3 py-2.5">Valor total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.id} className="border-t border-white/5 hover:bg-white/[0.03] transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatData(l.data)}
                          {l.futuro && (
                            <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ color: '#f0b429', background: 'rgba(240,180,41,0.12)' }}>
                              {l.rotuloFuturo}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {l.ticker ? (
                            <>
                              <Link to={`/investimentos/ativos/${l.ativoId}`} className="text-white font-medium hover:underline">
                                {l.ticker}
                              </Link>
                              <span className="block text-[11px]" style={{ color: MUTED }}>
                                {l.tipoAtivo ? TIPO_ATIVO_LABEL[l.tipoAtivo] : '—'}
                                {l.rfTaxa ? ` · ${l.rfTaxa}` : ''}
                              </span>
                            </>
                          ) : <span style={{ color: MUTED }}>—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-[12px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{ background: `${l.cor}22`, color: l.cor }}>
                            {l.rotulo}
                          </span>
                        </td>
                        <td className="px-3 py-2" style={{ color: MUTED }}>{l.contaNome ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-white/80">
                          {l.quantidade != null ? l.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 8 }) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-white/80">
                          {l.precoUnitario != null ? formatMoeda(l.precoUnitario, l.moeda) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-white">
                          {formatMoeda(l.valorTotal, l.moeda)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {modalExport && (
        <Drawer open onClose={() => !exportando && setModalExport(false)} titulo="Exportar extrato"
          subtitulo="Gera uma planilha XLSX — o período é independente do mês exibido na tela"
          rodape={
            <>
              <button onClick={() => setModalExport(false)} disabled={exportando}
                className="flex-1 py-2 rounded-lg text-[13px] border border-white/10 hover:border-white/25 disabled:opacity-50"
                style={{ color: MUTED }}>
                Cancelar
              </button>
              <button onClick={exportarExtrato} disabled={exportando}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60"
                style={{ background: '#00c896' }}>
                <Download size={14} /> {exportando ? 'Exportando…' : 'Exportar XLSX'}
              </button>
            </>
          }>
          <div className="grid grid-cols-2 gap-3">
            <Field label="De">
              <Input type="date" value={expDe} onChange={(e) => setExpDe(e.target.value)} />
            </Field>
            <Field label="Até">
              <Input type="date" value={expAte} onChange={(e) => setExpAte(e.target.value)} />
            </Field>
          </div>
          <p className="text-[12px] mt-2" style={{ color: MUTED }}>
            Mantém os filtros de tipo de ativo, ativo, tipo de movimentação e conta selecionados na tela — só o período é escolhido aqui.
          </p>
          {erroExport && (
            <p className="text-[13px] mt-3 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300">
              {erroExport}
            </p>
          )}
        </Drawer>
      )}
    </div>
  )
}
