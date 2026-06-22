import { useState, useEffect, useMemo } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import {
  useInvestimentosAtivos, useBuscaAtivoExterno,
  type CriarAtivoInput, type EditarAtivoInput,
} from '../../hooks/useInvestimentosAtivos'
import { useCotacoesTesouro } from '../../hooks/useCotacoesTesouro'
import { Drawer, Field, Input, SelectDark, BtnSalvar, BtnCancelar } from './shared'
import { formatBRL } from '../../lib/utils'
import {
  tickerTesouro, nomeTesouro, tipoTituloTesouro, anoVencimento, ehSemestral,
  INDEXADOR_TESOURO_LABEL,
} from '../../lib/tesouro'
import {
  TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL,
  INDEXADORES_RF, INDEXADOR_RF_LABEL, INDEXADOR_RF_DESCRICAO,
  INDICE_RF_LABEL, INDICES_POR_INDEXADOR,
  SUBTIPO_RF_INFO, subtiposParaTipo,
  CATEGORIAS_FII, FII_CATEGORIA_INFO,
  ACOES_SUBTIPOS, ACOES_SUBTIPO_LABEL, ACOES_SUBTIPO_DESCRICAO,
} from '../../lib/constants'
import type {
  InvestimentoAtivo, TipoAtivoInvestimento, SubtipoRF, IndexadorRF, IndiceRF, CategoriaFII,
  AcoesSubtipo, ResultadoBuscaAtivo,
} from '../../types'

const MUTED = '#8b92a8'

const FORM_VAZIO: CriarAtivoInput = {
  ticker: '', nome: '', tipo_ativo: 'ACOES', moeda: 'BRL', descricao: '', nota_usuario: null,
  rf_subtipo: null, rf_indexador: null, rf_indice: null, rf_percentual_indice: null,
  rf_taxa_fixa: null, rf_taxa: null, rf_emissor: null,
  rf_vencimento: null, rf_garantia_fgc: null, rf_isento_ir: null,
  fii_categoria: null, acoes_subtipo: null, cotacao_automatica: true,
}

const ehRendaFixa = (tipo: TipoAtivoInvestimento) => tipo === 'RENDA_FIXA' || tipo === 'TESOURO_DIRETO'

// Rótulo amigável derivado dos campos estruturados (ex.: "110% CDI",
// "IPCA + 6,2%", "13,5% a.a.") — gravado em rf_taxa para exibição.
function rotuloTaxaRF(f: CriarAtivoInput): string | null {
  const num = (n: number) => String(n).replace('.', ',')
  if (f.rf_indexador === 'POS_FIXADO' && f.rf_indice) {
    // Multiplicativo ("110% CDI") ou aditivo ("CDI + 2%") — diferentes!
    if (f.rf_percentual_indice != null) return `${num(f.rf_percentual_indice)}% ${INDICE_RF_LABEL[f.rf_indice]}`
    if (f.rf_taxa_fixa != null) return `${INDICE_RF_LABEL[f.rf_indice]} + ${num(f.rf_taxa_fixa)}%`
  }
  if (f.rf_indexador === 'HIBRIDO' && f.rf_indice) {
    return f.rf_taxa_fixa != null
      ? `${INDICE_RF_LABEL[f.rf_indice]} + ${num(f.rf_taxa_fixa)}%`
      : INDICE_RF_LABEL[f.rf_indice]
  }
  if (f.rf_indexador === 'PREFIXADO' && f.rf_taxa_fixa != null) {
    return `${num(f.rf_taxa_fixa)}% a.a.`
  }
  return f.rf_taxa ?? null
}

// Form inicial — novo (limpo) ou espelhando o ativo em edição.
function formDoAtivo(ativo: InvestimentoAtivo | null): CriarAtivoInput {
  if (!ativo) return FORM_VAZIO
  return {
    ticker: ativo.ticker, nome: ativo.nome, tipo_ativo: ativo.tipo_ativo, moeda: ativo.moeda,
    descricao: ativo.descricao ?? '', nota_usuario: ativo.nota_usuario,
    rf_subtipo: ativo.rf_subtipo, rf_indexador: ativo.rf_indexador,
    rf_indice: ativo.rf_indice, rf_percentual_indice: ativo.rf_percentual_indice,
    rf_taxa_fixa: ativo.rf_taxa_fixa, rf_taxa: ativo.rf_taxa,
    rf_emissor: ativo.rf_emissor, rf_vencimento: ativo.rf_vencimento,
    rf_garantia_fgc: ativo.rf_garantia_fgc, rf_isento_ir: ativo.rf_isento_ir,
    fii_categoria: ativo.fii_categoria, acoes_subtipo: ativo.acoes_subtipo,
    cotacao_automatica: ativo.cotacao_automatica,
  }
}

