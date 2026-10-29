// Ordem das pernas de transferência no Extrato — lib pura, sem rede/Supabase.
import { ordenarPernasDeTransferencia } from '../FrontEnd/src/lib/ordemTransferencias'

const perna = (id: string, data: string, tipo: 'DESPESA' | 'RECEITA', par: string | null = null) =>
  ({ id, data, tipo, id_par_transferencia: par })
const ids = (l: { id: string }[]) => l.map((x) => x.id)

describe('ordenarPernasDeTransferencia', () => {
  it('CA-ORD01 — entrada antes da saída do mesmo par: a saída sobe para antes da entrada', () => {
    const r = ordenarPernasDeTransferencia([
      perna('ent', '2026-10-05', 'RECEITA', 'P1'),
      perna('sai', '2026-10-05', 'DESPESA', 'P1'),
    ])
    expect(ids(r)).toEqual(['sai', 'ent'])
  })

  it('CA-ORD02 — as duas pernas ficam coladas (saída, entrada) e os demais lançamentos mantêm a ordem', () => {
    const lista = [
      perna('a', '2026-10-05', 'DESPESA'),
      perna('sai', '2026-10-05', 'DESPESA', 'P1'),
      perna('b', '2026-10-05', 'RECEITA'),
      perna('ent', '2026-10-05', 'RECEITA', 'P1'),
    ]
    expect(ids(ordenarPernasDeTransferencia(lista))).toEqual(['a', 'sai', 'ent', 'b'])
  })

  it('CA-ORD07 — outros lançamentos entre as pernas saem do meio; o par ocupa a posição da 1ª perna', () => {
    const r = ordenarPernasDeTransferencia([
      perna('x',   '2026-10-05', 'DESPESA'),
      perna('ent', '2026-10-05', 'RECEITA', 'P1'),
      perna('y',   '2026-10-05', 'RECEITA'),
      perna('sai', '2026-10-05', 'DESPESA', 'P1'),
    ])
    expect(ids(r)).toEqual(['x', 'sai', 'ent', 'y'])
  })

  it('CA-ORD03 — só reordena dentro da mesma data (não puxa a saída de outro dia)', () => {
    const r = ordenarPernasDeTransferencia([
      perna('ent', '2026-10-05', 'RECEITA', 'P1'),
      perna('x',   '2026-10-05', 'DESPESA'),
      perna('sai', '2026-10-06', 'DESPESA', 'P1'),
    ])
    expect(ids(r)).toEqual(['ent', 'x', 'sai'])
  })

  it('CA-ORD04 — com filtro de conta só uma perna está na lista: nada muda', () => {
    const lista = [perna('ent', '2026-10-05', 'RECEITA', 'P1'), perna('c', '2026-10-05', 'DESPESA')]
    expect(ordenarPernasDeTransferencia(lista)).toEqual(lista)
  })

  it('CA-ORD05 — vários pares no mesmo dia: cada saída fica antes da sua entrada, sem perder nem duplicar linhas', () => {
    const r = ordenarPernasDeTransferencia([
      perna('e1', '2026-10-05', 'RECEITA', 'P1'),
      perna('e2', '2026-10-05', 'RECEITA', 'P2'),
      perna('s2', '2026-10-05', 'DESPESA', 'P2'),
      perna('s1', '2026-10-05', 'DESPESA', 'P1'),
    ])
    expect(ids(r)).toEqual(['s1', 'e1', 's2', 'e2'])
    expect(new Set(ids(r)).size).toBe(4)
  })

  it('CA-ORD06 — lista sem transferência volta a mesma referência', () => {
    const lista = [perna('a', '2026-10-05', 'DESPESA')]
    expect(ordenarPernasDeTransferencia(lista)).toBe(lista)
  })
})
