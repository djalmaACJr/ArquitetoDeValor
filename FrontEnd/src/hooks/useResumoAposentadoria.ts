// src/hooks/useResumoAposentadoria.ts
//
// Resumo financeiro para o planejamento de aposentadoria (regra dos 4%),
// usado na tela de Configurações de Investimentos (Perfil do investidor):
//   - rendaMensalMedia: média mensal das RECEITAS realizadas nos últimos
//     24 meses completos (exclui transferências; só PAGO/PENDENTE — projeções
//     ficam de fora). É a renda que se quer substituir ao se aposentar.
//   - patrimonioTotal: soma do saldo atual de TODAS as contas (corrente,
//     carteira, investimento, cartão, etc.) — visão completa do patrimônio.
//
// A partir destes dois números o componente aplica a regra dos 4% para
// estimar o patrimônio-alvo e a renda passiva sustentável.

import { useQuery } from '@tanstack/react-query'
import { fetchLancamentos, mesAdjacente } from './useLancamentos'
import { useContas } from './useContas'
import { useAuth } from './useAuth'

// Janela de apuração da renda média (meses completos anteriores ao atual).
const MESES_JANELA = 24

export function useResumoAposentadoria() {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const { contas, loading: loadingContas } = useContas()

  // Patrimônio total = soma do saldo de todas as contas (cartões, com saldo
  // negativo, reduzem o total — é o patrimônio líquido).
  const patrimonioTotal = contas.reduce((s, c) => s + (c.saldo_atual ?? 0), 0)

  const { data: rendaMensalMedia, isLoading: loadingRenda } = useQuery({
    queryKey: ['resumo-renda', uid, MESES_JANELA] as const,
    queryFn: async () => {
      const d = new Date()
      const mesBase = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      // Últimos 24 meses COMPLETOS (i+1 pula o mês corrente, ainda em curso).
      const meses = Array.from({ length: MESES_JANELA }, (_, i) => mesAdjacente(mesBase, -(i + 1)))
      const resultados = await Promise.all(
        meses.map(m =>
          fetchLancamentos({ mes: m, status_ids: ['PAGO', 'PENDENTE'] }).catch(() => []),
        ),
      )
      const totalReceitas = resultados.flat().reduce((s, l) => {
        if (l.tipo !== 'RECEITA') return s
        if (l.id_par_transferencia) return s            // crédito de transferência não é renda
        if (l.categoria_nome === 'Transferências') return s
        return s + l.valor
      }, 0)
      return totalReceitas / MESES_JANELA
    },
    enabled: !!uid,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  })

  return {
    rendaMensalMedia: rendaMensalMedia ?? 0,
    patrimonioTotal,
    loading: loadingContas || loadingRenda,
  }
}
