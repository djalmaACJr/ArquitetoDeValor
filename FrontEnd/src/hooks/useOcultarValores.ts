import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const LS_KEY = 'arqvalor:ocultar_valores'

export function useOcultarValores() {
  const { session } = useAuth()
  const userId = session?.user?.id

  // Lê do localStorage de forma síncrona para evitar flash de valores antes
  // da resposta do banco chegar.
  const [oculto, setOculto] = useState<boolean>(
    () => localStorage.getItem(LS_KEY) === 'true',
  )

  // Se o usuário já mexeu no toggle, o fetch tardio do banco NÃO pode
  // sobrescrever o estado local — caso contrário cliques rápidos viram
  // "borracha" (testes E2E-CT07/REL07 dependiam disso).
  const tocadoLocal = useRef(false)

  useEffect(() => {
    if (!userId) return
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('ocultar_valores')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (!data) return
        if (tocadoLocal.current) return
        const valor = data.ocultar_valores ?? false
        localStorage.setItem(LS_KEY, String(valor))
        setOculto(valor)
      })
  }, [userId])

  const toggle = async () => {
    tocadoLocal.current = true
    const novo = !oculto
    setOculto(novo)
    localStorage.setItem(LS_KEY, String(novo))
    if (!userId) return
    await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ ocultar_valores: novo })
      .eq('id', userId)
  }

  return { oculto, toggle }
}
