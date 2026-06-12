// src/lib/importB3.ts
// ============================================================
// Parsing dos relatórios da B3 (área do investidor) para o import
// de investimentos:
//   • posicao-*.xlsx     → ativos + posições + valor de mercado
//   • movimentacao-*.xlsx → operações (compra/venda) + proventos
//
// Funções puras (recebem o workbook já lido pelo SheetJS). A
// ImportExportPage faz a leitura do arquivo e a resolução
// Instituição → conta_id; aqui só interpretamos as planilhas.
//
// Princípio: a POSIÇÃO é a fonte da verdade da quantidade atual e do
// valor de mercado; o EXTRATO fornece o custo (média das compras), o
// histórico e os proventos. Tudo é chaveado por (ticker, instituição).
// ============================================================
import type {
  TipoAtivoInvestimento, SubtipoRF, IndexadorRF, TipoOperacaoInvestimento,
  AcoesSubtipo, CategoriaFII,
} from './constants'

// Tipo mínimo do SheetJS que usamos (evita depender do CDN nos tipos)
export interface XlsxLike {
  SheetNames: string[]
  Sheets: Record<string, unknown>
}
interface XlsxUtils {
  sheet_to_json: (ws: unknown, opts?: Record<string, unknown>) => Record<string, unknown>[]
}

// ── Modelos ──────────────────────────────────────────────────────
export interface AtivoB3 {
  ticker: string
  nome: string
  tipo_ativo: TipoAtivoInvestimento
  moeda: string
  rf_subtipo?: SubtipoRF | null
  rf_indexador?: IndexadorRF | null
  rf_emissor?: string | null
  rf_vencimento?: string | null
  fii_categoria?: string | null
  acoes_subtipo?: AcoesSubtipo | null
}

export interface PosicaoB3 extends AtivoB3 {
  instituicao: string
  quantidade: number
  valor_mercado: number
  preco_fechamento: number
  /** custo provisório quando não há compras no extrato (Tesouro: Valor Aplicado) */
  custo_fallback: number
}

export type AcaoMov = TipoOperacaoInvestimento | 'IGNORAR'

export interface MovB3 {
  data: string            // YYYY-MM-DD
  movimentacao: string    // texto original
  entradaSaida: 'Credito' | 'Debito'
  ticker: string
  nome: string
  instituicao: string
  quantidade: number
  preco: number
  valor: number           // 0 quando '-'
  temValor: boolean
  acao: AcaoMov
  /** nome do tipo de provento sugerido (quando acao === 'DIVIDENDO') */
  tipoProvento?: string
  /** tipo de ativo quando a fonte informa (ex.: Status Invest tem "Categoria") */
  tipoAtivo?: TipoAtivoInvestimento
  /** subtipo da ação quando a fonte informa (ex.: BDR) */
  acoesSubtipo?: AcoesSubtipo | null
}

// Heurística de tipo a partir do ticker (fallback quando a fonte não informa)
export function tipoPadraoTicker(ticker: string): TipoAtivoInvestimento {
  const t = ticker.toUpperCase()
  if (/^(TESOURO|IPCA|SELIC|PREFIXADO|RENDA|EDUCA)/.test(t)) return 'TESOURO_DIRETO'
  if (/^(CDB|LCI|LCA|CRI|CRA|LC|LF|DEB)/.test(t)) return 'RENDA_FIXA'
  if (/(32|33|34|35)$/.test(t)) return 'ACOES'    // BDR (subtipo de Ações)
  if (/11$/.test(t)) return 'FII'
  return 'ACOES'
}

// Subtipo da ação pelo sufixo do ticker (convenção B3):
//   3 = ON · 4/5/6/7/8 = PN (classes preferenciais) · 11 = Unit ·
//   31/32/33/34/35/39 = BDR
export function acoesSubtipoPorTicker(ticker: string): AcoesSubtipo | null {
  const t = ticker.toUpperCase()
  if (/(31|32|33|34|35|39)$/.test(t)) return 'BDR'
  if (/11$/.test(t)) return 'UNIT'
  if (/3$/.test(t)) return 'ON'
  if (/[4-8]$/.test(t)) return 'PN'
  return null
}

