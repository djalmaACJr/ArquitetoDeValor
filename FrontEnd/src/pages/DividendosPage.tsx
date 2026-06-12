import { useState, useMemo } from 'react'
import { Plus, Trash2, Settings, ArrowLeft, Coins, CheckCircle2, Link2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDividendos, type CriarDividendoInput } from '../hooks/useDividendos'
import { useTiposDividendo } from '../hooks/useTiposDividendo'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useCategorias } from '../hooks/useCategorias'
import { useContas } from '../hooks/useContas'
import { apiFetch, extrairLista } from '../lib/api'
import {
  Drawer, Field, Input, SelectDark, SearchableSelect, BtnSalvar, BtnCancelar,
  Toast, ModalExcluir, Segmented,
} from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import { formatBRL, formatData, hojeLocal, mesAtual } from '../lib/utils'
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR } from '../lib/constants'
import type { InvestimentoDividendo, InvestimentoTipoDividendo, TipoAtivoInvestimento } from '../types'

const MUTED = '#8b92a8'

// Rótulo padrão do tipo de provento quando o registro não tem tipo vinculado
// (ex.: dividendos importados/associados antes do auto-preenchimento).
const TIPO_DEFAULT_LABEL = (t: TipoAtivoInvestimento): string =>
  t === 'FII' ? 'Aluguel de FII' : 'Dividendos'

// Lista de meses (YYYY-MM) de `ini` até `fim`, inclusive.
function gerarMeses(ini: string, fim: string): string[] {
  const out: string[] = []
  let [a, m] = ini.split('-').map(Number)
  const [af, mf] = fim.split('-').map(Number)
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; a++ }
  }
  return out
}
function mesMenos(m: string, n: number): string {
  const [a, mo] = m.split('-').map(Number)
  let a2 = a, m2 = mo - n
  while (m2 <= 0) { m2 += 12; a2-- }
  return `${a2}-${String(m2).padStart(2, '0')}`
}

