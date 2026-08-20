// src/components/ui/DiffAuditoria.tsx
//
// Renderiza o "o que mudou" de um evento da trilha de auditoria
// (arqvalor.trilha_auditoria — ver migrations 20260806000004 + 20260820000001):
// INSERT/DELETE mostram os campos do snapshot; UPDATE mostra só os campos
// que realmente mudaram (antes → depois). Compartilhado entre
// AdminAuditoriaPage (admin, qualquer tabela) e o modal "Ver alterações" do
// card Últimas alterações do Dashboard (usuário comum, só transacoes).
//
// Lógica pura em lib/auditoriaDiff.ts — este arquivo só exporta o componente
// (react-refresh/only-export-components exige isso pra manter o Fast Refresh).
import {
  type ItemDiffAuditoria, MUTED_AUDITORIA, CAMPOS_OMITIDOS_AUDITORIA,
  formatValorAuditoria, camposAlteradosAuditoria, labelCampoAuditoria,
} from '../../lib/auditoriaDiff'

interface Props {
  item: ItemDiffAuditoria
  // conta_id é um UUID cru sem contexto nenhum pro usuário — quando o
  // chamador tem a lista de contas em mãos (ex.: Dashboard), passa aqui e
  // o campo conta_id troca o id pelo nome da conta. Opcional: sem isso
  // (ex.: AdminAuditoriaPage, que cobre TODAS as tabelas/usuários) cai de
  // volta pro valor cru.
  contas?: { conta_id: string; nome: string }[]
}

// Troca conta_id pelo nome da conta quando o mapa foi passado; qualquer
// outro campo usa a formatação padrão.
function formatCampo(campo: string, valor: unknown, nomePorConta: Map<string, string>): string {
  if (campo === 'conta_id' && typeof valor === 'string' && nomePorConta.has(valor)) {
    return nomePorConta.get(valor)!
  }
  return formatValorAuditoria(valor)
}

export default function DiffAuditoria({ item, contas }: Props) {
  const nomePorConta = new Map((contas ?? []).map(c => [c.conta_id, c.nome]))

  if (item.operacao === 'INSERT') {
    const campos = Object.entries(item.dados_novos ?? {}).filter(([k]) => !CAMPOS_OMITIDOS_AUDITORIA.has(k))
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {campos.slice(0, 8).map(([k, v]) => (
          <span key={k} className="text-[12px]" style={{ color: MUTED_AUDITORIA }}>
            {labelCampoAuditoria(k)}: <span style={{ color: '#c5cbd3' }}>{formatCampo(k, v, nomePorConta)}</span>
          </span>
        ))}
      </div>
    )
  }
  if (item.operacao === 'DELETE') {
    const campos = Object.entries(item.dados_antigos ?? {}).filter(([k]) => !CAMPOS_OMITIDOS_AUDITORIA.has(k))
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {campos.slice(0, 8).map(([k, v]) => (
          <span key={k} className="text-[12px]" style={{ color: MUTED_AUDITORIA }}>
            {labelCampoAuditoria(k)}: <span style={{ color: '#c5cbd3' }}>{formatCampo(k, v, nomePorConta)}</span>
          </span>
        ))}
      </div>
    )
  }
  const alterados = camposAlteradosAuditoria(item.dados_antigos, item.dados_novos)
  if (alterados.length === 0) {
    return <p className="text-[12px]" style={{ color: MUTED_AUDITORIA }}>Nenhum campo visível mudou.</p>
  }
  return (
    <div className="flex flex-col gap-1">
      {alterados.map(({ campo, de, para }) => (
        <div key={campo} className="text-[12px] flex flex-wrap items-center gap-1.5">
          <span style={{ color: MUTED_AUDITORIA }}>{labelCampoAuditoria(campo)}:</span>
          <span style={{ color: '#f87171' }}>{formatCampo(campo, de, nomePorConta)}</span>
          <span style={{ color: MUTED_AUDITORIA }}>→</span>
          <span style={{ color: '#4ade80' }}>{formatCampo(campo, para, nomePorConta)}</span>
        </div>
      ))}
    </div>
  )
}