// Segmento dos FIIs mais comuns da B3 (não há regra pelo ticker). Curado;
// FIIs fora da lista caem em 'OUTRO' (editável no cadastro).
const FII_SEGMENTO: Record<string, CategoriaFII> = {
  // Papel (CRI / crédito imobiliário)
  MXRF11: 'PAPEL', KNCR11: 'PAPEL', KNIP11: 'PAPEL', KNHY11: 'PAPEL', KNCA11: 'PAPEL',
  CPTS11: 'PAPEL', IRDM11: 'PAPEL', RBRR11: 'PAPEL', RBRY11: 'PAPEL', VGIR11: 'PAPEL',
  HGCR11: 'PAPEL', DEVA11: 'PAPEL', CVBI11: 'PAPEL', VRTA11: 'PAPEL', HCTR11: 'PAPEL',
  OUJP11: 'PAPEL', MCCI11: 'PAPEL', BTCI11: 'PAPEL', RECR11: 'PAPEL', VCJR11: 'PAPEL',
  // Tijolo (imóveis físicos)
  XPLG11: 'TIJOLO', XPML11: 'TIJOLO', INLG11: 'TIJOLO', GARE11: 'TIJOLO', KORE11: 'TIJOLO',
  KNRI11: 'TIJOLO', HGLG11: 'TIJOLO', HGRE11: 'TIJOLO', HGRU11: 'TIJOLO', VISC11: 'TIJOLO',
  VILG11: 'TIJOLO', PVBI11: 'TIJOLO', HSML11: 'TIJOLO', VINO11: 'TIJOLO', BTLG11: 'TIJOLO',
  BRCO11: 'TIJOLO', LVBI11: 'TIJOLO', RBRP11: 'TIJOLO', TRXF11: 'TIJOLO', MALL11: 'TIJOLO',
  RCRB11: 'TIJOLO', ALZR11: 'TIJOLO', BLMG11: 'TIJOLO', GTWR11: 'TIJOLO',
  // FoF (fundo de fundos)
  CPFF11: 'FOF', BCFF11: 'FOF', HFOF11: 'FOF', RBRF11: 'FOF', KFOF11: 'FOF',
  MGFF11: 'FOF', BPFF11: 'FOF', VGRI11: 'FOF',
}
export function fiiCategoriaPorTicker(ticker: string): CategoriaFII {
  return FII_SEGMENTO[ticker.toUpperCase()] ?? 'OUTRO'
}

// ── Helpers numéricos / datas ────────────────────────────────────
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v ?? '').trim()
  if (!s || s === '-') return 0
  // B3 exporta com ponto decimal; tolera vírgula por segurança
  const limpo = s.replace(/[^\d,.-]/g, '')
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpo)) return parseFloat(limpo.replace(/\./g, '').replace(',', '.')) || 0
  return parseFloat(limpo.replace(',', '.')) || 0
}
function temNumero(v: unknown): boolean {
  if (typeof v === 'number') return true
  const s = String(v ?? '').trim()
  return s !== '' && s !== '-'
}
/** "DD/MM/AAAA" → "AAAA-MM-DD". Aceita Date e ISO. */
export function dmyToYmd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().split('T')[0]
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return ''
}

// ── Acesso às planilhas (chaves normalizadas) ────────────────────
function normalizarChave(k: string): string {
  return k.toLowerCase().trim()
}
function linhas(XLSX: XlsxUtils, wb: XlsxLike, nome: string): Record<string, unknown>[] {
  const ws = wb.Sheets[nome]
  if (!ws) return []
  return XLSX.sheet_to_json(ws, { defval: '' }).map((obj: Record<string, unknown>) => {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) o[normalizarChave(k)] = obj[k]
    return o
  })
}
function pick(r: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]
  return ''
}

// ── Detecção do tipo de arquivo ──────────────────────────────────
const ABAS_POSICAO = ['acoes', 'ações', 'bdr', 'etf', 'fundo de investimento', 'renda fixa', 'tesouro direto', 'empréstimos', 'emprestimos']

// Cabeçalho (primeira linha) de uma planilha, em minúsculas.
function cabecalho(XLSX: XlsxUtils, wb: XlsxLike, nome: string): string[] {
  const ws = wb.Sheets[nome]
  if (!ws) return []
  const linha = (XLSX.sheet_to_json(ws, { header: 1, defval: '' })[0] ?? []) as unknown as unknown[]
  return linha.map((h) => String(h).toLowerCase().trim())
}

