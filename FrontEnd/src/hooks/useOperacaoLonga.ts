// src/hooks/useOperacaoLonga.ts
//
// Enquanto `ativa` for true, sinaliza ao auto-logout que há uma operação longa
// em andamento (backup/restore/import/sincronização), suspendendo o timer de
// inatividade. Ao virar false (ou desmontar), libera o registro.
//
// Uso: useOperacaoLonga(loading)  // ou (etapa === 'restaurando'), etc.

import { useEffect } from 'react'
import { registrarOperacaoLonga } from '../lib/operacaoLonga'

export function useOperacaoLonga(ativa: boolean): void {
  useEffect(() => {
    if (!ativa) return
    return registrarOperacaoLonga()
  }, [ativa])
}
