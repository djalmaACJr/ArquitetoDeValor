// src/hooks/usePrimeiroLancamento.ts
//
// Ano do lançamento MAIS ANTIGO do espaço ativo (o próprio usuário, ou o dono
// quando se vê "Conta de Fulano"). Usado pra delimitar quão atrás os relatórios
// multi-ano deixam o usuário olhar — em vez de um limite fixo.
//
// `GET /transacoes?per_page=1` sem `mes` já devolve ordenado por data crescente,
// então a 1ª linha é o lançamento mais antigo.
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { parseApiRes } from '../lib/lancamentosRelatorio'
import { useContextoUserId } from './useEspacoAtivo'

export function usePrimeiroLancamento() {
  const uid = useContextoUserId()

  const { data, isLoading } = useQuery<number | null>({
    queryKey: qk.primeiroLancamento(uid),
    queryFn: async () => {
      const res = await apiFetch<unknown>('/transacoes?per_page=1')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao buscar o primeiro lançamento')
      const primeira = parseApiRes(res)[0]
      const ano = primeira ? Number(primeira.data.slice(0, 4)) : NaN
      return Number.isFinite(ano) ? ano : null
    },
    enabled:   !!uid,
    staleTime: 10 * 60_000,   // o mais antigo quase nunca muda
  })

  return { anoPrimeiroLancamento: data ?? null, loading: isLoading }
}
