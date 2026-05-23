// src/lib/exportUtils.ts
// Motor centralizado de exportação Excel.
//
// API declarativa: o chamador descreve colunas + linhas + estilos opcionais por
// linha. O motor aplica formatação numérica (R$, %), zebra, cabeçalho destacado,
// bordas, alinhamento e congelamento da primeira linha automaticamente.
// Insere também o logo do Arquiteto de Valor no canto superior esquerdo.
//
// `exceljs` é importado lazy via dynamic import — só pesa no bundle quando uma
// exportação acontece de fato.

import { logoComoPng, APP_NAME } from './appLogo'

// ── Tipos públicos ────────────────────────────────────────────────────────

export type ColumnType = 'text' | 'currency' | 'percent' | 'number' | 'integer' | 'date'

export interface ExportColumn {
  /** chave usada nas linhas para localizar o valor */
  key:    string
  /** texto exibido no cabeçalho */
  label:  string
  /** define formatação numérica + alinhamento default. Default: 'text' */
  type?:  ColumnType
  /** largura da coluna em caracteres (default por type) */
  width?: number
  /** override de alinhamento (default segue o type) */
  align?: 'left' | 'right' | 'center'
}

/**
 * Estilo de uma linha. `normal` aplica zebra automática.
 *  - group      → seção (ex.: "▼ Receitas"); azul claro, bold uppercase
 *  - subtotal   → totais parciais; amarelo claro, bold
 *  - total      → totais gerais / Resultado; verde claro, bold, borda dupla
 *  - highlight  → destaque pontual (ex.: insight); rosa claro
 */
export type RowStyle = 'normal' | 'group' | 'subtotal' | 'total' | 'highlight'

export interface ExportRow {
  [key: string]: string | number | Date | null | undefined | RowStyle
  /** quando ausente equivale a 'normal' */
  _style?: RowStyle
}

export interface ExportSheet {
  /** nome da aba (sanitizado para regras do Excel) */
  name:        string
  /** título exibido na primeira linha (mesclada) acima do cabeçalho */
  title?:      string
  /** subtítulo logo abaixo do título */
  subtitle?:   string
  columns:     ExportColumn[]
  rows:        ExportRow[]
  /** congela cabeçalho ao rolar. default true */
  freezeHeader?: boolean
}

export interface ExportOptions {
  /** nome do arquivo (com ou sem extensão .xlsx) */
  filename: string
  sheets:   ExportSheet[]
}

// ── Constantes de estilo ──────────────────────────────────────────────────

const CORES = {
  header:    { bg: 'FF1F2937', fg: 'FFFFFFFF' },
  zebra:     { bg: 'FFF9FAFB' },
  group:     { bg: 'FFDBEAFE' },
  subtotal:  { bg: 'FFFEF3C7' },
  total:     { bg: 'FFD1FAE5' },
  highlight: { bg: 'FFFEE2E2' },
  border:    'FFE5E7EB',
} as const

const NUM_FMT: Record<ColumnType, string | undefined> = {
  text:     undefined,
  currency: '"R$" #,##0.00;[Red]"R$" -#,##0.00',
  percent:  '0.0%',
  number:   '#,##0.00',
  integer:  '#,##0',
  date:     'dd/mm/yyyy',
}

const DEFAULT_WIDTH: Record<ColumnType, number> = {
  text:     30,
  currency: 16,
  percent:  12,
  number:   14,
  integer:  10,
  date:     12,
}

const DEFAULT_ALIGN: Record<ColumnType, 'left' | 'right' | 'center'> = {
  text:     'left',
  currency: 'right',
  percent:  'right',
  number:   'right',
  integer:  'right',
  date:     'left',
}

// ── Helpers internos ──────────────────────────────────────────────────────

/** Sanitiza nome da aba: max 31 chars e sem caracteres proibidos pelo Excel. */
function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function thinBorder(): any {
  return {
    top:    { style: 'thin', color: { argb: CORES.border } },
    bottom: { style: 'thin', color: { argb: CORES.border } },
    left:   { style: 'thin', color: { argb: CORES.border } },
    right:  { style: 'thin', color: { argb: CORES.border } },
  }
}

// ── Função principal ──────────────────────────────────────────────────────

