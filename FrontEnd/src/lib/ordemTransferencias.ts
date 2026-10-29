// Ordem das pernas de uma transferência no Extrato: as duas pernas ficam JUNTAS,
// a SAÍDA (DESPESA na conta de origem) logo antes da ENTRADA (RECEITA na conta
// de destino), pra a tela poder mostrá-las como uma transação só.
//
// As duas pernas nascem na mesma transação e empatam em `criado_em`; o
// desempate do servidor (`id`, aleatório) deixava a entrada antes da saída em
// parte dos pares — e outros lançamentos podiam cair no meio.

interface Perna { id: string; data: string; tipo: string; id_par_transferencia: string | null }

/**
 * Dentro de cada data, o par (saída + entrada) passa a ocupar a posição da
 * primeira das duas pernas, saída primeiro. Só mexe em pares com as DUAS
 * pernas na lista e na mesma data (filtro de conta, por exemplo, pode deixar
 * só uma); o resto da ordem (data, criado_em…) é preservado. Lista sem
 * transferência volta igual.
 */
export function ordenarPernasDeTransferencia<T extends Perna>(lista: T[]): T[] {
  if (!lista.some((l) => l.id_par_transferencia)) return lista

  const porData = new Map<string, T[]>()
  for (const l of lista) {
    const dia = porData.get(l.data) ?? []
    dia.push(l)
    porData.set(l.data, dia)
  }

  const out: T[] = []
  for (const dia of porData.values()) {
    const pares = new Map<string, { saida?: T; entrada?: T }>()
    for (const l of dia) {
      if (!l.id_par_transferencia) continue
      const p = pares.get(l.id_par_transferencia) ?? {}
      if (l.tipo === 'DESPESA') p.saida = l
      else if (l.tipo === 'RECEITA') p.entrada = l
      pares.set(l.id_par_transferencia, p)
    }
    const colocados = new Set<string>()
    for (const l of dia) {
      if (colocados.has(l.id)) continue
      const par = l.id_par_transferencia ? pares.get(l.id_par_transferencia) : undefined
      if (par?.saida && par.entrada) {
        out.push(par.saida, par.entrada)
        colocados.add(par.saida.id)
        colocados.add(par.entrada.id)
        continue
      }
      out.push(l)
      colocados.add(l.id)
    }
  }
  return out
}
