import { useState, useEffect } from 'react'
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
        const valor = data.ocultar_valores ?? false
        localStorage.setItem(LS_KEY, String(valor))
        setOculto(valor)
      })
  }, [userId])

  const toggle = async () => {
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