// Uma planilha é "de movimentação" (extrato B3 / Status Invest) quando o
// cabeçalho tem as colunas Movimentação + Produto + (Entrada/Saída | Valor).
function ehAbaMovimentacao(cols: string[]): boolean {
  const tem = (s: string) => cols.some((c) => c.includes(s))
  return tem('movimenta') && tem('produto') && (tem('entrada') || tem('valor da opera'))
}

// Uma planilha é "carteira do Status Invest" quando tem Data operação +
// Código Ativo + Operação C/V (layout próprio, só compras/vendas).
function ehAbaStatusInvest(cols: string[]): boolean {
  const tem = (s: string) => cols.some((c) => c.includes(s))
  return tem('data opera') &&
    (tem('código ativo') || tem('codigo ativo') || tem('ativo')) &&
    (tem('c/v') || tem('operação') || tem('operacao'))
}

/** Nome da aba de movimentação (por cabeçalho); fallback: 1ª planilha. */
export function abaMovimentacao(XLSX: XlsxUtils, wb: XlsxLike): string {
  for (const nome of wb.SheetNames) {
    if (ehAbaMovimentacao(cabecalho(XLSX, wb, nome))) return nome
  }
  return wb.SheetNames[0]
}

/** Nome da aba da carteira Status Invest; fallback: 1ª planilha. */
export function abaStatusInvest(XLSX: XlsxUtils, wb: XlsxLike): string {
  for (const nome of wb.SheetNames) {
    if (ehAbaStatusInvest(cabecalho(XLSX, wb, nome))) return nome
  }
  return wb.SheetNames[0]
}

export function detectarTipoArquivo(XLSX: XlsxUtils, wb: XlsxLike): 'posicao' | 'movimentacao' | 'statusinvest' | 'desconhecido' {
  const nomes = wb.SheetNames.map((n) => n.toLowerCase().trim())
  if (nomes.some((n) => ABAS_POSICAO.includes(n))) return 'posicao'
  // Detecção por cabeçalho — robusta a variações de nome/quantidade de abas.
  for (const nome of wb.SheetNames) {
    const cols = cabecalho(XLSX, wb, nome)
    if (ehAbaStatusInvest(cols)) return 'statusinvest'   // layout próprio Status Invest
    if (ehAbaMovimentacao(cols)) return 'movimentacao'   // extrato B3 / Status Invest (mesmo layout)
  }
  if (wb.SheetNames.length === 1) return 'movimentacao'
  return 'desconhecido'
}

// ── Ticker / nome a partir do "Produto" do extrato ───────────────
/** "BBAS3 - BANCO DO BRASIL S/A" → { ticker:'BBAS3', nome:'BANCO...' }
 *  "Tesouro IPCA+ 2026"          → { ticker:'IPCA+2026', nome:'Tesouro IPCA+ 2026' }
 *  "CDB - CDB62657G9P - BANCO X" → { ticker:'CDB62657G9P', nome:'CDB - BANCO X' } */
export function tickerDoProduto(produto: string): { ticker: string; nome: string } {
  const p = String(produto ?? '').trim()
  if (!p) return { ticker: '', nome: '' }
  if (/^tesouro/i.test(p)) {
    const ticker = p.replace(/tesouro\s*/i, '').replace(/[^A-Za-z0-9+]/g, '').toUpperCase().slice(0, 20)
    return { ticker, nome: p }
  }
  const partes = p.split(' - ').map((x) => x.trim())
  // Renda fixa: "CDB - <CODIGO> - <EMISSOR>"
  if (partes.length >= 2 && /^(CDB|LCI|LCA|CRI|CRA|LC|LF|DEB)/i.test(partes[0]) && /\d/.test(partes[1])) {
    return { ticker: partes[1].toUpperCase().slice(0, 20), nome: p }
  }
  // Padrão: "<TICKER> - <NOME>"
  const ticker = partes[0].toUpperCase().replace(/\s+/g, '').slice(0, 20)
  return { ticker, nome: partes.slice(1).join(' - ') || partes[0] }
}

