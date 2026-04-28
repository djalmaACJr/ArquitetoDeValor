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
  const sanitized = expr
    .replace(/,/g, '.')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[^0-9+\-*/.()]/g, '')
  if (!sanitized) return null
  try {
    // eslint-disable-next-line no-new-func
    const resultado = Function(`"use strict"; return (${sanitized})`)() as unknown
    return typeof resultado === 'number' && isFinite(resultado) ? resultado : null
  } catch {
    return null
  }
}

function terminaComOp(expr: string) {
  return /[+\-×÷*/]$/.test(expr)
}

const BTN = 'flex items-center justify-center rounded-xl text-[15px] font-semibold transition-all active:scale-95 select-none cursor-pointer'
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
    ? valorInicial.toFixed(2).replace('.', ',')
    : ''

  const [expr,        setExpr]        = useState(inicialStr)
  const [resultado,   setResultado]   = useState<number | null>(null)
  const [acabouIgual, setAcabouIgual] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Foca o container ao montar para capturar teclado imediatamente
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  // ── Ações ──────────────────────────────────────────────────
  function pressDigito(d: string) {
    if (acabouIgual) { setExpr(d); setAcabouIgual(false); return }
    setExpr(e => e + d)
  }

  function pressDuplo() {
    if (acabouIgual) { setExpr('00'); setAcabouIgual(false); return }
    setExpr(e => e + '00')
  }

  function pressVirgula() {
    if (acabouIgual) { setExpr('0,'); setAcabouIgual(false); return }
    const segmentos = expr.split(/[+\-×÷]/)
    const ultimo = segmentos[segmentos.length - 1]
    if (ultimo.includes(',')) return
    setExpr(e => (e === '' ? '0,' : e + ','))
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
    setExpr(e => e.slice(0, -1))
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

  // ── Teclado ────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent) {
    // Não propaga para o drawer nem para outros handlers
    e.stopPropagation()

    if (e.key >= '0' && e.key <= '9') { e.preventDefault(); pressDigito(e.key); return }

    switch (e.key) {
      case ',':
      case '.':
        e.preventDefault(); pressVirgula(); break
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
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="rounded-2xl border border-white/10 overflow-hidden mt-2 outline-none"
      style={{ background: '#141b2e' }}
    >
      {/* Display */}
      <div className="px-4 pt-3 pb-2 text-right select-none" style={{ minHeight: '64px' }}>
        {previewStr && (
          <p className="text-[11px] mb-0.5" style={{ color: '#8b92a8' }}>= {previewStr}</p>
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
          onMouseDown={e => { e.preventDefault(); acabouIgual ? confirmar() : pressIgual() }}
          className={`${BTN} bg-av-green hover:bg-av-green/90 row-span-2`}
          style={{ gridRow: 'span 2', height: 'auto', minHeight: '46px', color: '#0a0f1a' }}
        >
          =
        </button>

        {/* Linha 5 */}
        <Btn label="0"  onClick={() => pressDigito('0')} />
        <Btn label="00" onClick={pressDuplo} />
        <Btn label=","  onClick={pressVirgula} />
      </div>

      {/* Confirmar / Cancelar */}
      <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onFechar() }}
          className="rounded-xl text-[13px] font-medium py-2.5 transition-colors hover:bg-white/5"
          style={{ color: '#8b92a8', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          Cancelar
        </button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); confirmar() }}
          className="rounded-xl text-[13px] font-semibold py-2.5 bg-av-green hover:bg-av-green/90 transition-colors"
          style={{ color: '#0a0f1a' }}
        >
          OK
        </button>
      </div>
    </div>
  )
}
