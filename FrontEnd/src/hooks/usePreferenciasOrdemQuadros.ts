import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Preferência de ORDEM dos quadros arrastáveis (useOrdemReordenavel),
// persistida em arqvalor.usuarios.ordem_quadros — um JSONB compartilhado
// por VÁRIAS listas independentes dentro da mesma página (ex.: Destaques
// tem "gerais" e "por tipo de ativo" ao mesmo tempo). Mesmo padrão de
// leitura/escrita direta de `usuarios` já usado por useOcultarValores/tema/
// mascote (preferência de UI, sem Edge Function).
//
// Um hook SÓ por página seguindo esse blob inteiro (não um hook por lista)
// evita a corrida de "ler-modificar-escrever": todo `salvar()` funde contra
// a cópia em memória mais recente (`blobRef`), então duas listas reordenadas
// em sequência na MESMA página nunca se pisam. Entre abas diferentes ainda
// pode haver uma corrida rara — aceitável pra uma preferência de UI.
export function usePreferenciasOrdemQuadros() {
  const { session } = useAuth()
  const userId = session?.user?.id

  const [blob, setBlob] = useState<Record<string, string[]>>({})
  const blobRef = useRef(blob)
  useEffect(() => { blobRef.current = blob }, [blob])

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
    const novo = { ...blobRef.current, [chave]: ordem }
    blobRef.current = novo
    setBlob(novo)
    if (!userId) return
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ ordem_quadros: novo })
      .eq('id', userId)
      .then(({ error }) => { if (error) console.error('Erro ao salvar ordem dos quadros:', error) })
  }

  return { blob, salvar }
}