// ── Mapeamentos de tipo de ativo / RF ────────────────────────────
export function indexadorRF(texto: unknown): IndexadorRF | null {
  const s = String(texto ?? '').toUpperCase()
  if (/IPCA|HIBRID|H[IÍ]BRID/.test(s)) return 'HIBRIDO'
  if (/SELIC|CDI|P[OÓ]S/.test(s)) return 'POS_FIXADO'
  if (/PRE|PREFIX/.test(s)) return 'PREFIXADO'
  return null
}
function subtipoRFdoProduto(produto: string): SubtipoRF {
  const s = String(produto ?? '').toUpperCase()
  if (s.startsWith('LCI')) return 'LCI'
  if (s.startsWith('LCA')) return 'LCA'
  if (s.startsWith('CRI')) return 'CRI'
  if (s.startsWith('CRA')) return 'CRA'
  if (s.startsWith('DEB')) return 'DEBENTURE'
  if (s.startsWith('CDB')) return 'CDB'
  return 'OUTRO'
}

// ── Instituição → rótulo de grupo (mesmo broker, nomes variados) ──
export function rotuloInstituicao(inst: string): string {
  const s = String(inst ?? '').toUpperCase()
  if (s.includes('INTER')) return 'Inter'
  if (/\bNU\b|NUBANK|NU INVEST|NU FINANCEIRA|NU HOLDINGS/.test(s)) return 'Nu'
  if (s.includes('XP ') || s.startsWith('XP')) return 'XP'
  if (s.includes('RICO')) return 'Rico'
  if (s.includes('CLEAR')) return 'Clear'
  if (s.includes('ITA')) return 'Itaú'
  if (s.includes('BRADESCO')) return 'Bradesco'
  if (s.includes('BTG')) return 'BTG'
  if (s.includes('NUINVEST') || s.includes('EASYNVEST')) return 'Nu'
  // Fallback: 2 primeiras palavras capitalizadas
  const palavras = String(inst ?? '').split(/\s+/).slice(0, 2).join(' ')
  return palavras || 'Corretora'
}

