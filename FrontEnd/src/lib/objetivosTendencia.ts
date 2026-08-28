// src/lib/objetivosTendencia.ts
//
// Heurísticas de "destaque" pra objetivos que estão se distanciando da meta.
// Puramente client-side, sem estado — usado por CardObjetivo e ObjetivoDetalhe.
//
// Dois critérios independentes, qualquer um dos dois já marca o objetivo
// como "distanciando":
//
//   1) PIORANDO   — valor_atingido caiu frente ao snapshot de ~1 mês atrás
//      (objetivos_progresso, exposto como valor_atingido_anterior pela view).
//      Usa valor_atingido (não o percentual, que satura em 100%) pra não
//      mascarar queda em objetivos que já passaram da meta.
//      Só fica disponível conforme objetivos_progresso acumula histórico —
//      ver 20260828000001_objetivos_tendencia.sql.
//
//   2) FORA DE RITMO — já passou proporcionalmente mais tempo do prazo do
//      que progresso foi feito. Só faz sentido pra tipos cujo percentual
//      depende de quanto tempo já passou (SONHO acumula ao longo do prazo;
//      CRESCIMENTO compara o ano corrente completo vs ano-base). OBJETIVO
//      (Renda Recorrente) já é uma média corrida por período — comparável
//      à meta independente do tempo decorrido, então não teria sentido
//      aqui (ver BUSINESS_RULES.md § "Cálculo de OBJETIVO").

import type { Objetivo } from '../types'

export interface TendenciaObjetivo {
  distanciando: boolean
  motivo: string | null
}

const TIPOS_COM_RITMO: ReadonlyArray<Objetivo['tipo']> = ['SONHO', 'CRESCIMENTO']

// Pontos percentuais de folga antes de alertar "fora de ritmo" — evita
// marcar todo mundo que está 1-2 pontos atrás do ritmo ideal.
const LIMIAR_FORA_DE_RITMO = 20

export function avaliarTendencia(objetivo: Objetivo): TendenciaObjetivo {
  if (objetivo.status !== 'EM_PROGRESSO' || objetivo.tipo === 'PROJETO') {
    return { distanciando: false, motivo: null }
  }

  if (
    objetivo.valor_atingido_anterior != null &&
    objetivo.valor_atingido < objetivo.valor_atingido_anterior - 0.01
  ) {
    return { distanciando: true, motivo: 'Piorando: o valor atingido caiu nas últimas semanas' }
  }

  if (TIPOS_COM_RITMO.includes(objetivo.tipo)) {
    const inicio = new Date(objetivo.data_inicio).getTime()
    const fim    = new Date(objetivo.data_fim).getTime()
    const hoje   = Date.now()
    const totalDias = Math.max(1, (fim - inicio) / 86_400_000)
    const dias      = Math.min(totalDias, Math.max(0, (hoje - inicio) / 86_400_000))
    const pctTempo  = (dias / totalDias) * 100

    if (pctTempo - objetivo.percentual >= LIMIAR_FORA_DE_RITMO) {
      return { distanciando: true, motivo: 'Fora do ritmo: o progresso está atrás do tempo já decorrido' }
    }
  }

  return { distanciando: false, motivo: null }
}