export async function exportToExcel(opts: ExportOptions): Promise<void> {
  // Lazy import — exceljs só entra no bundle quando o usuário exporta de fato
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = APP_NAME
  wb.created = new Date()

  // Logo do app (PNG renderizado do SVG) — registrado uma vez no workbook
  // e referenciado em todas as abas. Se falhar (browser muito antigo / sem
  // canvas), seguimos sem o logo em vez de quebrar a exportação.
  let logoId: number | undefined
  try {
    const logoBuf = await logoComoPng(96)
    logoId = wb.addImage({ buffer: logoBuf, extension: 'png' })
  } catch {
    logoId = undefined
  }

  for (const sheet of opts.sheets) {
    const ws = wb.addWorksheet(sanitizeSheetName(sheet.name))
    const cols = sheet.columns
    const nCols = cols.length

    // ── Banner com logo + nome do app ──────────────────────────────────────
    // Linha 1: ocupa toda a largura, altura ~52px. Logo ancorado à esquerda,
    // nome do app à direita (texto bold). Se nao houver título nem subtítulo,
    // ainda assim o banner aparece como cabeçalho institucional.
    let linhasTopo = 0
    const bannerRow = ws.addRow([APP_NAME, ...Array(nCols - 1).fill('')])
    ws.mergeCells(bannerRow.number, 1, bannerRow.number, nCols)
    bannerRow.font      = { bold: true, size: 14, color: { argb: 'FF111827' } }
    bannerRow.alignment = { horizontal: 'left', vertical: 'middle', indent: 6 }
    bannerRow.height    = 38
    if (logoId !== undefined) {
      // Ancora o logo na célula A1 com tamanho fixo independente da largura
      // da coluna A. Posicionamento via `tl` (top-left) + `ext` (extent px).
      ws.addImage(logoId, {
        tl: { col: 0.1, row: 0.1 },
        ext: { width: 42, height: 42 },
        editAs: 'oneCell',
      })
      // Garante um espaço inicial para que o texto não sobreponha o logo
      bannerRow.alignment = { horizontal: 'left', vertical: 'middle', indent: 6 }
    }
    linhasTopo++

    // Header rows (title + subtitle) — opcionais, mesclados
    if (sheet.title) {
      const row = ws.addRow([sheet.title, ...Array(nCols - 1).fill('')])
      ws.mergeCells(row.number, 1, row.number, nCols)
      row.font      = { bold: true, size: 13, color: { argb: 'FF111827' } }
      row.alignment = { horizontal: 'left', vertical: 'middle' }
      row.height    = 20
      linhasTopo++
    }
    if (sheet.subtitle) {
      const row = ws.addRow([sheet.subtitle, ...Array(nCols - 1).fill('')])
      ws.mergeCells(row.number, 1, row.number, nCols)
      row.font      = { size: 10, color: { argb: 'FF6B7280' }, italic: true }
      row.alignment = { horizontal: 'left' }
      linhasTopo++
    }

    // Cabeçalho — bold, fundo escuro, texto branco, borda
    const headerRow = ws.addRow(cols.map(c => c.label))
    headerRow.eachCell(cell => {
      cell.font      = { bold: true, color: { argb: CORES.header.fg }, size: 11 }
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.header.bg } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border    = thinBorder()
    })
    headerRow.height = 22
    linhasTopo++

    // Larguras + formato por coluna
    cols.forEach((c, i) => {
      const tipo = c.type ?? 'text'
      ws.getColumn(i + 1).width = c.width ?? DEFAULT_WIDTH[tipo]
      if (NUM_FMT[tipo]) ws.getColumn(i + 1).numFmt = NUM_FMT[tipo]!
    })

    // Linhas de dados
    let zebraIdx = 0
    for (const row of sheet.rows) {
      const style = row._style ?? 'normal'
      const valores = cols.map(c => {
        const v = row[c.key]
        return v === undefined || v === null ? '' : v
      })
      const xlRow = ws.addRow(valores)

      // Aplica estilos célula a célula (importante: formato numérico vem da coluna,
      // mas a célula precisa de fonte/fill/alinhamento próprios para estilo da linha)
      xlRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        if (colNum > nCols) return  // segurança
        const c = cols[colNum - 1]
        const tipo = c.type ?? 'text'
        const align = c.align ?? DEFAULT_ALIGN[tipo]
        cell.alignment = { horizontal: align, vertical: 'middle' }
        cell.border = thinBorder()

        // Cor de fundo + fonte baseadas no estilo da linha
        switch (style) {
          case 'group':
            cell.font = { bold: true, color: { argb: 'FF1E40AF' } }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.group.bg } }
            break
          case 'subtotal':
            cell.font = { bold: true, color: { argb: 'FF92400E' } }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.subtotal.bg } }
            cell.border = { ...thinBorder(), top: { style: 'medium', color: { argb: CORES.border } } }
            break
          case 'total':
            cell.font = { bold: true, color: { argb: 'FF065F46' } }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.total.bg } }
            cell.border = { ...thinBorder(), top: { style: 'double', color: { argb: 'FF6B7280' } } }
            break
          case 'highlight':
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.highlight.bg } }
            break
          default: // normal — zebra
            if (zebraIdx % 2 === 1) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.zebra.bg } }
            }
        }
      })

      if (style === 'normal') zebraIdx++
    }

    // Congela linhas do topo + cabeçalho
    if (sheet.freezeHeader !== false) {
      ws.views = [{ state: 'frozen', xSplit: 0, ySplit: linhasTopo }]
    }
  }

  // Gerar e disparar download
  const buffer = await wb.xlsx.writeBuffer()
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url    = URL.createObjectURL(blob)
  const fname  = opts.filename.endsWith('.xlsx') ? opts.filename : `${opts.filename}.xlsx`
  const a      = Object.assign(document.createElement('a'), { href: url, download: fname })
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Libera o blob após o navegador iniciar o download
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