// ════════════════════════════════════════════════════════════════
// parsePosicao — lê as 7 abas e devolve as posições (1 por ticker+inst)
// ════════════════════════════════════════════════════════════════
export function parsePosicao(XLSX: XlsxUtils, wb: XlsxLike): PosicaoB3[] {
  const acc = new Map<string, PosicaoB3>()  // ticker|instituicao
  const nomeReal = (alvo: string) =>
    wb.SheetNames.find((n) => n.toLowerCase().trim() === alvo)

  const add = (p: PosicaoB3) => {
    const key = `${p.ticker}|${p.instituicao}`
    const existente = acc.get(key)
    if (existente) {
      existente.quantidade += p.quantidade
      existente.valor_mercado += p.valor_mercado
    } else acc.set(key, p)
  }

  // Abas de renda variável (ações/BDR/ETF/Fundo) — colunas comuns
  const rendaVar: { aba: string; tipo: TipoAtivoInvestimento; bdr?: boolean }[] = [
    { aba: 'acoes', tipo: 'ACOES' },
    { aba: 'ações', tipo: 'ACOES' },
    { aba: 'bdr', tipo: 'ACOES', bdr: true },   // BDR é subtipo de Ações
    { aba: 'etf', tipo: 'ETF' },
    { aba: 'fundo de investimento', tipo: 'FII' },
  ]
  for (const { aba, tipo, bdr } of rendaVar) {
    const nome = nomeReal(aba)
    if (!nome) continue
    for (const r of linhas(XLSX, wb, nome)) {
      const ticker = String(pick(r, 'código de negociação', 'codigo de negociação', 'código', 'codigo')).trim().toUpperCase()
      if (!ticker) continue
      const quantidade = num(pick(r, 'quantidade'))
      const valor = num(pick(r, 'valor atualizado'))
      const fech = num(pick(r, 'preço de fechamento', 'preco de fechamento'))
      const produto = String(pick(r, 'produto')).trim()
      // ETF com Tipo "Criptoativo" → CRIPTOMOEDAS
      const tipoCol = String(pick(r, 'tipo')).toUpperCase().trim()
      const tipoFinal: TipoAtivoInvestimento = tipo === 'ETF' && tipoCol.includes('CRIPTO') ? 'CRIPTOMOEDAS' : tipo
      // Subtipo da ação: BDR pela aba; senão ON/PN/UNIT pela coluna "Tipo"
      let acoesSub: AcoesSubtipo | null = null
      if (tipoFinal === 'ACOES') {
        acoesSub = bdr ? 'BDR'
          : (tipoCol.includes('UNT') || tipoCol.includes('UNIT')) ? 'UNIT'
          : tipoCol === 'ON' ? 'ON' : tipoCol === 'PN' ? 'PN'
          : acoesSubtipoPorTicker(ticker)   // fallback robusto pelo sufixo
      }
      add({
        ticker, nome: produto.split(' - ').slice(1).join(' - ').trim() || produto || ticker,
        tipo_ativo: tipoFinal, moeda: 'BRL',
        instituicao: String(pick(r, 'instituição', 'instituicao')).trim(),
        quantidade, valor_mercado: valor, preco_fechamento: fech,
        custo_fallback: fech || (quantidade > 0 ? valor / quantidade : 0),
        fii_categoria: tipoFinal === 'FII' ? fiiCategoriaPorTicker(ticker) : null,
        acoes_subtipo: acoesSub,
      })
    }
  }

  // Renda Fixa
  const nomeRF = nomeReal('renda fixa')
  if (nomeRF) {
    for (const r of linhas(XLSX, wb, nomeRF)) {
      const ticker = String(pick(r, 'código', 'codigo')).trim().toUpperCase()
      if (!ticker) continue
      const quantidade = num(pick(r, 'quantidade'))
      const valor = num(pick(r, 'valor atualizado curva', 'valor atualizado mtm', 'valor atualizado fechamento'))
      const produto = String(pick(r, 'produto')).trim()
      add({
        ticker, nome: produto || ticker, tipo_ativo: 'RENDA_FIXA', moeda: 'BRL',
        instituicao: String(pick(r, 'instituição', 'instituicao')).trim(),
        quantidade, valor_mercado: valor, preco_fechamento: 0,
        custo_fallback: quantidade > 0 ? valor / quantidade : 0,
        rf_subtipo: subtipoRFdoProduto(produto),
        rf_indexador: indexadorRF(pick(r, 'indexador')),
        rf_emissor: String(pick(r, 'emissor')).trim().slice(0, 80) || null,
        rf_vencimento: dmyToYmd(pick(r, 'vencimento')) || null,
      })
    }
  }

  // Tesouro Direto — usa Valor Aplicado como base de custo
  const nomeTD = nomeReal('tesouro direto')
  if (nomeTD) {
    for (const r of linhas(XLSX, wb, nomeTD)) {
      const produto = String(pick(r, 'produto')).trim()
      if (!produto) continue
      const { ticker } = tickerDoProduto(produto)
      if (!ticker) continue
      const quantidade = num(pick(r, 'quantidade'))
      const valor = num(pick(r, 'valor atualizado', 'valor bruto'))
      const aplicado = num(pick(r, 'valor aplicado'))
      add({
        ticker, nome: produto, tipo_ativo: 'TESOURO_DIRETO', moeda: 'BRL',
        instituicao: String(pick(r, 'instituição', 'instituicao')).trim(),
        quantidade, valor_mercado: valor, preco_fechamento: 0,
        custo_fallback: quantidade > 0 ? (aplicado || valor) / quantidade : 0,
        rf_subtipo: 'TESOURO',
        rf_indexador: indexadorRF(pick(r, 'indexador')) ?? 'HIBRIDO',
        rf_emissor: 'Governo Federal',
        rf_vencimento: dmyToYmd(pick(r, 'vencimento')) || null,
      })
    }
  }

  // Empréstimos (aluguel de ações) — soma a quantidade doada à ação
  const nomeEmp = nomeReal('empréstimos') ?? nomeReal('emprestimos')
  if (nomeEmp) {
    for (const r of linhas(XLSX, wb, nomeEmp)) {
      const produto = String(pick(r, 'produto')).trim()
      const { ticker } = tickerDoProduto(produto)
      if (!ticker) continue
      const quantidade = num(pick(r, 'quantidade'))
      if (quantidade <= 0) continue
      const instituicao = String(pick(r, 'instituição', 'instituicao')).trim()
      const key = `${ticker}|${instituicao}`
      const existente = acc.get(key)
      const fech = num(pick(r, 'preço de fechamento', 'preco de fechamento'))
      if (existente) {
        existente.quantidade += quantidade
        existente.valor_mercado += quantidade * fech
      } else {
        // Ação que só aparece como doada — cria posição mínima
        add({
          ticker, nome: produto.split(' - ').slice(1).join(' - ').trim() || produto || ticker,
          tipo_ativo: 'ACOES', moeda: 'BRL', instituicao,
          quantidade, valor_mercado: quantidade * fech, preco_fechamento: fech,
          custo_fallback: fech, fii_categoria: null,
        })
      }
    }
  }

  return [...acc.values()].filter((p) => p.ticker && p.quantidade > 0)
}

