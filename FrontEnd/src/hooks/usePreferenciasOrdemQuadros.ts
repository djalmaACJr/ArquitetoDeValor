import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Preferência de ORDEM dos quadros arrastáveis (useOrdemReordenavel),
// persistida em arqvalor.usuarios.ordem_quadros — um JSONB compartilhado
// por VÁRIAS listas independentes, inclusive em páginas DIFERENTES (ex.:
// reordenar em Destaques e, na sequência, em Meus ativos). Mesmo padrão de
// leitura/escrita direta de `usuarios` já usado por useOcultarValores/tema/
// mascote (preferência de UI, sem Edge Function) — a escrita, porém, passa
// pela RPC `fn_mesclar_ordem_quadros` (20260921000001), não por um
// `update()` direto.
//
// Achado (set/2026): um `update({ ordem_quadros: blobInteiro })` direto do
// client — mesmo lendo o banco de novo antes de escrever — ainda perdia
// mudanças quando duas páginas diferentes salvavam chaves diferentes em
// sequência rápida (ex.: reordenar um quadro, clicar "voltar" e abrir outro
// ativo logo em seguida): a página antiga desmonta com a escrita ainda em
// voo, e não há como o client dela "ver" a escrita que a página nova fizer
// depois — cada UPDATE sobrescreve a coluna inteira, então a última escrita
// vence e apaga a outra chave silenciosamente. Serializar os saves só
// resolve DENTRO de uma mesma instância do hook, não entre duas instâncias
// (páginas) diferentes. A RPC faz o merge da chave ATOMICAMENTE dentro do
// próprio UPDATE no Postgres (`ordem_quadros || jsonb_build_object(chave,
// ordem)`), sem nenhum round-trip de leitura do client — não há como perder
// uma chave escrita por outra sessão/página, porque não há leitura pra ficar
// desatualizada.
export function usePreferenciasOrdemQuadros() {
  const { session } = useAuth()
  const userId = session?.user?.id

  const [blob, setBlob] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (!userId) return
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('ordem_quadros')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        const remoto = data?.ordem_quadros as Record<string, string[]> | null
        if (remoto && typeof remoto === 'object') setBlob(remoto)
      })
  }, [userId])

  const salvar = (chave: string, ordem: string[]) => {
    // Atualização otimista local — a UI (inclusive outras listas na mesma
    // página) reflete na hora, sem esperar a rede.
    setBlob((atual) => ({ ...atual, [chave]: ordem }))
    if (!userId) return
    supabase
      .schema('arqvalor')
      .rpc('fn_mesclar_ordem_quadros', { p_chave: chave, p_ordem: ordem })
      .then(({ error }) => { if (error) console.error('Erro ao salvar ordem dos quadros:', error) })
  }

  return { blob, salvar }
}
