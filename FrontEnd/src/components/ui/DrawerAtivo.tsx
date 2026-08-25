import { useState, useEffect, useMemo, useRef } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import {
  useInvestimentosAtivos, useBuscaAtivoExterno,
  type CriarAtivoInput,
} from '../../hooks/useInvestimentosAtivos'
import { useInvestimentosOperacoes } from '../../hooks/useInvestimentosOperacoes'
import { useBackfillHistorico } from '../../hooks/useInvestimentosHistorico'
import { useContas } from '../../hooks/useContas'
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
  tipoEntradaPara,
} from '../../lib/constants'
import type {
  InvestimentoAtivo, TipoAtivoInvestimento, SubtipoRF, IndexadorRF, IndiceRF, CategoriaFII,
  AcoesSubtipo, ResultadoBuscaAtivo,
} from '../../types'

const MUTED = '#8b92a8'

// O tipo de ativo é o 1º campo e é obrigatório — começa vazio para forçar a
// escolha antes de revelar o restante do formulário (que se adapta ao tipo).
type FormAtivo = Omit<CriarAtivoInput, 'tipo_ativo'> & { tipo_ativo: TipoAtivoInvestimento | '' }

const FORM_VAZIO: FormAtivo = {
  ticker: '', nome: '', tipo_ativo: '', moeda: 'BRL', descricao: '', nota_usuario: null,
  rf_subtipo: null, rf_indexador: null, rf_indice: null, rf_percentual_indice: null,
  rf_taxa_fixa: null, rf_taxa: null, rf_emissor: null,
  rf_vencimento: null, rf_garantia_fgc: null, rf_isento_ir: null,
  fii_categoria: null, acoes_subtipo: null, cripto_rendimento_aa: null,
  cripto_rendimento_inicio: null, cripto_rendimento_periodicidade: null, cotacao_automatica: true,
}

const ehRendaFixa = (tipo: TipoAtivoInvestimento | '') => tipo === 'RENDA_FIXA' || tipo === 'TESOURO_DIRETO'

// Renda fixa privada (CDB/LCI/LCA/CRI/CRA/Debênture) não tem preço unitário
// real — é sempre um valor aplicado. Diferente do Tesouro Direto, que tem
// título com PU marcado a mercado (quantidade fracionária de verdade).
// Convenção: quantidade = valor aplicado, preco_unitario = 1.
const ehRFSemQtde = (tipo: TipoAtivoInvestimento | '') => tipo === 'RENDA_FIXA'

const COMPRA_VAZIA = { conta_id: '', quantidade: '', preco_unitario: '', data: new Date().toISOString().split('T')[0] }

// Subtipo da ação derivado do sufixo do ticker B3 (3=ON, 4/5/6=PN, 11=Unit,
// 31–39=BDR). Retorna null quando não dá para inferir.
function subtipoAcaoDoTicker(ticker: string): AcoesSubtipo | null {
  const m = ticker.trim().toUpperCase().match(/(\d{1,2})$/)
  if (!m) return null
  const n = m[1]
  if (n === '11') return 'UNIT'
  if (n === '3') return 'ON'
  if (['4', '5', '6', '7', '8'].includes(n)) return 'PN'
  if (/^3[1-9]$/.test(n)) return 'BDR'
  return null
}

// Identificador (ticker) gerado para renda fixa privada (CDB/LCI/LCA/...), que
// não tem código de bolsa. Combina subtipo + emissor + ano de vencimento +
// taxa, em até 20 chars (limite da coluna). Ex.: CDB-SOFISA-27-110CDI.
function gerarTickerRF(f: FormAtivo): string {
  const limpa = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const sub  = limpa(f.rf_subtipo) || 'RF'
  const emi  = (limpa(f.rf_emissor) || limpa(f.nome)).slice(0, 8) || 'RF'
  const ano  = f.rf_vencimento ? f.rf_vencimento.slice(2, 4) : ''
  const taxa = limpa(f.rf_taxa).slice(0, 6)
  let cod = `${sub}-${emi}`
  if (ano) cod += `-${ano}`
  if (taxa && cod.length + 1 + taxa.length <= 20) cod += `-${taxa}`
  return cod.slice(0, 20)
}