// ════════════════════════════════════════════════════════════════
// Mapa padrão Movimentação → ação (editável na UI)
// ════════════════════════════════════════════════════════════════
export function acaoPadrao(movimentacao: string, entradaSaida: string, temValor: boolean): AcaoMov {
  const m = String(movimentacao ?? '').toLowerCase().trim()
  const credito = String(entradaSaida ?? '').toLowerCase().startsWith('cred')

  // Proventos (entrada de caixa)
  if (/rendimento|dividendo|juros sobre capital|^juros|reembolso/.test(m)) return 'DIVIDENDO'
  if (/empr[ée]stimo/.test(m)) return temValor ? 'DIVIDENDO' : (credito ? 'APORTE' : 'RESGATE')

  // Compras / entradas com caixa
  if (/transfer[êe]ncia - liquida/.test(m)) {
    if (!temValor) return credito ? 'APORTE' : 'RESGATE'
    return credito ? 'COMPRA' : 'VENDA'
  }
  if (/^compra$|aplica[çc][ãa]o|recibo de subscri|subscri[çc][ãa]o - exercido/.test(m)) return 'COMPRA'
  if (/compra \/ venda/.test(m)) return credito ? 'COMPRA' : 'VENDA'

  // Vendas / saídas com caixa
  if (/resgate|vencimento|leil[ãa]o de fra|fra[çc][ãa]o em ativos/.test(m)) return credito ? 'COMPRA' : 'VENDA'

  // Eventos societários sem caixa → ajuste de quantidade
  if (/desdobro|incorpora|atualiza|^transfer[êe]ncia$|cess[ãa]o|direito|sobras|solicita/.test(m)) {
    return credito ? 'APORTE' : 'RESGATE'
  }

  return temValor ? (credito ? 'COMPRA' : 'VENDA') : 'IGNORAR'
}

/** Nome do tipo de provento (casa com os 4 seeds padrão). */
export function nomeProventoPadrao(movimentacao: string): string {
  const m = String(movimentacao ?? '').toLowerCase()
  if (/rendimento|empr[ée]stimo/.test(m)) return 'Aluguel de FII'
  if (/juros sobre capital/.test(m)) return 'JSCP'
  if (/dividendo/.test(m)) return 'Dividendos'
  return 'Rend. Trib.'
}

// ════════════════════════════════════════════════════════════════
// parseMovimentacao — lê a aba única do extrato
// mapaTipoMov permite sobrescrever a ação por tipo de movimentação.
// ════════════════════════════════════════════════════════════════
export function parseMovimentacao(
  XLSX: XlsxUtils, wb: XlsxLike, mapaTipoMov?: Record<string, AcaoMov>,
): MovB3[] {
  const aba = abaMovimentacao(XLSX, wb)
  const out: MovB3[] = []
  for (const r of linhas(XLSX, wb, aba)) {
    const movimentacao = String(pick(r, 'movimentação', 'movimentacao')).trim()
    const produto = String(pick(r, 'produto')).trim()
    if (!movimentacao || !produto) continue
    const entradaSaidaRaw = String(pick(r, 'entrada/saída', 'entrada/saida')).trim()
    const valorRaw = pick(r, 'valor da operação', 'valor da operacao')
    const temValor = temNumero(valorRaw)
    const { ticker, nome } = tickerDoProduto(produto)
    if (!ticker) continue
    const credito = entradaSaidaRaw.toLowerCase().startsWith('cred')
    const acao = mapaTipoMov?.[movimentacao] ?? acaoPadrao(movimentacao, entradaSaidaRaw, temValor)
    out.push({
      data: dmyToYmd(pick(r, 'data')),
      movimentacao,
      entradaSaida: credito ? 'Credito' : 'Debito',
      ticker, nome,
      instituicao: String(pick(r, 'instituição', 'instituicao')).trim(),
      quantidade: num(pick(r, 'quantidade')),
      preco: num(pick(r, 'preço unitário', 'preco unitario')),
      valor: num(valorRaw),
      temValor,
      acao,
      tipoProvento: acao === 'DIVIDENDO' ? nomeProventoPadrao(movimentacao) : undefined,
    })
  }
  return out
}

