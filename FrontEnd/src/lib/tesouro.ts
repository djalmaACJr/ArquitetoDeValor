// Identificadores legíveis e determinísticos para títulos do Tesouro Direto.
// O Tesouro não tem "ticker" de mercado — geramos um a partir dos campos
// estruturados (indexador + vencimento + juros semestrais) para que busca,
// cadastro manual e importação produzam SEMPRE o mesmo código (sem duplicar)
// e a marcação a mercado encontre o vencimento.
import type { IndexadorRF } from './constants'

// Família do Tesouro conforme o indexador estruturado:
// PREFIXADO → Prefixado · POS_FIXADO → Selic · HIBRIDO → IPCA+
const COD_FAMILIA: Record<IndexadorRF, string> = {
  PREFIXADO: 'PRE', POS_FIXADO: 'SELIC', HIBRIDO: 'IPCA',
}
const NOME_FAMILIA: Record<IndexadorRF, string> = {
  PREFIXADO: 'Prefixado', POS_FIXADO: 'Selic', HIBRIDO: 'IPCA+',
}

// Rótulos do indexador no contexto do Tesouro (mais intuitivos que os
// genéricos de renda fixa: "Pós-fixado"/"Híbrido").
export const INDEXADOR_TESOURO_LABEL: Record<IndexadorRF, string> = {
  PREFIXADO: 'Prefixado', POS_FIXADO: 'Selic (pós-fixado)', HIBRIDO: 'IPCA+ (híbrido)',
}

// Ano do vencimento ('YYYY-MM-DD' → 'YYYY'); null se inválido.
export function anoVencimento(vencimento: string | null | undefined): string | null {
  const m = String(vencimento ?? '').match(/^(\d{4})-\d{2}-\d{2}/)
  return m ? m[1] : null
}

// Selic não tem variação "com Juros Semestrais"; só Prefixado (NTN-F) e IPCA+
// (NTN-B) têm. Normaliza o flag para o indexador.
const temSemestral = (indexador: IndexadorRF, semestral: boolean) =>
  semestral && indexador !== 'POS_FIXADO'

// Ticker legível: TD-IPCA-2040, TD-IPCA-JS-2060, TD-PRE-2027, TD-SELIC-2029.
// '' quando faltam indexador/vencimento (chamador trata como incompleto).
export function tickerTesouro(
  indexador: IndexadorRF | null | undefined, vencimento: string | null | undefined, semestral = false,
): string {
  const ano = anoVencimento(vencimento)
  if (!indexador || !ano) return ''
  const js = temSemestral(indexador, semestral) ? '-JS' : ''
  return `TD-${COD_FAMILIA[indexador]}${js}-${ano}`
}

// Nome amigável: "Tesouro IPCA+ 2040", "Tesouro IPCA+ com Juros Semestrais 2060".
export function nomeTesouro(
  indexador: IndexadorRF | null | undefined, vencimento: string | null | undefined, semestral = false,
): string {
  if (!indexador) return ''
  const ano = anoVencimento(vencimento)
  const js = temSemestral(indexador, semestral) ? ' com Juros Semestrais' : ''
  return `Tesouro ${NOME_FAMILIA[indexador]}${js}${ano ? ` ${ano}` : ''}`
}

// tipo_titulo (rótulo do STN) usado em cotacoes_tesouro — para buscar os
// vencimentos disponíveis na marcação a mercado. Selic não tem MtM → null.
export function tipoTituloTesouro(
  indexador: IndexadorRF | null | undefined, semestral = false,
): string | null {
  if (indexador !== 'PREFIXADO' && indexador !== 'HIBRIDO') return null
  const base = indexador === 'PREFIXADO' ? 'Tesouro Prefixado' : 'Tesouro IPCA+'
  return semestral ? `${base} com Juros Semestrais` : base
}

// Detecta "com juros semestrais" pelo nome oficial (para pré-marcar o flag ao
// editar um título já cadastrado). Espelha a heurística do backend (puTesouro).
export function ehSemestral(nome: string | null | undefined): boolean {
  const s = String(nome ?? '')
  return /semestr|ntn-?f/i.test(s) || (/ntn-?b/i.test(s) && !/princ/i.test(s))
}
