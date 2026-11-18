import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useContextoUserId } from './useEspacoAtivo'
import type { AlertaFii } from '../types'

// FIIs da carteira que podem estar mudando de forma (liquidação, fusão,
// transformação, troca de código). Lê o espaço ativo (dono do contexto), como
// o resto de Investimentos. O "visto" do aviso de login é só uma conveniência
// por navegador (localStorage, por uid) — o banner na página do ativo não
// depende dele e continua aparecendo.
const chaveVistos = (uid: string | null) => `arqvalor:alertas-fii-vistos:${uid ?? ''}`

function lerVistos(uid: string | null): number[] {
  try { return JSON.parse(localStorage.getItem(chaveVistos(uid)) ?? '[]') as number[] } catch { return [] }
}

export function useAlertasFii() {
  const uid = useContextoUserId()
  const { data: alertas = [], isLoading } = useQuery({
    queryKey: qk.invAlertasFii(uid),
    queryFn: async () => {
      const res = await apiFetch<AlertaFii[]>('/investimentos/alertas-fii')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar alertas')
      return res.dados ?? []
    },
    enabled: !!uid,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  // Guarda de qual uid é a lista: se o uid mudar (troca de espaço/usuário), relê do storage.
  const [estado, setEstado] = useState<{ uid: string | null; lista: number[] } | null>(null)
  const vistos = estado && estado.uid === uid ? estado.lista : lerVistos(uid)
  const naoVistos = useMemo(() => alertas.filter((a) => !vistos.includes(a.id)), [alertas, vistos])
  const marcarVistos = useCallback(() => {
    const todos = [...new Set([...vistos, ...alertas.map((a) => a.id)])]
    setEstado({ uid, lista: todos })
    try { localStorage.setItem(chaveVistos(uid), JSON.stringify(todos)) } catch { /* sem storage: some só nesta sessão */ }
  }, [alertas, uid, vistos])

  const porAtivo = useMemo(() => {
    const m = new Map<string, AlertaFii[]>()
    for (const a of alertas) m.set(a.ativo_id, [...(m.get(a.ativo_id) ?? []), a])
    return m
  }, [alertas])

  return { alertas, naoVistos, porAtivo, marcarVistos, loading: isLoading }
}
