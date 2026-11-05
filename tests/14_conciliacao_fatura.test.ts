// Conferência da fatura em modo CATEGORIA — lib pura, sem rede/Supabase.
import { alvosDosGrupos } from '../FrontEnd/src/lib/faturaConciliacao'

const item = (id: string, existente: string | null = null, criada: string | null = null, decisao = 'PENDENTE') =>
  ({ id, decisao, transacao_existente_id: existente, transacao_criada_id: criada })
const grupo = (item_ids: string[], transacao_existente_id: string | null = null) =>
  ({ item_ids, transacao_existente_id })

describe('alvosDosGrupos', () => {
  it('CA-CON01 — dois itens vinculados no mesmo grupo: só uma transação é alvo; a outra fica órfã', () => {
    // Netflix e Crunchyroll agrupados em "Streaming", cada um com seu lançamento.
    const itens = [item('i-net', 'tx-net'), item('i-cru', 'tx-cru')]
    const alvos = alvosDosGrupos([grupo(['i-net', 'i-cru'])], itens)
    expect([...alvos]).toEqual(['tx-net'])
    expect(alvos.has('tx-cru')).toBe(false)
  })

  it('CA-CON02 — um item por grupo: cada transação vinculada é alvo do seu grupo', () => {
    const itens = [item('a', 'tx-a'), item('b', 'tx-b')]
    const alvos = alvosDosGrupos([grupo(['a']), grupo(['b'])], itens)
    expect(alvos).toEqual(new Set(['tx-a', 'tx-b']))
  })

  it('CA-CON03 — transacao_existente_id explícita do grupo vence a do item', () => {
    const itens = [item('a', 'tx-a'), item('b', 'tx-b')]
    expect([...alvosDosGrupos([grupo(['a', 'b'], 'tx-b')], itens)]).toEqual(['tx-b'])
  })

  it('CA-CON04 — sem vínculo, usa a transação criada numa confirmação anterior', () => {
    const itens = [item('a', null, 'tx-criada')]
    expect([...alvosDosGrupos([grupo(['a'])], itens)]).toEqual(['tx-criada'])
  })

  it('CA-CON05 — a mesma transação só é alvo de um grupo (o maior fica com ela)', () => {
    const itens = [item('a', 'tx-x'), item('b', 'tx-x'), item('c', 'tx-x')]
    const alvos = alvosDosGrupos([grupo(['a']), grupo(['b', 'c'])], itens)
    expect(alvos).toEqual(new Set(['tx-x']))
  })

  it('CA-CON06 — itens ignorados não geram alvo', () => {
    const itens = [item('a', 'tx-a', null, 'IGNORAR')]
    expect(alvosDosGrupos([grupo(['a'])], itens).size).toBe(0)
  })
})
