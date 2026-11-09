// Oportunidades de compra (página Destaques): ativos com recomendação "Comprar"
// (mesma régua da coluna "Comprar?" de QuadroTipoAtivos: nota alta + tipo abaixo
// da meta) E preço atual abaixo do preço médio pago. Função pura — sem rede.
import { recomendacaoCompra } from './questionarioAtivos'
import type { InvestimentoRankingAtivo, InvestimentoDashboardTipo } from '../types'

export interface OportunidadeCompra {
  ativo: InvestimentoRankingAtivo
  precoMedio: number
  precoAtual: number
  /** R$ que falta pra o ativo chegar à sua fatia ideal (limitado ao que falta pro tipo chegar à meta). */
  valorSugerido: number
}

export function calcularOportunidadesCompra(
  ativos: InvestimentoRankingAtivo[],
  tipos: InvestimentoDashboardTipo[],
  totalCarteira: number,
): OportunidadeCompra[] {
  const tipoPor = new Map(tipos.map((t) => [t.tipo_ativo, t]))

  // % ideal por ativo: a meta do TIPO rateada pela nota (ativo sem nota fica de
  // fora; sem nenhuma nota no tipo, divide igualmente) — igual a QuadroTipoAtivos.
  const porTipo = new Map<string, InvestimentoRankingAtivo[]>()
  for (const a of ativos) {
    if (a.quantidade <= 0) continue
    porTipo.set(a.tipo_ativo, [...(porTipo.get(a.tipo_ativo) ?? []), a])
  }
  const idealPct = new Map<string, number>()
  for (const [tipo, lista] of porTipo) {
    const meta = tipoPor.get(tipo as InvestimentoDashboardTipo['tipo_ativo'])?.percentual_ideal ?? 0
    if (meta <= 0) continue
    const somaNotas = lista.reduce((s, l) => s + (l.nota_usuario ?? 0), 0)
    for (const l of lista) {
      if (somaNotas > 0) {
        if (l.nota_usuario != null) idealPct.set(l.ativo_id, meta * (l.nota_usuario / somaNotas))
      } else {
        idealPct.set(l.ativo_id, meta / lista.length)
      }
    }
  }

  const out: OportunidadeCompra[] = []
  for (const a of ativos) {
    if (a.quantidade <= 0) continue
    const tipo = tipoPor.get(a.tipo_ativo)
    if (!tipo || tipo.percentual_ideal <= 0) continue
    const rec = recomendacaoCompra(a.nota_usuario ?? null, tipo.desvio_pct)
    if (rec?.recomendacao !== 'COMPRAR') continue
    const precoMedio = a.valor_custo / a.quantidade
    const precoAtual = a.valor_mercado / a.quantidade
    if (!(precoAtual < precoMedio)) continue

    const faltaAtivo = ((idealPct.get(a.ativo_id) ?? 0) / 100) * totalCarteira - a.valor_mercado
    const faltaTipo  = (tipo.percentual_ideal / 100) * totalCarteira - tipo.valor_mercado
    out.push({ ativo: a, precoMedio, precoAtual, valorSugerido: Math.max(0, Math.min(faltaAtivo, faltaTipo)) })
  }
  return out
}