export default function DividendosPage() {
  const [drawerNovo,   setDrawerNovo]   = useState(false)
  const [drawerConfig, setDrawerConfig] = useState(false)
  const [drawerAssoc,  setDrawerAssoc]  = useState(false)
  const [excluindo,    setExcluindo]    = useState<InvestimentoDividendo | null>(null)
  const [confirmando,  setConfirmando]  = useState<InvestimentoDividendo | null>(null)
  const [salvando,     setSalvando]     = useState(false)
  const [toast,        setToast]        = useState<string | null>(null)

  const { dividendos, loading, excluir } = useDividendos()

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(null), 3000) }

  async function confirmarExclusao() {
    if (!excluindo) return
    setSalvando(true)
    const res = await excluir(excluindo.id)
    setSalvando(false)
    if (res.ok) showToast('Dividendo excluído (e removido do extrato).')
    else showToast(res.erro ?? 'Erro ao excluir')
    setExcluindo(null)
  }

  if (loading) return <LoadingMascote />

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/investimentos" className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="text-[22px] font-bold text-white">Dividendos</h1>
            <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>Proventos recebidos, integrados ao extrato</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDrawerConfig(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
            <Settings size={15} /> Configurar tipos
          </button>
          <button onClick={() => setDrawerAssoc(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
            <Link2 size={15} /> Associar do extrato
          </button>
          <button onClick={() => setDrawerNovo(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white" style={{ background: '#3b82f6' }}>
            <Plus size={15} /> Novo dividendo
          </button>
        </div>
      </div>

      <Toast msg={toast} />

      {/* Lista */}
      {dividendos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
          <Coins size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
          <p className="text-white font-medium">Nenhum dividendo lançado</p>
          <p className="text-[13px] mt-1" style={{ color: MUTED }}>
            Cada dividendo gera uma receita no extrato, na categoria do seu tipo.
          </p>
        </div>
      ) : (
        <ListaDividendos dividendos={dividendos} onExcluir={setExcluindo} onConfirmar={setConfirmando} />
      )}

      {drawerNovo   && <DrawerNovoDividendo onClose={() => setDrawerNovo(false)} onToast={showToast} />}
      {drawerConfig && <DrawerConfigTipos   onClose={() => setDrawerConfig(false)} onToast={showToast} />}
      {drawerAssoc  && <DrawerAssociar      onClose={() => setDrawerAssoc(false)} onToast={showToast} />}
      {confirmando  && <DrawerConfirmar dividendo={confirmando} onClose={() => setConfirmando(null)} onToast={showToast} />}

      {excluindo && (
        <ModalExcluir nome={`${excluindo.inv_ativos?.ticker ?? 'Dividendo'} · ${formatBRL(excluindo.valor)}`}
          mensagem="A transação vinculada no extrato também será removida."
          onConfirmar={confirmarExclusao} onCancelar={() => setExcluindo(null)} salvando={salvando} />
      )}
    </div>
  )
}

// ── Lista de dividendos (filtros + ordenação + agrupamento) ─────

type DivSortKey = 'ticker' | 'tipo' | 'data' | 'valor'

function ListaDividendos({ dividendos, onExcluir, onConfirmar }: {
  dividendos: InvestimentoDividendo[]
  onExcluir: (d: InvestimentoDividendo) => void
  onConfirmar: (d: InvestimentoDividendo) => void
}) {
  const [filtroTicker, setFiltroTicker] = useState('')
  const [filtroTipoAtivo, setFiltroTipoAtivo] = useState<'' | TipoAtivoInvestimento>('')
  const [agrupar, setAgrupar] = useState(true)
  const [sort, setSort] = useState<{ key: DivSortKey; dir: 'asc' | 'desc' }>({ key: 'data', dir: 'desc' })

  const tipoLabel = (d: InvestimentoDividendo) => d.inv_tipos_dividendo?.nome ?? TIPO_DEFAULT_LABEL(d.tipo_ativo)

  const tickers = useMemo(() => {
    const s = new Set<string>()
    for (const d of dividendos) if (d.inv_ativos?.ticker) s.add(d.inv_ativos.ticker)
    return [...s].sort()
  }, [dividendos])
  const tiposAtivo = useMemo(() => {
    const s = new Set<TipoAtivoInvestimento>()
    for (const d of dividendos) s.add(d.tipo_ativo)
    return [...s]
  }, [dividendos])

  const filtrados = useMemo(() => dividendos.filter((d) =>
    (!filtroTicker || d.inv_ativos?.ticker === filtroTicker) &&
    (!filtroTipoAtivo || d.tipo_ativo === filtroTipoAtivo)
  ), [dividendos, filtroTicker, filtroTipoAtivo])

  const valorOrd = (d: InvestimentoDividendo): string | number => {
    switch (sort.key) {
      case 'ticker': return d.inv_ativos?.ticker ?? ''
      case 'tipo':   return tipoLabel(d)
      case 'data':   return d.data_pagamento
      case 'valor':  return d.valor
    }
  }
  const ordenados = useMemo(() => {
    const arr = [...filtrados]
    arr.sort((a, b) => {
      const va = valorOrd(a), vb = valorOrd(b)
      const c = typeof va === 'number' && typeof vb === 'number'
        ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
      return sort.dir === 'asc' ? c : -c
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, sort])

  const clickSort = (key: DivSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'valor' || key === 'data' ? 'desc' : 'asc' }))

  const grupos = useMemo(() => {
    if (!agrupar) return null
    const map = new Map<TipoAtivoInvestimento, InvestimentoDividendo[]>()
    for (const d of ordenados) {
      if (!map.has(d.tipo_ativo)) map.set(d.tipo_ativo, [])
      map.get(d.tipo_ativo)!.push(d)
    }
    return [...map.entries()]
      .map(([tipo, lista]) => ({ tipo, lista, total: lista.reduce((s, d) => s + d.valor, 0) }))
      .sort((a, b) => b.total - a.total)
  }, [ordenados, agrupar])

  const total = useMemo(() => filtrados.reduce((s, d) => s + d.valor, 0), [filtrados])

  const seta = (k: DivSortKey) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')
  const Th = ({ k, label, cls }: { k: DivSortKey; label: string; cls?: string }) => (
    <th onClick={() => clickSort(k)}
      className={`px-4 py-2.5 font-medium cursor-pointer select-none hover:text-white ${cls ?? ''}`}>
      {label}{seta(k)}
    </th>
  )

  const linha = (d: InvestimentoDividendo) => (
    <tr key={d.id} className="border-t border-white/5">
      <td className="px-4 py-2.5 font-semibold text-white">{d.inv_ativos?.ticker ?? '—'}</td>
      <td className="px-4 py-2.5">
        {d.inv_tipos_dividendo?.nome
          ? <span className="text-white/80">{d.inv_tipos_dividendo.nome}</span>
          : <span className="italic" style={{ color: MUTED }}>{TIPO_DEFAULT_LABEL(d.tipo_ativo)}</span>}
      </td>
      <td className="px-4 py-2.5 text-white/80">{formatData(d.data_pagamento)}</td>
      <td className="px-4 py-2.5 text-right font-medium" style={{ color: '#00c896' }}>{formatBRL(d.valor)}</td>
      <td className="px-4 py-2.5 text-center">
        {d.transacoes?.status === 'PROJECAO' ? (
          <span className="text-[12px] px-2 py-0.5 rounded-full" style={{ background: '#ffb74d22', color: '#ffb74d' }}>Projetado</span>
        ) : d.transacao_extrato_id ? (
          <span className="text-[12px] px-2 py-0.5 rounded-full" style={{ background: '#00c89622', color: '#00c896' }}>Pago</span>
        ) : (
          <span className="text-[12px]" style={{ color: MUTED }}>—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          {d.transacoes?.status === 'PROJECAO' && (
            <button onClick={() => onConfirmar(d)} title="Confirmar recebimento"
              className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-emerald-400/40" style={{ color: '#00c896' }}>
              <CheckCircle2 size={13} />
            </button>
          )}
          <button onClick={() => onExcluir(d)} className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-red-400/40" style={{ color: '#ff5c7a' }}>
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  )

  return (
    <>
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SelectDark value={filtroTicker} onChange={(e) => setFiltroTicker(e.target.value)} className="!py-1.5 !text-[13px] min-w-[130px]">
          <option value="">Todos os tickers</option>
          {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
        </SelectDark>
        <SelectDark value={filtroTipoAtivo} onChange={(e) => setFiltroTipoAtivo(e.target.value as '' | TipoAtivoInvestimento)} className="!py-1.5 !text-[13px] min-w-[130px]">
          <option value="">Todos os tipos</option>
          {tiposAtivo.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
        </SelectDark>
        {(filtroTicker || filtroTipoAtivo) && (
          <button onClick={() => { setFiltroTicker(''); setFiltroTipoAtivo('') }}
            className="text-[13px] px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-white/25" style={{ color: MUTED }}>
            Limpar
          </button>
        )}
        <button onClick={() => setAgrupar((a) => !a)}
          className="text-[13px] px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-white/25 ml-auto" style={{ color: MUTED }}>
          Agrupar por tipo: {agrupar ? 'ligado' : 'desligado'}
        </button>
        <span className="text-[13px] font-medium" style={{ color: '#00c896' }}>{formatBRL(total)}</span>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left" style={{ color: MUTED }}>
              <Th k="ticker" label="Ativo" />
              <Th k="tipo" label="Tipo" />
              <Th k="data" label="Pagamento" />
              <Th k="valor" label="Valor" cls="text-right" />
              <th className="px-4 py-2.5 font-medium text-center">Extrato</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          {agrupar && grupos ? (
            grupos.map((g) => (
              <tbody key={g.tipo}>
                <tr className="border-t border-white/10 bg-white/[0.03]">
                  <td colSpan={3} className="px-4 py-2">
                    <span className="font-semibold text-[13px]" style={{ color: TIPO_ATIVO_COR[g.tipo] }}>{TIPO_ATIVO_LABEL[g.tipo]}</span>
                    <span className="text-[12px] ml-2" style={{ color: MUTED }}>· {g.lista.length}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-[13px]" style={{ color: '#00c896' }}>{formatBRL(g.total)}</td>
                  <td colSpan={2}></td>
                </tr>
                {g.lista.map(linha)}
              </tbody>
            ))
          ) : (
            <tbody>{ordenados.map(linha)}</tbody>
          )}
        </table>
      </div>

      {ordenados.length === 0 && (
        <p className="text-[13px] text-center py-4" style={{ color: MUTED }}>Nenhum dividendo para os filtros selecionados.</p>
      )}
    </>
  )
}

// ── Drawer: novo dividendo ──────────────────────────────────────

function DrawerNovoDividendo({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const { ativos } = useInvestimentosAtivos()
  const { tipos }  = useTiposDividendo()
  const { contas } = useContas()
  const { criar }  = useDividendos()

  const [ativoId,  setAtivoId]  = useState('')
  const [tipoDivId, setTipoDivId] = useState('')
  const [contaId,  setContaId]  = useState('')
  const [valor,    setValor]    = useState('')
  const [data,     setData]     = useState(hojeLocal())
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)

  const ativoSel = ativos.find((a) => a.id === ativoId)

  async function salvar() {
    if (!ativoId)   { onToast('Selecione o ativo'); return }
    if (!tipoDivId) { onToast('Selecione o tipo de dividendo'); return }
    if (!contaId)   { onToast('Selecione a conta'); return }
    const v = Number(valor)
    if (!(v > 0)) { onToast('Informe um valor maior que zero'); return }

    setSalvando(true)
    const payload: CriarDividendoInput = {
      ativo_id: ativoId,
      conta_id: contaId,
      valor: v,
      data_pagamento: data,
      tipo_ativo: (ativoSel?.tipo_ativo ?? 'ACOES') as TipoAtivoInvestimento,
      tipo_dividendo_id: tipoDivId,
      descricao: descricao.trim() || null,
    }
    const res = await criar(payload)
    setSalvando(false)
    if (res.ok) { onToast('Dividendo lançado no extrato!'); onClose() }
    else onToast(res.erro ?? 'Erro ao lançar dividendo')
  }

  const semTipos = tipos.length === 0
  const tipoSemCategoria = tipoDivId && !tipos.find((t) => t.id === tipoDivId)?.categoria_id

  return (
    <Drawer open onClose={onClose} titulo="Novo dividendo" subtitulo="Gera uma receita no extrato"
      rodape={<><BtnCancelar onClick={onClose} /><BtnSalvar editando={false} onClick={salvar} salvando={salvando} labelSalvar="Lançar" /></>}>
      <Field label="Ativo">
        <SearchableSelect value={ativoId} onChange={setAtivoId} placeholder="Buscar ativo..."
          opcoes={ativos.map((a) => ({ id: a.id, label: a.ticker, sublabel: a.nome }))} />
      </Field>
      <Field label="Tipo de dividendo">
        <SelectDark value={tipoDivId} onChange={(e) => setTipoDivId(e.target.value)}>
          <option value="">Selecione...</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}{t.categoria_id ? '' : ' (sem categoria)'}</option>)}
        </SelectDark>
        {semTipos && <p className="text-[12px] mt-1" style={{ color: '#ffb74d' }}>Nenhum tipo configurado. Use "Configurar tipos".</p>}
        {tipoSemCategoria && <p className="text-[12px] mt-1" style={{ color: '#ffb74d' }}>Este tipo não tem categoria mapeada — configure antes de lançar.</p>}
      </Field>
      <Field label="Conta de recebimento">
        <SelectDark value={contaId} onChange={(e) => setContaId(e.target.value)}>
          <option value="">Selecione...</option>
          {contas.filter((c) => c.tipo === 'INVESTIMENTO' && c.ativa).map((c) => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
        </SelectDark>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor">
          <Input type="number" min={0} step="any" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Data de pagamento">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
      </div>
      {data > hojeLocal() && (
        <p className="text-[12px]" style={{ color: MUTED }}>Data futura → será lançado como projeção (PROJECAO) no extrato.</p>
      )}
      <Field label="Descrição (opcional)">
        <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Observação" />
      </Field>
    </Drawer>
  )
}

// ── Drawer: confirmar dividendo projetado ───────────────────────

function DrawerConfirmar({ dividendo, onClose, onToast }: {
  dividendo: InvestimentoDividendo; onClose: () => void; onToast: (m: string) => void
}) {
  const { confirmar } = useDividendos()
  const [valor,    setValor]    = useState(String(dividendo.valor))
  const [data,     setData]     = useState(hojeLocal())
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    const v = Number(valor)
    if (!(v > 0)) { onToast('Informe o valor recebido'); return }
    setSalvando(true)
    const res = await confirmar(dividendo.id, { valor: v, data_pagamento: data })
    setSalvando(false)
    if (res.ok) { onToast('Recebimento confirmado — extrato atualizado.'); onClose() }
    else onToast(res.erro ?? 'Erro ao confirmar')
  }

  return (
    <Drawer open onClose={onClose} titulo={`Confirmar · ${dividendo.inv_ativos?.ticker ?? 'Dividendo'}`}
      subtitulo="A projeção do extrato vira receita paga"
      rodape={<><BtnCancelar onClick={onClose} /><BtnSalvar editando={false} onClick={salvar} salvando={salvando} labelSalvar="Confirmar" /></>}>
      <p className="text-[13px]" style={{ color: MUTED }}>
        Projetado: {formatBRL(dividendo.valor)} para {formatData(dividendo.data_pagamento)}.
        Ajuste abaixo com o valor e a data reais do recebimento.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor recebido">
          <Input type="number" min={0} step="any" value={valor} onChange={(e) => setValor(e.target.value)} />
        </Field>
        <Field label="Data do recebimento">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  )
}

// ── Drawer: configurar tipos de dividendo (mapa → categoria) ────

function DrawerConfigTipos({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const { tipos, criar: criarTipo } = useTiposDividendo()
  const [novoNome, setNovoNome] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function adicionarTipo() {
    const nome = novoNome.trim()
    if (!nome) return
    setSalvando(true)
    const res = await criarTipo({ nome })
    setSalvando(false)
    if (res.ok) { setNovoNome(''); onToast('Tipo adicionado.') }
    else onToast(res.erro ?? 'Erro ao adicionar tipo')
  }

  return (
    <Drawer open onClose={onClose} titulo="Tipos de dividendo" subtitulo="Cada tipo é lançado na sua categoria do extrato">
      <div className="space-y-3">
        {tipos.map((t) => <MapRow key={t.id} tipo={t} onToast={onToast} />)}
      </div>

      {/* Adicionar novo tipo */}
      <div className="rounded-lg border border-dashed border-white/15 p-3 mt-2">
        <Field label="Novo tipo de dividendo">
          <div className="flex gap-2">
            <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Bonificação" maxLength={40}
              onKeyDown={(e) => { if (e.key === 'Enter') adicionarTipo() }} />
            <button onClick={adicionarTipo} disabled={salvando || !novoNome.trim()}
              className="px-3 rounded-lg text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>
              <Plus size={15} />
            </button>
          </div>
        </Field>
      </div>
    </Drawer>
  )
}

// Linha de mapeamento de um tipo → categoria, com as 2 opções:
// usar categoria existente OU criar nova (informando pai ou como pai).
function MapRow({ tipo, onToast }: { tipo: InvestimentoTipoDividendo; onToast: (m: string) => void }) {
  const { editar, excluir } = useTiposDividendo()
  const { categorias, criar: criarCategoria } = useCategorias()

  const [modo, setModo] = useState<'existente' | 'nova'>('existente')
  const [catId, setCatId] = useState(tipo.categoria_id ?? '')
  const [novaDesc, setNovaDesc] = useState('')
  const [novoPai, setNovoPai] = useState('')   // '' = será categoria-pai
  const [salvando, setSalvando] = useState(false)

  const catsOpcoes = categorias.map((c) => ({
    id: c.id, label: c.descricao,
    sublabel: c.id_pai ? categorias.find((p) => p.id === c.id_pai)?.descricao : undefined,
    idPai: c.id_pai ?? undefined,
  }))
  const paiOpcoes = categorias.filter((c) => !c.id_pai)
  const catAtual = categorias.find((c) => c.id === tipo.categoria_id)

  async function salvar() {
    setSalvando(true)
    let categoriaId = catId
    if (modo === 'nova') {
      const desc = novaDesc.trim()
      if (!desc) { onToast('Informe a descrição da nova categoria'); setSalvando(false); return }
      const resCat = await criarCategoria({ descricao: desc, id_pai: novoPai || null })
      if (!resCat.ok || !resCat.dados) { onToast(resCat.erro ?? 'Erro ao criar categoria'); setSalvando(false); return }
      categoriaId = resCat.dados.id
    }
    if (!categoriaId) { onToast('Selecione ou crie uma categoria'); setSalvando(false); return }
    const res = await editar(tipo.id, { categoria_id: categoriaId })
    setSalvando(false)
    if (res.ok) { onToast(`"${tipo.nome}" mapeado.`); setModo('existente'); setNovaDesc('') }
    else onToast(res.erro ?? 'Erro ao mapear')
  }

  async function remover() {
    const res = await excluir(tipo.id)
    onToast(res.ok ? 'Tipo removido.' : (res.erro ?? 'Erro ao remover'))
  }

  return (
    <div className="rounded-lg border border-white/10 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <p className="text-white font-medium text-[14px]">{tipo.nome}</p>
          <p className="text-[12px]" style={{ color: catAtual ? '#00c896' : '#ffb74d' }}>
            {catAtual ? `→ ${catAtual.descricao}` : 'sem categoria mapeada'}
          </p>
        </div>
        <button onClick={remover} title="Remover tipo"
          className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-red-400/40" style={{ color: '#ff5c7a' }}>
          <Trash2 size={13} />
        </button>
      </div>

      <Segmented value={modo} onChange={(v) => setModo(v as 'existente' | 'nova')}
        opcoes={[{ value: 'existente', label: 'Usar existente' }, { value: 'nova', label: 'Criar nova' }]} />

      <div className="mt-2 space-y-2">
        {modo === 'existente' ? (
          <SearchableSelect value={catId} onChange={setCatId} placeholder="Buscar categoria..." opcoes={catsOpcoes} />
        ) : (
          <>
            <Input value={novaDesc} onChange={(e) => setNovaDesc(e.target.value)} placeholder="Nome da categoria (até 20)" maxLength={20} />
            <SelectDark value={novoPai} onChange={(e) => setNovoPai(e.target.value)}>
              <option value="">Será categoria-pai (sem pai)</option>
              {paiOpcoes.map((p) => <option key={p.id} value={p.id}>Sob: {p.descricao}</option>)}
            </SelectDark>
          </>
        )}
        <button onClick={salvar} disabled={salvando}
          className="w-full py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>
          {salvando ? 'Salvando...' : 'Salvar mapeamento'}
        </button>
      </div>
    </div>
  )
}

// ── Drawer: associar proventos já lançados no extrato ───────────
// Caso de uso: o usuário já registrava dividendos/aluguéis como receitas
// no extrato antes de existir o módulo de investimentos. Aqui vinculamos
// esses lançamentos a um ativo (cria inv_dividendos apontando para a
// transação existente, SEM criar lançamento novo → sem duplicar).
interface LinhaAssoc {
  transacao_id: string
  data: string
  descricao: string
  valor: number
  ativo_id: string
  tipo_dividendo_id: string
  importar: boolean
}
interface TxAssoc {
  id: string; data: string; descricao?: string; valor: number; tipo: string
  categoria_id?: string; categoria_nome?: string
}

function DrawerAssociar({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const { ativos } = useInvestimentosAtivos()
  const { tipos }  = useTiposDividendo()
  const { categorias } = useCategorias()
  const { dividendos, associar } = useDividendos()

  const [categoriaId, setCategoriaId] = useState('')
  const [de,  setDe]  = useState(mesMenos(mesAtual(), 11))
  const [ate, setAte] = useState(mesAtual())
  const [etapa, setEtapa] = useState<'config' | 'revisando'>('config')
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [linhas, setLinhas] = useState<LinhaAssoc[]>([])

  const catsOpcoes = categorias.map((c) => ({
    id: c.id, label: c.descricao,
    sublabel: c.id_pai ? categorias.find((p) => p.id === c.id_pai)?.descricao : undefined,
  }))
  // Tickers do mais longo p/ o mais curto, evitando casar um prefixo curto
  const tickersOrd = [...ativos].sort((a, b) => b.ticker.length - a.ticker.length)
  const detectarAtivo = (desc: string): string => {
    const d = desc.toUpperCase()
    return tickersOrd.find((a) => d.includes(a.ticker.toUpperCase()))?.id ?? ''
  }
  const tipoPorCategoria = (catId: string): string => tipos.find((t) => t.categoria_id === catId)?.id ?? ''
  // Sugere o tipo de provento pelo tipo do ativo (FII → Aluguel de FII; demais → Dividendos)
  const sugerirTipo = (ativoId: string): string => {
    const at = ativos.find((a) => a.id === ativoId)
    const ehFii = at?.tipo_ativo === 'FII'
    const m = tipos.find((x) => (ehFii ? /aluguel|fii/i : /dividend/i).test(x.nome))
    return m?.id ?? tipoPorCategoria(categoriaId)
  }
  const setLinha = (idx: number, patch: Partial<LinhaAssoc>) =>
    setLinhas((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  async function buscar() {
    if (!categoriaId) { onToast('Selecione a categoria onde os proventos foram lançados'); return }
    setCarregando(true)
    try {
      const meses = gerarMeses(de, ate)
      const resArr = await Promise.all(meses.map((mm) => apiFetch(`/transacoes?mes=${mm}&per_page=1000`)))
      const txs = resArr.flatMap((r) => extrairLista<TxAssoc>(r.dados))
      const linkados = new Set(dividendos.map((d) => d.transacao_extrato_id).filter(Boolean) as string[])
      const catDesc = (categorias.find((c) => c.id === categoriaId)?.descricao ?? '').toLowerCase()
      const vistos = new Set<string>()
      const ls: LinhaAssoc[] = []
      for (const t of txs) {
        if (!t.id || vistos.has(t.id) || t.tipo !== 'RECEITA') continue
        const casa = t.categoria_id === categoriaId ||
          (!!catDesc && (t.categoria_nome ?? '').toLowerCase() === catDesc)
        if (!casa || linkados.has(t.id) || !(Number(t.valor) > 0)) continue
        vistos.add(t.id)
        const ativoId = detectarAtivo(String(t.descricao ?? ''))
        ls.push({
          transacao_id: t.id, data: t.data, descricao: String(t.descricao ?? ''),
          valor: Number(t.valor), ativo_id: ativoId,
          tipo_dividendo_id: ativoId ? sugerirTipo(ativoId) : '', importar: !!ativoId,
        })
      }
      ls.sort((a, b) => (a.data < b.data ? 1 : -1))
      setLinhas(ls)
      setEtapa('revisando')
      if (ls.length === 0) onToast('Nenhuma receita não associada encontrada nesse período/categoria.')
    } catch (e) {
      onToast(`Erro ao buscar: ${(e as Error).message}`)
    } finally { setCarregando(false) }
  }

  async function confirmar() {
    const sel = linhas.filter((l) => l.importar && l.ativo_id)
    if (sel.length === 0) { onToast('Defina o ativo e marque ao menos uma linha.'); return }
    setSalvando(true); setProgresso(0)
    let ok = 0, erros = 0
    for (let i = 0; i < sel.length; i++) {
      const l = sel[i]
      const res = await associar({
        transacao_extrato_id: l.transacao_id, ativo_id: l.ativo_id,
        tipo_dividendo_id: l.tipo_dividendo_id || null,
      })
      if (res.ok) ok++; else erros++
      setProgresso(Math.round(((i + 1) / sel.length) * 100))
    }
    setSalvando(false)
    onToast(`${ok} provento(s) associado(s)${erros ? `, ${erros} com erro` : ''}.`)
    onClose()
  }

  const selCount = linhas.filter((l) => l.importar && l.ativo_id).length

  return (
    <Drawer open onClose={onClose} largura="larga" titulo="Associar proventos do extrato"
      subtitulo="Vincula dividendos/aluguéis já lançados aos investimentos (sem duplicar)"
      rodape={etapa === 'revisando'
        ? <>
            <button onClick={() => setEtapa('config')}
              className="px-4 py-2.5 rounded-lg border border-white/10 text-[16px] font-semibold text-white/80 hover:border-white/25">
              Voltar
            </button>
            <BtnSalvar editando={false} onClick={confirmar} salvando={salvando} labelSalvar={`Associar ${selCount}`} />
          </>
        : <><BtnCancelar onClick={onClose} /><BtnSalvar editando={false} onClick={buscar} salvando={carregando} labelSalvar="Buscar" /></>}>
      {etapa === 'config' ? (
        <>
          <p className="text-[13px]" style={{ color: MUTED }}>
            Escolha a categoria onde você lança os proventos no extrato e o período. Listaremos as
            receitas ainda não associadas para você vincular a cada ativo — sem criar lançamentos novos.
          </p>
          <Field label="Categoria dos proventos">
            <SearchableSelect value={categoriaId} onChange={setCategoriaId} placeholder="Buscar categoria..." opcoes={catsOpcoes} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="De"><Input type="month" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
            <Field label="Até"><Input type="month" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] mb-2" style={{ color: MUTED }}>
            {linhas.length} lançamento(s) encontrado(s). Confira o ativo detectado pela descrição e o tipo de provento.
          </p>
          <div className="overflow-auto rounded-lg border border-white/10 max-h-[50vh]">
            <table className="w-full text-[13px]">
              <thead className="bg-white/[0.03] sticky top-0">
                <tr className="text-left" style={{ color: MUTED }}>
                  <th className="px-2 py-2 w-8 text-center">✓</th>
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Descrição</th>
                  <th className="px-2 py-2 text-right">Valor</th>
                  <th className="px-2 py-2">Ativo</th>
                  <th className="px-2 py-2">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={l.transacao_id} className="border-t border-white/5" style={{ opacity: l.importar ? 1 : 0.5 }}>
                    <td className="px-2 py-1 text-center">
                      <input type="checkbox" checked={l.importar} onChange={(e) => setLinha(i, { importar: e.target.checked })} className="accent-av-green" />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-white/80">{formatData(l.data)}</td>
                    <td className="px-2 py-1 text-white/70 max-w-[160px] truncate" title={l.descricao}>{l.descricao}</td>
                    <td className="px-2 py-1 text-right" style={{ color: '#00c896' }}>{formatBRL(l.valor)}</td>
                    <td className="px-1 py-1">
                      <SelectDark value={l.ativo_id} onChange={(e) => setLinha(i, { ativo_id: e.target.value, importar: !!e.target.value, tipo_dividendo_id: e.target.value ? sugerirTipo(e.target.value) : '' })} className="!py-1 !text-[12px] min-w-[88px]">
                        <option value="">— ativo —</option>
                        {ativos.map((a) => <option key={a.id} value={a.id}>{a.ticker}</option>)}
                      </SelectDark>
                    </td>
                    <td className="px-1 py-1">
                      <SelectDark value={l.tipo_dividendo_id} onChange={(e) => setLinha(i, { tipo_dividendo_id: e.target.value })} className="!py-1 !text-[12px] min-w-[130px]">
                        <option value="">—</option>
                        {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                      </SelectDark>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {linhas.some((l) => !l.ativo_id) && (
            <p className="text-[12px] mt-2" style={{ color: '#ffb74d' }}>Linhas sem ativo não serão associadas — selecione o ativo para incluí-las.</p>
          )}
          {salvando && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[12px] mb-1" style={{ color: MUTED }}>
                <span>Associando proventos…</span><span>{progresso}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${progresso}%`, background: '#00c896' }} />
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}