// ════════════════════════════════════════════════════════════════
// parseStatusInvest — carteira exportada do Status Invest
// Layout: Data operação | Categoria | Código Ativo | Operação C/V |
//         Quantidade | Preço unitário | Corretora | Corretagem | …
// Só compras/vendas (sem posição de mercado nem proventos).
// ════════════════════════════════════════════════════════════════
function normCat(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}
function tipoAtivoStatusInvest(categoria: string, ticker: string): TipoAtivoInvestimento {
  const c = normCat(categoria)
  if (c.includes('imobili') || c.includes('fiagro') || c === 'fii') return 'FII'
  if (c.includes('tesouro')) return 'TESOURO_DIRETO'
  if (c.includes('exterior') || c.includes('internacional')) return 'ETF_INTERNACIONAL'
  if (c.includes('etf')) return 'ETF'
  if (c.includes('bdr')) return 'ACOES'   // BDR é subtipo de Ações
  if (c.includes('stock')) return 'STOCKS'
  if (c.includes('cripto')) return 'CRIPTOMOEDAS'
  if (c.includes('renda fixa') || /\b(cdb|lci|lca|cri|cra)\b/.test(c)) return 'RENDA_FIXA'
  if (c.includes('acoes') || c.includes('acao')) return 'ACOES'
  return tipoPadraoTicker(ticker)
}
function normalizarTickerTesouro(codigo: string): string {
  return codigo.replace(/tesouro[-\s]*/i, '').replace(/[^A-Za-z0-9+]/g, '').toUpperCase().slice(0, 20)
}

export function parseStatusInvest(XLSX: XlsxUtils, wb: XlsxLike): MovB3[] {
  const aba = abaStatusInvest(XLSX, wb)
  const out: MovB3[] = []
  for (const r of linhas(XLSX, wb, aba)) {
    const codigo = String(pick(r, 'código ativo', 'codigo ativo', 'ativo', 'papel')).trim()
    if (!codigo) continue
    const categoria = String(pick(r, 'categoria', 'tipo')).trim()
    const cvRaw = String(pick(r, 'operação c/v', 'operacao c/v', 'operação', 'operacao', 'c/v')).trim().toUpperCase()
    const acao: AcaoMov = cvRaw.startsWith('V') ? 'VENDA' : 'COMPRA'
    const tipoAtivo = tipoAtivoStatusInvest(categoria, codigo)
    const ticker = tipoAtivo === 'TESOURO_DIRETO'
      ? normalizarTickerTesouro(codigo)
      : codigo.toUpperCase().replace(/\s+/g, '').slice(0, 20)
    const acoesSubtipo: AcoesSubtipo | null = tipoAtivo === 'ACOES'
      ? (/bdr/i.test(categoria) ? 'BDR' : acoesSubtipoPorTicker(ticker))
      : null
    const data = dmyToYmd(pick(r, 'data operação', 'data operacao', 'data'))
    if (!ticker || !data) continue
    const quantidade = num(pick(r, 'quantidade', 'qtd'))
    const preco = num(pick(r, 'preço unitário', 'preco unitario', 'preço', 'preco', 'valor unitário'))
    out.push({
      data,
      movimentacao: `${categoria || 'Operação'} · ${acao === 'VENDA' ? 'Venda' : 'Compra'}`,
      entradaSaida: acao === 'COMPRA' ? 'Credito' : 'Debito',
      ticker, nome: codigo,
      instituicao: String(pick(r, 'corretora', 'instituição', 'instituicao')).trim(),
      quantidade, preco, valor: quantidade * preco,
      temValor: quantidade > 0 && preco > 0,
      acao, tipoAtivo, acoesSubtipo,
    })
  }
  return out
}

