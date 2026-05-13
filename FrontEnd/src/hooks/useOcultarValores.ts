import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useOcultarValores() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [oculto, setOculto] = useState(false)

  useEffect(() => {
    if (!userId) return
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('ocultar_valores')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data) setOculto(data.ocultar_valores ?? false)
      })
  }, [userId])

  const toggle = async () => {
    const novo = !oculto
    setOculto(novo)
    if (!userId) return
    await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ ocultar_valores: novo })
      .eq('id', userId)
  }

  return { oculto, toggle }
}