// Rótulo amigável derivado dos campos estruturados (ex.: "110% CDI",
// "IPCA + 6,2%", "13,5% a.a.") — gravado em rf_taxa para exibição.
function rotuloTaxaRF(f: FormAtivo): string | null {
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
function formDoAtivo(ativo: InvestimentoAtivo | null): FormAtivo {
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
    cripto_rendimento_aa: ativo.cripto_rendimento_aa,
    cripto_rendimento_inicio: ativo.cripto_rendimento_inicio,
    cripto_rendimento_periodicidade: ativo.cripto_rendimento_periodicidade,
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
  const [form, setForm] = useState<FormAtivo>(() => formDoAtivo(ativo))
  const [salvando, setSalvando] = useState(false)

  // Busca externa (ticker → nome/preço/características)
  const [busca, setBusca] = useState('')
  const [buscaDeb, setBuscaDeb] = useState('')
  const [selecionado, setSelecionado] = useState(!!ativo)  // edição já tem nome definido
  // Item destacado na lista de resultados p/ navegação por teclado (↑/↓ +
  // Enter). Zera sempre que a lista muda (nova busca ou digitação nova).
  const [destaqueIdx, setDestaqueIdx] = useState(0)
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([])
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
  const { criar: criarOperacao } = useInvestimentosOperacoes()
  const { preencher } = useBackfillHistorico()
  const { contas } = useContas()
  const contasInvest = useMemo(() => contas.filter((c) => c.tipo === 'INVESTIMENTO' && c.ativa), [contas])

  // Compra inicial opcional — ao criar um ativo novo, já registra a 1ª compra
  // (que cria a posição). Só aparece no modo de criação.
  const [compra, setCompra] = useState(COMPRA_VAZIA)

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

  const { resultados, buscando, erroBusca } = useBuscaAtivoExterno(
    form.tipo_ativo || 'ACOES', form.tipo_ativo && !editando ? buscaDeb : '')

  // Mantém o item destacado (↑/↓) visível dentro do container com scroll —
  // sem isso o destaque passa a existir fora da área rolada e "some da tela".
  useEffect(() => {
    itemsRef.current[destaqueIdx]?.scrollIntoView({ block: 'nearest' })
  }, [destaqueIdx, resultados])

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
    // Tesouro: "com Juros Semestrais" não vem como campo próprio da busca —
    // deriva do nome oficial (mesma heurística usada ao editar um ativo já
    // cadastrado), senão o checkbox fica sempre desmarcado ao escolher um
    // resultado, mesmo pra títulos NTN-F/NTN-B com cupom semestral.
    if (r.indexador) setTesouroSemestral(ehSemestral(r.nome))
    setPrecoSel(r.preco)
    if (r.preco != null) setCompra((c) => ({ ...c, preco_unitario: String(r.preco) }))
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
    // Tipo de ativo é obrigatório e define todo o resto do formulário.
    if (!form.tipo_ativo) { onToast('Selecione o tipo de ativo'); return }
    if (!editando && !selecionado && !manualLivre) {
      onToast('Busque e selecione o ativo na lista — ou ative o cadastro manual')
      return
    }
    if (tesouroManual && (!form.rf_indexador || !form.rf_vencimento)) {
      onToast('Escolha o indexador e o vencimento do título')
      return
    }
    // Identificador: Tesouro manual gera dos campos do título; renda fixa
    // privada (CDB/LCI/...) gera de emissor+venc+taxa (sem campo ticker); demais
    // vêm do form. Na edição de RF o ticker já existente é preservado.
    const tickerFinal = tesouroManual
      ? tesouroTicker.trim().toUpperCase()
      : (!editando && form.tipo_ativo === 'RENDA_FIXA')
        ? gerarTickerRF(form)
        : form.ticker.trim().toUpperCase()
    const nomeFinal   = (tesouroManual ? tesouroNome : form.nome).trim()
    if (!editando && form.tipo_ativo === 'RENDA_FIXA' && !form.rf_emissor && !nomeFinal) {
      onToast('Informe o nome ou o emissor do título'); return
    }
    if (!tickerFinal) { onToast('Ticker é obrigatório'); return }

    // Movimentação inicial (opcional, só na criação). Renda fixa/Tesouro usa
    // "aplicação"; bolsa usa "compra".
    const ehRF = ehRendaFixa(form.tipo_ativo)
    const termo = ehRF ? 'aplicação' : 'compra'
    const querCompra = !editando &&
      (compra.conta_id !== '' || compra.quantidade !== '' || compra.preco_unitario !== '')
    const rfSemQtde = ehRFSemQtde(form.tipo_ativo)
    if (querCompra) {
      if (!compra.conta_id) { onToast(`Selecione a conta da ${termo} inicial`); return }
      if (!(Number(compra.quantidade) > 0)) {
        onToast(rfSemQtde ? 'Valor aplicado inválido' : `Quantidade da ${termo} inválida`); return
      }
      if (!rfSemQtde && !(Number(compra.preco_unitario) >= 0)) { onToast(`Preço da ${termo} inválido`); return }
    }

    setSalvando(true)
    const payload: CriarAtivoInput = {
      ...form,
      tipo_ativo: form.tipo_ativo,
      ticker: tickerFinal,
      // Nome opcional: se em branco, o backend busca o nome oficial pelo ticker
      nome: nomeFinal,
      descricao: form.descricao?.trim() || null,
      nota_usuario: form.nota_usuario === null || form.nota_usuario === undefined || Number.isNaN(form.nota_usuario)
        ? null : Number(form.nota_usuario),
      // rf_taxa (rótulo) é derivado dos campos estruturados — mantém o detalhe
      // do ativo legível sem depender de texto digitado à mão.
      ...(ehRF ? { rf_taxa: rotuloTaxaRF(form) } : {}),
      // Subtipo da ação é inferido do ticker (ON/PN/Unit/BDR) — sem campo manual.
      ...(form.tipo_ativo === 'ACOES'
        ? { acoes_subtipo: form.acoes_subtipo ?? subtipoAcaoDoTicker(tickerFinal) }
        : {}),
      // Rendimento só faz sentido p/ cripto — zera nos demais tipos.
      ...(form.tipo_ativo !== 'CRIPTOMOEDAS'
        ? { cripto_rendimento_aa: null, cripto_rendimento_inicio: null, cripto_rendimento_periodicidade: null }
        : {}),
    }
    const res = editando ? await editar(editando.id, payload) : await criar(payload)
    if (!res.ok) { setSalvando(false); onToast(res.erro ?? 'Erro ao salvar'); return }

    // Registra a movimentação inicial (cria a posição via operação) e reconstrói
    // o histórico de renda fixa a partir dela.
    if (querCompra && res.dados?.id) {
      const q = Number(compra.quantidade), p = rfSemQtde ? 1 : Number(compra.preco_unitario)
      const opRes = await criarOperacao({
        ativo_id: res.dados.id, conta_id: compra.conta_id, tipo_operacao: tipoEntradaPara(form.tipo_ativo),
        quantidade: q, preco_unitario: p, valor_total: q * p, data_operacao: compra.data,
      })
      setSalvando(false)
      if (!opRes.ok) { onClose(); onToast(`Ativo criado, mas falha ao registrar a ${termo}: ${opRes.erro ?? ''}`); return }
      preencher({ ativo_id: res.dados.id })
      onClose(); onToast(`Ativo criado e ${termo} registrada!`)
      return
    }

    setSalvando(false)
    onClose(); onToast(editando ? 'Ativo atualizado!' : 'Ativo criado!')
  }

  return (
    <Drawer open onClose={onClose}
      titulo={editando ? 'Editar ativo' : 'Novo ativo'}
      subtitulo={editando ? editando.ticker : 'Cadastre um ativo da sua carteira'}
      rodape={<><BtnCancelar onClick={onClose} /><BtnSalvar editando={!!editando} onClick={salvar} salvando={salvando} /></>}>
      {/* 1) Tipo primeiro — obrigatório; o restante do formulário se adapta a ele */}
      <Field label="Tipo de ativo">
        <SelectDark value={form.tipo_ativo} onChange={(e) => e.target.value && mudarTipo(e.target.value as TipoAtivoInvestimento)}>
          <option value="" disabled>Selecione o tipo...</option>
          {TIPOS_ATIVO_INV.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
        </SelectDark>
      </Field>

      {form.tipo_ativo === '' ? (
        <p className="text-[13px] py-2" style={{ color: MUTED }}>
          Escolha o tipo de ativo para continuar o cadastro.
        </p>
      ) : (<>

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
        <Field label="Categoria do fundo (opcional)">
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
      {form.tipo_ativo === 'CRIPTOMOEDAS' && (
        <Field label="Rendimento anual (% a.a.) — opcional">
          <Input type="number" step="0.01" min="0" value={form.cripto_rendimento_aa ?? ''}
            onChange={(e) => setForm({ ...form, cripto_rendimento_aa: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="Ex.: 3.5 (USDC com yield)" />
          <p className="text-[12px] mt-1" style={{ color: MUTED }}>
            Yield creditado em mais tokens (não é provento). Depois clique em
            "Provisionar rendimento" para gerar os créditos na posição.
          </p>
        </Field>
      )}
      {form.tipo_ativo === 'CRIPTOMOEDAS' && Number(form.cripto_rendimento_aa) > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rende desde (opcional)">
            <Input type="date" value={form.cripto_rendimento_inicio ?? ''}
              onChange={(e) => setForm({ ...form, cripto_rendimento_inicio: e.target.value || null })} />
            <p className="text-[12px] mt-1" style={{ color: MUTED }}>Vazio = desde o 1º aporte.</p>
          </Field>
          <Field label="Periodicidade">
            <SelectDark value={form.cripto_rendimento_periodicidade ?? 'MENSAL'}
              onChange={(e) => setForm({ ...form, cripto_rendimento_periodicidade: e.target.value as 'DIARIA' | 'SEMANAL' | 'MENSAL' })}>
              <option value="DIARIA">Diária</option>
              <option value="SEMANAL">Semanal</option>
              <option value="MENSAL">Mensal</option>
            </SelectDark>
            <p className="text-[12px] mt-1" style={{ color: MUTED }}>Base de composição (crédito materializado por semana).</p>
          </Field>
        </div>
      )}
      {/* Subtipo da ação (ON/PN/Unit/BDR) é inferido do ticker — sem campo manual. */}

      {/* 3) Busca na internet — ticker, nome e preço vêm da lista */}
      {!editando && (
        <div className="rounded-lg border border-white/10 p-3 space-y-2">
          <Field label="Buscar ativo (ticker ou nome)">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
              <Input value={busca}
                onChange={(e) => { setBusca(e.target.value); setSelecionado(false); setDestaqueIdx(0) }}
                onKeyDown={(e) => {
                  if (resultados.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setDestaqueIdx((i) => Math.min(i + 1, resultados.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setDestaqueIdx((i) => Math.max(i - 1, 0))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    const r = resultados[destaqueIdx]
                    if (r) selecionarResultado(r)
                  }
                }}
                placeholder={form.tipo_ativo === 'TESOURO_DIRETO' ? 'Ex.: IPCA 2029, Selic...' : 'Ex.: PETR, Vale, BTC...'}
                className="!pl-8" />
              {buscando && <RefreshCw size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin" style={{ color: MUTED }} />}
            </div>
          </Field>

          {/* Resultados — navegáveis com ↑/↓ (destaque) + Enter (seleciona) */}
          {buscaDeb.length >= 2 && !buscando && !selecionado && (
            resultados.length === 0 && !erroBusca ? (
              <p className="text-[12px]" style={{ color: MUTED }}>Nada encontrado para "{buscaDeb}".</p>
            ) : (
              <div className="max-h-52 overflow-y-auto space-y-1">
                {resultados.map((r, i) => (
                  <button key={`${r.ticker}-${r.nome}`} type="button" onClick={() => selecionarResultado(r)}
                    ref={(el) => { itemsRef.current[i] = el }}
                    onMouseEnter={() => setDestaqueIdx(i)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md border flex items-center justify-between gap-2 ${
                      i === destaqueIdx ? 'border-blue-400/60 bg-blue-500/15' : 'border-white/10 hover:border-blue-400/50 hover:bg-blue-500/10'
                    }`}>
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
          {/* Moeda vem automaticamente do ticker (busca) ou do padrão do tipo — sem campo manual.
              Renda fixa privada não tem ticker: o identificador é gerado ao salvar. */}
          {form.tipo_ativo !== 'RENDA_FIXA' && (
            <Field label="Ticker">
              <Input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })}
                placeholder="Ex.: VALE3" maxLength={20} disabled={!editando && !manualLivre} />
            </Field>
          )}
          <Field label={form.tipo_ativo === 'RENDA_FIXA'
            ? 'Nome do título'
            : 'Nome (opcional — busca automática pelo ticker)'}>
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Deixe em branco para buscar pelo ticker" maxLength={120} disabled={!editando && !manualLivre} />
          </Field>
        </>
      )}

      <Field label="Nota (0–10)">
        <Input type="number" min={0} max={10} step={0.5}
          value={form.nota_usuario ?? ''}
          onChange={(e) => setForm({ ...form, nota_usuario: e.target.value === '' ? null : Number(e.target.value) })}
          placeholder="—" />
      </Field>

      {/* Busca automática de cotação — não se aplica a renda fixa/Tesouro, cujo
          valor é derivado do indexador/taxa (não vem de cotação de mercado) */}
      {!ehRendaFixa(form.tipo_ativo) && (
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
      )}

      {/* Primeira movimentação — opcional, só na criação (cria a posição).
          Renda fixa/Tesouro = "aplicação"; bolsa = "compra". */}
      {!editando && (
        <div className="rounded-lg border border-white/10 p-3 space-y-3">
          <p className="text-[13px] font-semibold text-white">
            {ehRendaFixa(form.tipo_ativo) ? 'Primeira aplicação' : 'Primeira compra'}{' '}
            <span className="font-normal" style={{ color: MUTED }}>(opcional)</span>
          </p>
          <Field label="Conta">
            <SelectDark value={compra.conta_id} onChange={(e) => setCompra({ ...compra, conta_id: e.target.value })}>
              <option value="">Não registrar agora</option>
              {contasInvest.map((c) => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
            </SelectDark>
          </Field>
          {ehRFSemQtde(form.tipo_ativo) ? (
            <Field label="Valor aplicado">
              <Input type="number" min={0} step="any" value={compra.quantidade}
                onChange={(e) => setCompra({ ...compra, quantidade: e.target.value })} placeholder="0,00" />
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantidade">
                <Input type="number" min={0} step="any" value={compra.quantidade}
                  onChange={(e) => setCompra({ ...compra, quantidade: e.target.value })} placeholder="0" />
              </Field>
              <Field label="Preço unitário">
                <Input type="number" min={0} step="any" value={compra.preco_unitario}
                  onChange={(e) => setCompra({ ...compra, preco_unitario: e.target.value })} placeholder="0,00" />
              </Field>
            </div>
          )}
          <Field label={ehRendaFixa(form.tipo_ativo) ? 'Data da aplicação' : 'Data da compra'}>
            <Input type="date" value={compra.data} onChange={(e) => setCompra({ ...compra, data: e.target.value })} />
          </Field>
          {!ehRFSemQtde(form.tipo_ativo) && (
            <div className="flex items-center justify-between text-[12px]" style={{ color: MUTED }}>
              <span>Valor total</span>
              <span className="text-white font-medium">
                {formatBRL((Number(compra.quantidade) || 0) * (Number(compra.preco_unitario) || 0))}
              </span>
            </div>
          )}
        </div>
      )}

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

          {/* items-end: o rótulo de "Taxa fixa adicional (% a.a.)" quebra em
              2 linhas (mais longo que "Vencimento"), o que empurrava só
              aquele campo pra baixo — alinhando pela base, os dois inputs
              ficam na mesma altura independente de quantas linhas o rótulo
              de cada um ocupa. */}
          <div className="grid grid-cols-2 gap-3 items-end">
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

      </>)}

    </Drawer>
  )
}
