// src/components/ui/ModalConfirmarProjecao.tsx
//
// "Confirmar valor real" ao dar baixa numa PROJEÇÃO: mesmo fluxo do botão
// Pagar do Extrato (LancamentosPage) — o valor projetado é preservado em
// valor_projetado e o lançamento vira PAGO com o valor real informado.

import { useState } from 'react'
import { Check } from 'lucide-react'
import { formatBRL } from '../../lib/utils'
import type { Transacao } from '../../types'

interface Props {
  lancamento: Transacao
  contaNome?: string | null
  onCancelar: () => void
  onConfirmar: (valorReal: number) => void
}

const fmtValor = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ModalConfirmarProjecao({ lancamento: l, contaNome, onCancelar, onConfirmar }: Props) {
  const [valor, setValor] = useState(fmtValor(l.valor))
  const corVal = l.tipo === 'RECEITA' ? '#00c896' : '#f87171'
  const sinal  = l.tipo === 'RECEITA' ? '+' : '-'
  const vConf  = parseFloat(valor.replace(/\./g, '').replace(',', '.')) || 0
  const diff   = vConf - l.valor
  const hasDiff = Math.abs(diff) > 0.01

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancelar} />
      <div className="relative bg-[#1a1f2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-400/10">
            <Check size={16} style={{ color: '#00c896' }} />
          </div>
          <p className="text-[18px] font-semibold" style={{ color: '#e8eaf0' }}>Confirmar valor real</p>
        </div>

        <div className="bg-[#252d42] rounded-xl p-3 mb-4 space-y-2">
          <div className="flex justify-between gap-3">
            <span className="text-[15px]" style={{ color: '#8b92a8' }}>Descrição</span>
            <span className="text-[16px] font-medium text-right" style={{ color: '#e8eaf0' }}>{l.descricao}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[15px]" style={{ color: '#8b92a8' }}>Conta</span>
            <span className="text-[16px]" style={{ color: '#e8eaf0' }}>{contaNome ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[15px]" style={{ color: '#8b92a8' }}>{l.status === 'PROJECAO' ? 'Valor projetado' : 'Valor lançado'}</span>
            <span className="text-[16px]" style={{ color: '#8b92a8' }}>{sinal}{formatBRL(l.valor)}</span>
          </div>
          <div className="flex justify-between items-center gap-3">
            <span className="text-[15px] whitespace-nowrap" style={{ color: '#8b92a8' }}>Valor real</span>
            <div className="flex items-center gap-1">
              <span className="text-[16px]" style={{ color: corVal }}>{sinal}</span>
              <input
                type="text"
                inputMode="numeric"
                value={valor}
                onChange={e => {
                  const nums = e.target.value.replace(/\D/g, '')
                  setValor(nums ? fmtValor(parseInt(nums, 10) / 100) : '')
                }}
                className="w-32 text-right text-[17px] font-bold bg-[#1a1f2e] border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:border-white/30"
                style={{ color: corVal }}
                autoFocus
              />
            </div>
          </div>
          {hasDiff && (
            <div className="flex justify-between border-t border-white/5 pt-2">
              <span className="text-[15px]" style={{ color: '#8b92a8' }}>Diferença</span>
              <span className="text-[16px]" style={{ color: diff > 0 ? '#00c896' : '#f87171' }}>
                {diff > 0 ? '+' : ''}{formatBRL(diff)}
              </span>
            </div>
          )}
        </div>

        <p className="text-[15px] mb-4 text-center" style={{ color: '#8b92a8' }}>
          {l.status === 'PROJECAO' ? 'O valor projetado será preservado e o' : 'O'} lançamento será marcado como{' '}
          <span style={{ color: '#00c896' }}>PAGO</span>.
        </p>

        <div className="flex gap-2">
          <button onClick={onCancelar}
            className="flex-1 py-2.5 rounded-lg border border-white/10 text-[16px] font-semibold transition-all hover:border-white/20"
            style={{ color: '#8b92a8' }}>
            Cancelar
          </button>
          <button
            onClick={() => onConfirmar(parseFloat(valor.replace(/\./g, '').replace(',', '.')))}
            className="flex-1 py-2.5 rounded-lg text-[16px] font-semibold transition-all hover:bg-green-500/90"
            style={{ background: '#00c896', color: '#0a0f1a' }}>
            <Check size={12} className="inline mr-1" /> Confirmar pago
          </button>
        </div>
      </div>
    </div>
  )
}