// Drawer de criar/editar ativo — compartilhado entre a lista de ativos
// (AtivosInvestimentosPage) e a página de detalhe (DetalheInvestimentoPage).
// Monte-o condicionalmente (`{aberto && <DrawerAtivo .../>}`): quando `ativo`
// é informado abre em modo edição; senão, em modo criação com busca externa.
export default function DrawerAtivo({ ativo, onClose, onToast }: {
  ativo: InvestimentoAtivo | null
  onClose: () => void
  onToast: (m: string) => void
}) {
  const editando = ativo
  const [form, setForm] = useState<CriarAtivoInput>(() => formDoAtivo(ativo))
  const [salvando, setSalvando] = useState(false)

  // Busca externa (ticker → nome/preço/características)
  const [busca, setBusca] = useState('')
  const [buscaDeb, setBuscaDeb] = useState('')
  const [selecionado, setSelecionado] = useState(!!ativo)  // edição já tem nome definido
  const [manualLivre, setManualLivre] = useState(false)    // fallback de cadastro manual
  const [precoSel, setPrecoSel] = useState<number | null>(null)
  // Pós-fixado: modo da taxa — multiplicativo ("110% CDI") vs aditivo ("CDI + 2%").
  // São matematicamente diferentes; o aditivo usa rf_taxa_fixa como spread.
  const [posSpread, setPosSpread] = useState(
    () => ativo?.rf_indexador === 'POS_FIXADO' && ativo?.rf_taxa_fixa != null && ativo?.rf_percentual_indice == null,
  )
  // Tesouro: "com juros semestrais" (NTN-F / NTN-B) — compõe ticker/nome.
  const [tesouroSemestral, setTesouroSemestral] = useState(() => ehSemestral(ativo?.nome))

  const { criar, editar } = useInvestimentosAtivos()

  // Tesouro em cadastro manual: deriva ticker/nome dos campos estruturados
  // (indexador + vencimento + semestral) — o usuário não digita identificador.
  const tesouroManual = !editando && manualLivre && form.tipo_ativo === 'TESOURO_DIRETO'
  // Vencimentos disponíveis na marcação a mercado (Prefixado/IPCA+) p/ o dropdown.
  const tipoTit = tesouroManual ? tipoTituloTesouro(form.rf_indexador, tesouroSemestral) : null
  const { cotacoes } = useCotacoesTesouro({ tipo: tipoTit ?? undefined, enabled: !!tipoTit })
  const vencimentosTesouro = useMemo(() => {
    const set = new Set<string>()
    for (const c of cotacoes) set.add(c.vencimento)
    return [...set].sort()
  }, [cotacoes])

  // Ticker/nome do Tesouro manual são DERIVADOS (indexador+vencimento+semestral)
  // — calculados na hora, sem estado próprio, e materializados no payload ao salvar.
  const tesouroTicker = tesouroManual && form.rf_indexador && form.rf_vencimento
    ? tickerTesouro(form.rf_indexador, form.rf_vencimento, tesouroSemestral) : ''
  const tesouroNome = tesouroManual && form.rf_indexador && form.rf_vencimento
    ? nomeTesouro(form.rf_indexador, form.rf_vencimento, tesouroSemestral) : ''

  function resetBusca() {
    setBusca(''); setBuscaDeb(''); setSelecionado(false); setManualLivre(false); setPrecoSel(null)
  }

  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca), 400)
    return () => clearTimeout(t)
  }, [busca])

  const { resultados, buscando, erroBusca } = useBuscaAtivoExterno(form.tipo_ativo, !editando ? buscaDeb : '')

  // Resultado escolhido na lista: preenche ticker, nome e características
  function selecionarResultado(r: ResultadoBuscaAtivo) {
    setForm({
      ...form,
      ticker: r.ticker,
      nome:   r.nome,
      moeda:  r.moeda || form.moeda,
      ...(r.emissor    ? { rf_emissor: r.emissor } : {}),
      ...(r.taxa       ? { rf_taxa: r.taxa } : {}),
      ...(r.vencimento ? { rf_vencimento: r.vencimento } : {}),
      ...(r.indexador  ? { rf_indexador: r.indexador } : {}),
    })
    setPrecoSel(r.preco)
    setSelecionado(true)
    setBusca(''); setBuscaDeb('')
  }

  // Troca de tipo limpa/pré-preenche as características específicas
  // e zera a busca/seleção (a fonte de dados muda com o tipo)
  function mudarTipo(tipo: TipoAtivoInvestimento) {
    if (!editando) { resetBusca() }
    const limpaIdent = editando ? {} : { ticker: '', nome: '' }
    // Ações no exterior (Stocks) e REITs são, por padrão, em dólar. BDRs e
    // ETFs internacionais listados na B3 são cotados em BRL (campo editável).
    const moedaPadrao = tipo === 'STOCKS' || tipo === 'REIT' ? 'USD' : 'BRL'
    if (tipo === 'TESOURO_DIRETO') {
      const info = SUBTIPO_RF_INFO.TESOURO
      setForm({ ...form, ...limpaIdent, tipo_ativo: tipo, fii_categoria: null, acoes_subtipo: null, moeda: 'BRL',
        rf_subtipo: 'TESOURO', rf_emissor: info.emissor,
        rf_garantia_fgc: info.fgc, rf_isento_ir: info.isentoIR })
    } else if (tipo === 'RENDA_FIXA') {
      setForm({ ...form, ...limpaIdent, tipo_ativo: tipo, fii_categoria: null, acoes_subtipo: null, moeda: 'BRL',
        rf_subtipo: form.rf_subtipo === 'TESOURO' ? null : form.rf_subtipo })
    } else {
      setForm({ ...form, ...limpaIdent, tipo_ativo: tipo, moeda: moedaPadrao,
        rf_subtipo: null, rf_indexador: null, rf_indice: null, rf_percentual_indice: null,
        rf_taxa_fixa: null, rf_taxa: null, rf_emissor: null,
        rf_vencimento: null, rf_garantia_fgc: null, rf_isento_ir: null,
        fii_categoria: tipo === 'FII' ? form.fii_categoria : null,
        acoes_subtipo: tipo === 'ACOES' ? form.acoes_subtipo : null })
    }
  }

  // Subtipo de renda fixa pré-preenche FGC/IR/emissor (continuam editáveis)
  function mudarSubtipoRF(sub: SubtipoRF | '') {
    if (!sub) { setForm({ ...form, rf_subtipo: null }); return }
    const info = SUBTIPO_RF_INFO[sub]
    setForm({ ...form, rf_subtipo: sub,
      rf_emissor: form.rf_emissor || info.emissor || null,
      rf_garantia_fgc: info.fgc, rf_isento_ir: info.isentoIR })
  }

  // Troca a forma de rentabilidade e zera os campos que não se aplicam a ela.
  function mudarIndexador(idx: IndexadorRF | null) {
    if (idx === 'PREFIXADO') {
      setForm({ ...form, rf_indexador: idx, rf_indice: null, rf_percentual_indice: null })
    } else if (idx === 'POS_FIXADO') {
      setPosSpread(false)
      setForm({ ...form, rf_indexador: idx, rf_taxa_fixa: null })
    } else if (idx === 'HIBRIDO') {
      setForm({ ...form, rf_indexador: idx, rf_percentual_indice: null })
    } else {
      setForm({ ...form, rf_indexador: null, rf_indice: null, rf_percentual_indice: null, rf_taxa_fixa: null })
    }
  }

  // Pós-fixado: troca entre "% do índice" (multiplicativo) e "índice + spread"
  // (aditivo). Zera os dois campos para não misturar as duas formas.
  function mudarModoPos(spread: boolean) {
    setPosSpread(spread)
    setForm({ ...form, rf_percentual_indice: null, rf_taxa_fixa: null })
  }

  // Campo numérico (% a.a. / % do índice): aceita vírgula, guarda número|null.
  function setNum(campo: 'rf_percentual_indice' | 'rf_taxa_fixa', valor: string) {
    const v = valor.replace(',', '.').trim()
    setForm({ ...form, [campo]: v === '' ? null : Number(v) })
  }

  async function salvar() {
    if (!editando && !selecionado && !manualLivre) {
      onToast('Busque e selecione o ativo na lista — ou ative o cadastro manual')
      return
    }
    if (tesouroManual && (!form.rf_indexador || !form.rf_vencimento)) {
      onToast('Escolha o indexador e o vencimento do título')
      return
    }
    // Tesouro manual: ticker/nome saem dos campos estruturados; demais, do form.
    const tickerFinal = (tesouroManual ? tesouroTicker : form.ticker).trim().toUpperCase()
    const nomeFinal   = (tesouroManual ? tesouroNome : form.nome).trim()
    if (!tickerFinal) { onToast('Ticker é obrigatório'); return }
    setSalvando(true)
    const payload: CriarAtivoInput | EditarAtivoInput = {
      ...form,
      ticker: tickerFinal,
      // Nome opcional: se em branco, o backend busca o nome oficial pelo ticker
      nome: nomeFinal,
      descricao: form.descricao?.trim() || null,
      nota_usuario: form.nota_usuario === null || form.nota_usuario === undefined || Number.isNaN(form.nota_usuario)
        ? null : Number(form.nota_usuario),
      // rf_taxa (rótulo) é derivado dos campos estruturados — mantém o detalhe
      // do ativo legível sem depender de texto digitado à mão.
      ...(ehRendaFixa(form.tipo_ativo) ? { rf_taxa: rotuloTaxaRF(form) } : {}),
    }
    const res = editando ? await editar(editando.id, payload) : await criar(payload as CriarAtivoInput)
    setSalvando(false)
    if (res.ok) { onClose(); onToast(editando ? 'Ativo atualizado!' : 'Ativo criado!') }
    else onToast(res.erro ?? 'Erro ao salvar')
  }

  return (
    <Drawer open onClose={onClose}
      titulo={editando ? 'Editar ativo' : 'Novo ativo'}
      subtitulo={editando ? editando.ticker : 'Cadastre um ativo da sua carteira'}
      rodape={<><BtnCancelar onClick={onClose} /><BtnSalvar editando={!!editando} onClick={salvar} salvando={salvando} /></>}>
      {/* 1) Tipo primeiro — define a fonte da busca */}
      <Field label="Tipo de ativo">
        <SelectDark value={form.tipo_ativo} onChange={(e) => mudarTipo(e.target.value as TipoAtivoInvestimento)}>
          {TIPOS_ATIVO_INV.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
        </SelectDark>
      </Field>

      {/* 2) Subtipo / categoria — refina a busca */}
      {form.tipo_ativo === 'RENDA_FIXA' && (
        <Field label="Tipo do título">
          <SelectDark value={form.rf_subtipo ?? ''} onChange={(e) => mudarSubtipoRF(e.target.value as SubtipoRF | '')}>
            <option value="">Selecione...</option>
            {subtiposParaTipo('RENDA_FIXA').map((s) => (
              <option key={s} value={s}>{SUBTIPO_RF_INFO[s].label}</option>
            ))}
          </SelectDark>
        </Field>
      )}
      {form.tipo_ativo === 'FII' && (
        <Field label="Categoria do fundo">
          <SelectDark value={form.fii_categoria ?? ''}
            onChange={(e) => setForm({ ...form, fii_categoria: (e.target.value || null) as CategoriaFII | null })}>
            <option value="">Selecione...</option>
            {CATEGORIAS_FII.map((c) => <option key={c} value={c}>{FII_CATEGORIA_INFO[c].label}</option>)}
          </SelectDark>
          {form.fii_categoria && (
            <div className="text-[12px] space-y-0.5 mt-1" style={{ color: MUTED }}>
              <p><span className="text-white/70">Compra:</span> {FII_CATEGORIA_INFO[form.fii_categoria].compra}</p>
              <p><span className="text-white/70">Fonte de lucro:</span> {FII_CATEGORIA_INFO[form.fii_categoria].fonteLucro}</p>
              <p><span className="text-white/70">Risco:</span> {FII_CATEGORIA_INFO[form.fii_categoria].risco} ·{' '}
                <span className="text-white/70">Vantagem:</span> {FII_CATEGORIA_INFO[form.fii_categoria].vantagem}</p>
            </div>
          )}
        </Field>
      )}
      {form.tipo_ativo === 'ACOES' && (
        <Field label="Subtipo da ação">
          <SelectDark value={form.acoes_subtipo ?? ''}
            onChange={(e) => setForm({ ...form, acoes_subtipo: (e.target.value || null) as AcoesSubtipo | null })}>
            <option value="">Selecione...</option>
            {ACOES_SUBTIPOS.map((s) => <option key={s} value={s}>{ACOES_SUBTIPO_LABEL[s]}</option>)}
          </SelectDark>
          {form.acoes_subtipo && (
            <p className="text-[12px] mt-1" style={{ color: MUTED }}>{ACOES_SUBTIPO_DESCRICAO[form.acoes_subtipo]}</p>
          )}
        </Field>
      )}

      {/* 3) Busca na internet — ticker, nome e preço vêm da lista */}
      {!editando && (
        <div className="rounded-lg border border-white/10 p-3 space-y-2">
          <Field label="Buscar ativo (ticker ou nome)">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
              <Input value={busca} onChange={(e) => { setBusca(e.target.value); setSelecionado(false) }}
                placeholder={form.tipo_ativo === 'TESOURO_DIRETO' ? 'Ex.: IPCA 2029, Selic...' : 'Ex.: PETR, Vale, BTC...'}
                className="!pl-8" />
              {buscando && <RefreshCw size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin" style={{ color: MUTED }} />}
            </div>
          </Field>

          {/* Resultados */}
          {buscaDeb.length >= 2 && !buscando && !selecionado && (
            resultados.length === 0 && !erroBusca ? (
              <p className="text-[12px]" style={{ color: MUTED }}>Nada encontrado para "{buscaDeb}".</p>
            ) : (
              <div className="max-h-52 overflow-y-auto space-y-1">
                {resultados.map((r) => (
                  <button key={`${r.ticker}-${r.nome}`} type="button" onClick={() => selecionarResultado(r)}
                    className="w-full text-left px-2.5 py-1.5 rounded-md border border-white/10 hover:border-blue-400/50 hover:bg-blue-500/10 flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="text-white text-[13px] font-semibold">{r.ticker}</span>
                      <span className="text-[12px] ml-2 truncate" style={{ color: MUTED }}>{r.nome}</span>
                    </span>
                    {r.preco != null && (
                      <span className="text-[12px] shrink-0" style={{ color: '#00c896' }}>{formatBRL(r.preco)}</span>
                    )}
                  </button>
                ))}
              </div>
            )
          )}

          {erroBusca && (
            <p className="text-[12px]" style={{ color: '#ffb74d' }}>
              {erroBusca} — você pode cadastrar manualmente abaixo.
            </p>
          )}

          {/* Selecionado */}
          {selecionado && form.ticker && (
            <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-white text-[13px] font-semibold">{form.ticker}
                  {precoSel != null && <span className="ml-2 font-normal" style={{ color: '#00c896' }}>{formatBRL(precoSel)}</span>}
                </p>
                <p className="text-[12px] truncate" style={{ color: MUTED }}>{form.nome}</p>
              </div>
              <button type="button" onClick={() => { setSelecionado(false); setForm({ ...form, ticker: '', nome: '' }); setPrecoSel(null) }}
                className="text-[12px] shrink-0 underline" style={{ color: MUTED }}>trocar</button>
            </div>
          )}

          {!selecionado && (
            <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: MUTED }}>
              <input type="checkbox" checked={manualLivre} onChange={(e) => setManualLivre(e.target.checked)} />
              {form.tipo_ativo === 'TESOURO_DIRETO'
                ? 'Não está na lista — cadastrar pelos campos do título'
                : 'Não encontrei — cadastrar manualmente'}
            </label>
          )}
        </div>
      )}

      {/* 4) Identificação — preenchida pela busca (editável só no manual).
          No Tesouro manual o identificador é GERADO dos campos do título
          (indexador + vencimento + semestral) lá embaixo — nada de digitar. */}
      {tesouroManual ? (
        <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
          {tesouroTicker ? (
            <>
              <p className="text-white text-[13px] font-semibold">{tesouroTicker}</p>
              <p className="text-[12px]" style={{ color: MUTED }}>{tesouroNome}</p>
            </>
          ) : (
            <p className="text-[12px]" style={{ color: MUTED }}>
              Escolha o indexador e o vencimento em "Características do título" abaixo —
              o código e o nome são preenchidos automaticamente.
            </p>
          )}
        </div>
      ) : (editando || manualLivre || selecionado) && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ticker">
              <Input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })}
                placeholder="Ex.: VALE3" maxLength={20} disabled={!editando && !manualLivre} />
            </Field>
            <Field label="Moeda">
              <Input value={form.moeda} onChange={(e) => setForm({ ...form, moeda: e.target.value.toUpperCase() })} maxLength={3} placeholder="BRL" />
            </Field>
          </div>
          <Field label="Nome (opcional — busca automática pelo ticker)">
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Deixe em branco para buscar pelo ticker" maxLength={120} disabled={!editando && !manualLivre} />
          </Field>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Nota (0–10)">
          <Input type="number" min={0} max={10} step={0.5}
            value={form.nota_usuario ?? ''}
            onChange={(e) => setForm({ ...form, nota_usuario: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="—" />
        </Field>
        <Field label="Descrição">
          <Input value={form.descricao ?? ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Opcional" />
        </Field>
      </div>

      {/* Busca automática de cotação — desligue para ativos sem fonte gratuita */}
      <label className="flex items-start gap-2 text-[13px] cursor-pointer rounded-lg border border-white/10 p-3">
        <input type="checkbox" className="mt-0.5"
          checked={form.cotacao_automatica !== false}
          onChange={(e) => setForm({ ...form, cotacao_automatica: e.target.checked })} />
        <span>
          <span className="text-white">Buscar cotação automaticamente</span>
          <span className="block text-[12px] mt-0.5" style={{ color: MUTED }}>
            Desligue para ativos sem fonte gratuita (ex.: FIIs pequenos, papéis deslistados).
            Ele sai das atualizações automáticas e do aviso de lacuna — você lança o valor manualmente.
          </span>
        </span>
      </label>

      {/* Características de renda fixa / Tesouro Direto */}
      {ehRendaFixa(form.tipo_ativo) && (
        <div className="rounded-lg border border-white/10 p-3 space-y-3">
          <p className="text-[13px] font-semibold text-white">Características do título</p>

          <Field label={form.tipo_ativo === 'TESOURO_DIRETO' ? 'Indexador' : 'Forma de rentabilidade'}>
            <SelectDark value={form.rf_indexador ?? ''}
              onChange={(e) => mudarIndexador((e.target.value || null) as IndexadorRF | null)}>
              <option value="">Selecione...</option>
              {INDEXADORES_RF.map((i) => (
                <option key={i} value={i}>
                  {form.tipo_ativo === 'TESOURO_DIRETO' ? INDEXADOR_TESOURO_LABEL[i] : INDEXADOR_RF_LABEL[i]}
                </option>
              ))}
            </SelectDark>
            {form.rf_indexador && (
              <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                {INDEXADOR_RF_DESCRICAO[form.rf_indexador]}
              </p>
            )}
          </Field>

          {/* Tesouro: Prefixado (NTN-F) e IPCA+ (NTN-B) têm versão com juros
              semestrais — entra no ticker/nome e escolhe a série de MtM certa. */}
          {form.tipo_ativo === 'TESOURO_DIRETO' &&
            (form.rf_indexador === 'PREFIXADO' || form.rf_indexador === 'HIBRIDO') && (
            <label className="flex items-center gap-2 text-[13px] text-white/80 cursor-pointer">
              <input type="checkbox" checked={tesouroSemestral}
                onChange={(e) => setTesouroSemestral(e.target.checked)} />
              Com juros semestrais
            </label>
          )}

          {/* Índice de referência — só para pós-fixado (CDI/Selic) e híbrido
              (IPCA/IGP-M). É o que permite calcular o rendimento. */}
          {(form.rf_indexador === 'POS_FIXADO' || form.rf_indexador === 'HIBRIDO') && (
            <Field label="Índice de referência">
              <SelectDark value={form.rf_indice ?? ''}
                onChange={(e) => setForm({ ...form, rf_indice: (e.target.value || null) as IndiceRF | null })}>
                <option value="">Selecione...</option>
                {INDICES_POR_INDEXADOR[form.rf_indexador].map((i) => (
                  <option key={i} value={i}>{INDICE_RF_LABEL[i]}</option>
                ))}
              </SelectDark>
            </Field>
          )}

          {/* Pós-fixado: "110% do CDI" e "CDI + 2%" rendem diferente — escolher qual */}
          {form.rf_indexador === 'POS_FIXADO' && (
            <Field label="Tipo de taxa">
              <SelectDark value={posSpread ? 'SPREAD' : 'PERCENTUAL'}
                onChange={(e) => mudarModoPos(e.target.value === 'SPREAD')}>
                <option value="PERCENTUAL">Percentual do índice (ex.: 110% do CDI)</option>
                <option value="SPREAD">Índice + taxa (ex.: CDI + 2%)</option>
              </SelectDark>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            {form.rf_indexador === 'POS_FIXADO' ? (
              posSpread ? (
                <Field label="Spread (+ % a.a.)">
                  <Input type="number" step="0.01" inputMode="decimal"
                    value={form.rf_taxa_fixa ?? ''}
                    onChange={(e) => setNum('rf_taxa_fixa', e.target.value)}
                    placeholder="2" />
                </Field>
              ) : (
                <Field label="% do índice">
                  <Input type="number" step="0.01" inputMode="decimal"
                    value={form.rf_percentual_indice ?? ''}
                    onChange={(e) => setNum('rf_percentual_indice', e.target.value)}
                    placeholder="110" />
                </Field>
              )
            ) : (
              <Field label={form.rf_indexador === 'HIBRIDO' ? 'Taxa fixa adicional (% a.a.)' : 'Taxa fixa (% a.a.)'}>
                <Input type="number" step="0.01" inputMode="decimal"
                  value={form.rf_taxa_fixa ?? ''}
                  onChange={(e) => setNum('rf_taxa_fixa', e.target.value)}
                  placeholder={form.rf_indexador === 'HIBRIDO' ? '6,2' : '13,5'} />
              </Field>
            )}
            {tesouroManual && vencimentosTesouro.length > 0 ? (
              <Field label="Vencimento">
                <SelectDark value={form.rf_vencimento ?? ''}
                  onChange={(e) => setForm({ ...form, rf_vencimento: e.target.value || null })}>
                  <option value="">Selecione...</option>
                  {vencimentosTesouro.map((v) => (
                    <option key={v} value={v}>{anoVencimento(v)} ({v.split('-').reverse().join('/')})</option>
                  ))}
                </SelectDark>
              </Field>
            ) : (
              <Field label="Vencimento">
                <Input type="date" value={form.rf_vencimento ?? ''}
                  onChange={(e) => setForm({ ...form, rf_vencimento: e.target.value || null })} />
              </Field>
            )}
          </div>

          <Field label="Emissor">
            <Input value={form.rf_emissor ?? ''} maxLength={80}
              onChange={(e) => setForm({ ...form, rf_emissor: e.target.value || null })}
              placeholder={form.rf_subtipo ? SUBTIPO_RF_INFO[form.rf_subtipo].emissor : 'Banco / empresa'} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-[13px] text-white/80 cursor-pointer">
              <input type="checkbox" checked={form.rf_garantia_fgc ?? false}
                onChange={(e) => setForm({ ...form, rf_garantia_fgc: e.target.checked })} />
              Garantia do FGC
            </label>
            <label className="flex items-center gap-2 text-[13px] text-white/80 cursor-pointer">
              <input type="checkbox" checked={form.rf_isento_ir ?? false}
                onChange={(e) => setForm({ ...form, rf_isento_ir: e.target.checked })} />
              Isento de IR
            </label>
          </div>
          {form.rf_subtipo && (
            <p className="text-[12px]" style={{ color: MUTED }}>
              {SUBTIPO_RF_INFO[form.rf_subtipo].label}: {SUBTIPO_RF_INFO[form.rf_subtipo].obsIR}
              {form.rf_subtipo === 'TESOURO' && ' · sem FGC (garantia soberana do Governo Federal)'}
              {SUBTIPO_RF_INFO[form.rf_subtipo].fgc && ' · FGC cobre até R$ 250 mil por CPF/instituição'}
            </p>
          )}
        </div>
      )}

    </Drawer>
  )
}
