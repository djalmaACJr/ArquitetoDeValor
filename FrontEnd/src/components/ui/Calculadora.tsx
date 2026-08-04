// src/components/ui/Calculadora.tsx
import { useState, useEffect, useRef } from 'react'
import { Delete } from 'lucide-react'

interface Props {
  valorInicial: number
  onConfirmar: (valor: number) => void
  onFechar: () => void
}

// Avalia uma expressão aritmética simples de forma segura
function avaliarExpr(expr: string): number | null {
  // Remove pontos usados como separador de milhar BR (ex.: "1.234,56" → "1234,56").
  // Padrão: ponto entre dígitos seguido de exatamente 3 dígitos e operador/fim.
  const semMilhar = expr.replace(/(\d)\.(?=\d{3}(?:\D|$))/g, '$1')
  const sanitized = semMilhar
    .replace(/,/g, '.')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[^0-9+\-*/.()]/g, '')
  if (!sanitized) return null
  try {
    const resultado = Function(`"use strict"; return (${sanitized})`)() as unknown
    return typeof resultado === 'number' && isFinite(resultado) ? resultado : null
  } catch {
    return null
  }
}

function terminaComOp(expr: string) {
  return /[+\-×÷*/]$/.test(expr)
}

// Converte um segmento numérico formatado (ex.: "1.234,56") na quantidade de centavos (123456)
function segmentoCents(seg: string): number {
  const digits = seg.replace(/\D/g, '')
  return digits ? parseInt(digits, 10) : 0
}

// Formata centavos como moeda BR (12345 → "123,45")
function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Índice do último operador "real" (ignora o sinal de menos no início da expressão)
function ultimoOpIndex(expr: string): number {
  for (let i = expr.length - 1; i >= 0; i--) {
    if ('+-×÷'.includes(expr[i])) {
      if (i === 0) continue
      return i
    }
  }
  return -1
}

// Separa a expressão em [prefixo, último número] — onde o número é tudo após o último operador
function separarUltimo(expr: string): [string, string] {
  const idx = ultimoOpIndex(expr)
  let prefixo = idx >= 0 ? expr.slice(0, idx + 1) : ''
  let seg = idx >= 0 ? expr.slice(idx + 1) : expr
  if (idx < 0 && seg.startsWith('-')) { prefixo = '-'; seg = seg.slice(1) }
  return [prefixo, seg]
}

const BTN = 'flex items-center justify-center rounded-xl text-[19px] font-semibold transition-all active:scale-95 select-none cursor-pointer'
const BTN_NUM  = `${BTN} bg-[#252d42] hover:bg-[#2e3955]`
const BTN_OP   = `${BTN} bg-[#1e2940] hover:bg-[#28354d] text-[#60a5fa]`
const BTN_ACAO = `${BTN} bg-[#1a3347] hover:bg-[#1e3d54] text-[#34d399]`

interface BotaoProps {
  label: React.ReactNode
  onClick: () => void
  className?: string
  style?: React.CSSProperties
}
function Btn({ label, onClick, className = BTN_NUM, style }: BotaoProps) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      className={className}
      style={{ height: '46px', ...style }}
    >
      {label}
    </button>
  )
}