// Deriva posições a partir das operações — usado quando NÃO há arquivo de
// posição (ex.: Status Invest, que só traz compras/vendas). Quantidade =
// líquida (compras − vendas); custo = média das compras; valor de mercado
// indisponível → assume o custo (ganho/perda 0 até o usuário atualizar).
export function derivarPosicoes(movs: MovB3[], custo: Map<string, CustoMedio>): PosicaoB3[] {
  const acc = new Map<string, { qtd: number; ticker: string; instituicao: string; tipo: TipoAtivoInvestimento; nome: string; subtipo: AcoesSubtipo | null }>()
  for (const m of movs) {
    if (!['COMPRA', 'VENDA', 'APORTE', 'RESGATE'].includes(m.acao)) continue
    const key = `${m.ticker}|${m.instituicao}`
    const e = acc.get(key) ?? {
      qtd: 0, ticker: m.ticker, instituicao: m.instituicao,
      tipo: m.tipoAtivo ?? tipoPadraoTicker(m.ticker), nome: m.nome || m.ticker,
      subtipo: m.acoesSubtipo ?? acoesSubtipoPorTicker(m.ticker),
    }
    e.qtd += (m.acao === 'COMPRA' || m.acao === 'APORTE' ? 1 : -1) * (m.quantidade || 0)
    if (m.tipoAtivo) e.tipo = m.tipoAtivo
    if (m.acoesSubtipo) e.subtipo = m.acoesSubtipo
    acc.set(key, e)
  }
  const out: PosicaoB3[] = []
  for (const [, e] of acc) {
    if (e.qtd <= 1e-7) continue   // posição zerada/vendida → sem posição ATIVA
    const preco = custo.get(`${e.ticker}|${e.instituicao}`)?.preco_custo ?? 0
    out.push({
      ticker: e.ticker, nome: e.nome, tipo_ativo: e.tipo, moeda: 'BRL', instituicao: e.instituicao,
      quantidade: e.qtd, valor_mercado: e.qtd * preco, preco_fechamento: preco, custo_fallback: preco,
      rf_subtipo: e.tipo === 'TESOURO_DIRETO' ? 'TESOURO' : null,
      rf_indexador: null,
      rf_emissor: e.tipo === 'TESOURO_DIRETO' ? 'Governo Federal' : null,
      rf_vencimento: null,
      fii_categoria: e.tipo === 'FII' ? fiiCategoriaPorTicker(e.ticker) : null,
      acoes_subtipo: e.tipo === 'ACOES' ? e.subtipo : null,
    })
  }
  return out
}

/** Tipos de movimentação distintos com a ação default e a contagem. */
export function tiposMovimentacao(movs: MovB3[]): { tipo: string; acao: AcaoMov; total: number }[] {
  const mapa = new Map<string, { acao: AcaoMov; total: number }>()
  for (const m of movs) {
    const e = mapa.get(m.movimentacao) ?? { acao: m.acao, total: 0 }
    e.total++
    mapa.set(m.movimentacao, e)
  }
  return [...mapa.entries()].map(([tipo, v]) => ({ tipo, acao: v.acao, total: v.total }))
    .sort((a, b) => b.total - a.total)
}

// ════════════════════════════════════════════════════════════════
// calcularCustoMedio — por (ticker, instituição): média das COMPRAS
// ════════════════════════════════════════════════════════════════
export interface CustoMedio { preco_custo: number; data_compra: string; qtd_comprada: number }

export function calcularCustoMedio(movs: MovB3[]): Map<string, CustoMedio> {
  const acc = new Map<string, { valor: number; qtd: number; primeira: string }>()
  for (const m of movs) {
    if (m.acao !== 'COMPRA') continue
    if (!(m.quantidade > 0) || !(m.valor > 0)) continue
    const key = `${m.ticker}|${m.instituicao}`
    const e = acc.get(key) ?? { valor: 0, qtd: 0, primeira: m.data }
    e.valor += m.valor
    e.qtd += m.quantidade
    if (m.data && (!e.primeira || m.data < e.primeira)) e.primeira = m.data
    acc.set(key, e)
  }
  const out = new Map<string, CustoMedio>()
  for (const [k, e] of acc) {
    out.set(k, {
      preco_custo: e.qtd > 0 ? e.valor / e.qtd : 0,
      data_compra: e.primeira || '',
      qtd_comprada: e.qtd,
    })
  }
  return out
}

/** Quantidade líquida por (ticker, instituição) a partir do extrato
 *  (entradas − saídas), para reconciliar com a posição. */
export function quantidadeLiquida(movs: MovB3[]): Map<string, number> {
  const acc = new Map<string, number>()
  for (const m of movs) {
    if (m.acao === 'IGNORAR' || m.acao === 'DIVIDENDO') continue
    const key = `${m.ticker}|${m.instituicao}`
    const sinal = (m.acao === 'COMPRA' || m.acao === 'APORTE') ? 1 : -1
    acc.set(key, (acc.get(key) ?? 0) + sinal * (m.quantidade || 0))
  }
  return acc
}
