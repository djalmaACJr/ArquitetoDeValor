// src/components/ui/AtividadeAgregados.tsx
//
// Seção da CompartilhamentoPage: o que os agregados criaram, alteraram ou
// excluíram nos dados do DONO (trilha de auditoria, ator_id ≠ dono). Sem isto
// o dono não tinha como saber de uma edição ou exclusão feita por um agregado.

import { Activity } from 'lucide-react'
import { useAtividadeAgregados, type AtividadeAgregado } from '../../hooks/useAgregados'

const TABELA_LABEL: Record<string, string> = {
  transacoes: 'lançamento', contas: 'conta', categorias: 'categoria', objetivos: 'objetivo',
  lembretes: 'lembrete', inv_ativos: 'ativo', inv_posicoes: 'posição', inv_operacoes: 'operação de investimento',
  inv_dividendos: 'provento', inv_historico_mensal: 'histórico de patrimônio',
}
const ACAO: Record<AtividadeAgregado['operacao'], { texto: string; cor: string }> = {
  INSERT: { texto: 'criou',   cor: '#00c896' },
  UPDATE: { texto: 'alterou', cor: '#f0b429' },
  DELETE: { texto: 'excluiu', cor: '#ff5c7a' },
}
const brl = (v: unknown) =>
  typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))
    ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null

function descricao(a: AtividadeAgregado): string {
  const d = (a.operacao === 'DELETE' ? a.dados_antigos : a.dados_novos) ?? {}
  const nome = (d.descricao ?? d.nome ?? d.ticker ?? '') as string
  const valor = brl(d.valor)
  return [nome, valor].filter(Boolean).join(' · ')
}
function mudancas(a: AtividadeAgregado): string | null {
  if (a.operacao !== 'UPDATE' || !a.dados_antigos || !a.dados_novos) return null
  const campos = ['valor', 'data', 'descricao', 'status', 'conta_id', 'categoria_id'] as const
  const diff = campos.filter(c => a.dados_antigos![c] !== a.dados_novos![c])
  return diff.length ? `alterado: ${diff.join(', ')}` : null
}
const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export default function AtividadeAgregados() {
  const { atividades, loading } = useAtividadeAgregados()

  return (
    <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5" data-testid="atividade-agregados">
      <h2 className="text-[15px] font-semibold text-white/80 mb-1 flex items-center gap-2">
        <Activity size={15} className="text-av-blue" /> Atividade dos agregados
      </h2>
      <p className="text-[12.5px] mb-3" style={{ color: '#8b92a8' }}>
        O que seus agregados criaram, alteraram ou excluíram nos seus dados.
      </p>
      {loading ? (
        <p className="text-[13px]" style={{ color: '#8b92a8' }}>Carregando...</p>
      ) : atividades.length === 0 ? (
        <p className="text-[13px]" style={{ color: '#8b92a8' }}>Nenhuma atividade de agregados até agora.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-white/5">
          {atividades.map(a => (
            <li key={a.id} className="py-2 flex flex-col gap-0.5">
              <span className="text-[13.5px]" style={{ color: '#e8eaf0' }}>
                <strong>{a.ator_nome ?? 'Um agregado'}</strong>{' '}
                <span style={{ color: ACAO[a.operacao].cor }}>{ACAO[a.operacao].texto}</span>{' '}
                {TABELA_LABEL[a.tabela] ?? a.tabela}
                {descricao(a) && <span style={{ color: '#c2c7d6' }}> — {descricao(a)}</span>}
              </span>
              <span className="text-[12px]" style={{ color: '#8b92a8' }}>
                {fmt(a.alterado_em)}{mudancas(a) ? ` · ${mudancas(a)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