export default function Calculadora({ valorInicial, onConfirmar, onFechar }: Props) {
  const inicialStr = valorInicial > 0
    ? formatCents(Math.round(valorInicial * 100))
    : ''

  const [expr,        setExpr]        = useState(inicialStr)
  const [resultado,   setResultado]   = useState<number | null>(null)
  const [acabouIgual, setAcabouIgual] = useState(false)
  const inputRef      = useRef<HTMLInputElement>(null)
  const containerRef  = useRef<HTMLDivElement>(null)

  // Foca o input oculto ao montar para capturar teclado e colagem imediatamente
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // A calculadora renderiza inline dentro do corpo rolável do Drawer, depois
  // de vários campos (Tipo, Data, Descrição, Categoria) — sem isso ela abre
  // fora da área visível (usuário vê só o topo, teclado/OK ficam cortados
  // embaixo do rodapé fixo do drawer, parecendo "não caber na tela").
  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  // ── Ações ──────────────────────────────────────────────────
  // Digitação em modo centavos: cada dígito desloca o número uma casa (123 → "1,23")
  function pressDigito(d: string) {
    if (acabouIgual) { setExpr(formatCents(parseInt(d, 10))); setResultado(null); setAcabouIgual(false); return }
    setExpr(e => {
      const [prefixo, seg] = separarUltimo(e)
      const cents = segmentoCents(seg) * 10 + parseInt(d, 10)
      return prefixo + formatCents(cents)
    })
  }

  function pressDuplo() {
    if (acabouIgual) { setExpr(formatCents(0)); setResultado(null); setAcabouIgual(false); return }
    setExpr(e => {
      const [prefixo, seg] = separarUltimo(e)
      const cents = segmentoCents(seg) * 100
      return prefixo + formatCents(cents)
    })
  }

  function pressOp(op: '+' | '-' | '×' | '÷') {
    setAcabouIgual(false)
    if (expr === '') { if (op === '-') setExpr('-'); return }
    if (terminaComOp(expr)) { setExpr(e => e.slice(0, -1) + op); return }
    setExpr(e => e + op)
  }

  function pressIgual() {
    const r = avaliarExpr(expr)
    if (r === null) return
    setExpr(r.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    setResultado(r)
    setAcabouIgual(true)
  }

  function pressBackspace() {
    setAcabouIgual(false)
    setExpr(e => {
      if (!e) return ''
      const last = e[e.length - 1]
      if ('+-×÷'.includes(last)) return e.slice(0, -1)
      const [prefixo, seg] = separarUltimo(e)
      const cents = Math.floor(segmentoCents(seg) / 10)
      return cents === 0 ? prefixo : prefixo + formatCents(cents)
    })
  }

  function pressClear() {
    setExpr('')
    setResultado(null)
    setAcabouIgual(false)
  }

  function confirmar() {
    let valor = acabouIgual ? resultado : avaliarExpr(expr)
    if (valor === null) valor = 0
    onConfirmar(Math.abs(valor))
  }

  // ── Colagem ────────────────────────────────────────────────
  // Cola apenas o valor numérico (ignora qualquer texto), substituindo o número atual.
  function aplicarColagem(texto: string) {
    const limpo = texto
      .replace(/\s/g, '')
      .replace(/\./g, '')
      .replace(/,/g, '.')
      .replace(/[^0-9.]/g, '')
    if (!limpo) return
    const valor = parseFloat(limpo)
    if (isNaN(valor)) return
    const formatado = formatCents(Math.round(valor * 100))
    setExpr(e => {
      if (acabouIgual) return formatado
      const [prefixo] = separarUltimo(e)
      return prefixo + formatado
    })
    setResultado(null)
    setAcabouIgual(false)
  }

  // ── Teclado ────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent) {
    // Não propaga para o drawer nem para outros handlers
    e.stopPropagation()

    // Ctrl/Cmd+V é tratado pelo evento nativo onPaste do input (sem prompt de permissão)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return

    if (e.key >= '0' && e.key <= '9') { e.preventDefault(); pressDigito(e.key); return }

    switch (e.key) {
      case '+':
        e.preventDefault(); pressOp('+'); break
      case '-':
        e.preventDefault(); pressOp('-'); break
      case '*':
        e.preventDefault(); pressOp('×'); break
      case '/':
        e.preventDefault(); pressOp('÷'); break
      case '=':
        e.preventDefault()
        if (acabouIgual) confirmar()
        else pressIgual()
        break
      case 'Enter':
        e.preventDefault()
        if (acabouIgual) confirmar()
        else pressIgual()
        break
      case 'Backspace':
        e.preventDefault(); pressBackspace(); break
      case 'Delete':
        e.preventDefault(); pressClear(); break
      case 'Escape':
        e.preventDefault(); onFechar(); break
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    e.stopPropagation()
    aplicarColagem(e.clipboardData.getData('text'))
  }

  // ── Display / preview ──────────────────────────────────────
  const displayStr = expr || '0'
  const previewStr = (() => {
    if (!expr || terminaComOp(expr)) return null
    if (!expr.match(/[+\-×÷]/)) return null
    const r = avaliarExpr(expr)
    if (r === null) return null
    return r.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  })()

  return (
    <div
      ref={containerRef}
      onClick={() => inputRef.current?.focus()}
      className="rounded-2xl border border-white/10 overflow-hidden mt-2 outline-none relative"
      style={{ background: '#141b2e' }}
    >
      {/* Input oculto: mantém o foco para capturar teclado e colagem nativa (sem prompt de permissão) */}
      <input
        ref={inputRef}
        autoFocus
        inputMode="numeric"
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className="absolute opacity-0 pointer-events-none"
        style={{ width: 1, height: 1, left: 0, top: 0 }}
      />

      {/* Display */}
      <div className="px-4 pt-3 pb-2 text-right select-none" style={{ minHeight: '64px' }}>
        {previewStr && (
          <p className="text-[15px] mb-0.5" style={{ color: '#8b92a8' }}>= {previewStr}</p>
        )}
        <p
          className="font-semibold leading-tight"
          style={{
            color: '#e8eaf0',
            fontSize: displayStr.length > 14 ? '16px' : displayStr.length > 10 ? '20px' : '26px',
          }}
        >
          {displayStr}
        </p>
      </div>

      {/* Teclado — 4 colunas */}
      <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
        {/* Linha 1 */}
        <Btn label="C"                          onClick={pressClear}          className={BTN_ACAO} />
        <Btn label={<Delete size={15} />}        onClick={pressBackspace}      className={BTN_OP}   />
        <Btn label="÷"                           onClick={() => pressOp('÷')} className={BTN_OP}   />
        <Btn label="×"                           onClick={() => pressOp('×')} className={BTN_OP}   />

        {/* Linha 2 */}
        <Btn label="7" onClick={() => pressDigito('7')} />
        <Btn label="8" onClick={() => pressDigito('8')} />
        <Btn label="9" onClick={() => pressDigito('9')} />
        <Btn label="-" onClick={() => pressOp('-')} className={BTN_OP} />

        {/* Linha 3 */}
        <Btn label="4" onClick={() => pressDigito('4')} />
        <Btn label="5" onClick={() => pressDigito('5')} />
        <Btn label="6" onClick={() => pressDigito('6')} />
        <Btn label="+" onClick={() => pressOp('+')} className={BTN_OP} />

        {/* Linha 4 */}
        <Btn label="1" onClick={() => pressDigito('1')} />
        <Btn label="2" onClick={() => pressDigito('2')} />
        <Btn label="3" onClick={() => pressDigito('3')} />

        {/* = — ocupa linhas 4 e 5 */}
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); if (acabouIgual) { confirmar() } else { pressIgual() } }}
          className={`${BTN} bg-av-green hover:bg-av-green/90 row-span-2`}
          style={{ gridRow: 'span 2', height: 'auto', minHeight: '46px', color: '#0a0f1a' }}
        >
          =
        </button>

        {/* Linha 5 — sem vírgula: no modo centavos as casas decimais são automáticas */}
        <Btn label="0"  onClick={() => pressDigito('0')} style={{ gridColumn: 'span 2' }} />
        <Btn label="00" onClick={pressDuplo} />
      </div>

      {/* Confirmar / Cancelar */}
      <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onFechar() }}
          className="rounded-xl text-[17px] font-medium py-2.5 transition-colors hover:bg-white/5"
          style={{ color: '#8b92a8', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          Cancelar
        </button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); confirmar() }}
          className="rounded-xl text-[17px] font-semibold py-2.5 bg-av-green hover:bg-av-green/90 transition-colors"
          style={{ color: '#0a0f1a' }}
        >
          OK
        </button>
      </div>
    </div>
  )
}
