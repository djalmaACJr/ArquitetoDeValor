// Quadro "Proteção do Poder de Compra" — quanto do provento recebido (posição
// inteira) precisa ser reinvestido pra só REPOR a inflação (IPCA) sobre o
// valor de mercado da posição, e quanto sobra como renda real (livre pra
// gastar). Considera também se compras/aportes dos últimos 12 meses já
// cobriram a perda de inflação sobre o patrimônio mais antigo (ver
// calcularProtecaoPoderCompraCompleta). Só faz sentido pra FIIs (cota com
// valor de mercado + provento recorrente) — quem monta chama isto só quando
// o ativo é FII.
import { useMemo, useState } from 'react'
import { Shield, AlertTriangle, RotateCcw, CheckCircle2 } from 'lucide-react'
import { formatBRL, mesLabel } from '../../lib/utils'
import { calcularProtecaoPoderCompraCompleta, type OperacaoCompraSimples } from '../../lib/protecaoPoderCompra'

const MUTED = 'var(--text-muted)'
const COR_REINVESTIMENTO = '#ffb74d'
const COR_RENDA_LIVRE = '#00c896'
const COR_ALERTA = '#ff5c7a'

// 2 casas decimais (não arredonda pro inteiro mais próximo): um IPCA de
// -0,32% arredondado vira "0%" e passa a impressão de que não há
// inflação/deflação nenhuma — junto com o reinvestimento em R$ 0,00 (zerado
// de propósito, ver deflacao em calcularProtecaoPoderCompra), isso parecia
// um bug. Ex.: 133,4 → "133,40%"; -0,32 → "-0,32%".
const fmtPct = (v: number) => `${v.toFixed(2).replace('.', ',')}%`

export interface ProtecaoPoderCompraProps {
  /** Valor de mercado da POSIÇÃO INTEIRA que o provento precisa proteger (preço atual da cota × quantidade). */
  valorPatrimonio: number
  /** Provento total recebido no período, na MESMA base de `valorPatrimonio` (posição inteira, não por cota). */
  rendimentoTotal: number
  /** Preço de UMA cota — traduz o reinvestimento necessário em nº de cotas
   *  (não dá pra comprar cota fracionada, ver `cotasNecessarias`). */
  precoCota: number
  /** IPCA acumulado 12 meses (%) sugerido pra começar a simulação — o
   *  usuário pode ajustar pra simular outro cenário (ex.: só o último mês). */
  ipcaSugerido: number
  /** Competência ('YYYY-MM') do fim da janela de 12 meses do IPCA sugerido —
   *  exibida como referência (o índice oficial sai com atraso; o "último"
   *  disponível pode não ser ainda o mês corrente). */
  ipcaCompetencia?: string
  /** Histórico de COMPRAS do ativo (todas as posições) — usado pra ver se
   *  aportes dos últimos 12 meses já cobriram a perda de inflação sobre o
   *  patrimônio mais antigo (ver calcularCoberturaAportes12m). */
  historicoCompras: OperacaoCompraSimples[]
  /** Repassado quando o usuário edita o campo, se quem chama quiser refletir em outro lugar. */
  onIpcaChange?: (v: number) => void
}

export default function ProtecaoPoderCompra({
  valorPatrimonio, rendimentoTotal, precoCota, ipcaSugerido, ipcaCompetencia, historicoCompras, onIpcaChange,
}: ProtecaoPoderCompraProps) {
  const [ipcaTexto, setIpcaTexto] = useState(() => String(ipcaSugerido).replace('.', ','))
  // `ipcaSugerido` normalmente chega como um fallback (0,4%) e é substituído
  // pelo valor real assim que a consulta ao IPCA responde. Ajusta o estado
  // DURANTE o render (padrão recomendado pelo React pra "sincronizar estado
  // quando uma prop muda", em vez de um useEffect chamando setState) — sem
  // isso, o campo ficaria travado no fallback (o valor real chegaria depois
  // do useState já ter rodado) OU, pior, um segundo ajuste do prop apagaria
  // o que o usuário tivesse digitado nesse meio-tempo.
  const [editadoPeloUsuario, setEditadoPeloUsuario] = useState(false)
  const [ipcaSugeridoAnterior, setIpcaSugeridoAnterior] = useState(ipcaSugerido)
  if (ipcaSugerido !== ipcaSugeridoAnterior) {
    setIpcaSugeridoAnterior(ipcaSugerido)
    if (!editadoPeloUsuario) setIpcaTexto(String(ipcaSugerido).replace('.', ','))
  }

  const taxaIpca = useMemo(() => {
    const n = Number(ipcaTexto.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }, [ipcaTexto])

  const r = useMemo(
    () => calcularProtecaoPoderCompraCompleta(valorPatrimonio, rendimentoTotal, taxaIpca, historicoCompras, precoCota),
    [valorPatrimonio, rendimentoTotal, taxaIpca, historicoCompras, precoCota],
  )

  const alterarIpca = (v: string) => {
    setEditadoPeloUsuario(true)
    setIpcaTexto(v)
    const n = Number(v.replace(',', '.'))
    if (Number.isFinite(n)) onIpcaChange?.(n)
  }
  const foiEditado = ipcaTexto.replace(',', '.') !== String(ipcaSugerido)
  const restaurarPadrao = () => {
    setEditadoPeloUsuario(false)
    setIpcaTexto(String(ipcaSugerido).replace('.', ','))
    onIpcaChange?.(ipcaSugerido)
  }

  return (
    <section className="rounded-xl border p-4"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-start gap-2.5">
          <Shield size={18} className="mt-0.5 shrink-0" style={{ color: COR_RENDA_LIVRE }} />
          <div>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Proteção do Poder de Compra
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>
              Quanto do provento precisa voltar pra cota só pra empatar com a inflação acumulada em 12 meses — o resto é renda real.
            </p>
          </div>
        </div>

        {/* Controle rápido: simular outro IPCA */}
        <div className="flex items-center gap-1.5">
          <label className="text-[12px]" style={{ color: MUTED }} htmlFor="protecao-ipca-input">
            IPCA 12m{ipcaCompetencia && !foiEditado ? ` (até ${mesLabel(ipcaCompetencia)})` : ''}
          </label>
          <div className="flex items-center rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
            <input id="protecao-ipca-input" type="text" inputMode="decimal" value={ipcaTexto}
              onChange={(e) => alterarIpca(e.target.value)}
              className="w-14 bg-transparent px-2 py-1.5 text-[13px] text-right outline-none"
              style={{ color: 'var(--text-primary)' }} />
            <span className="pr-2 text-[13px]" style={{ color: MUTED }}>%</span>
          </div>
          {foiEditado && (
            <button onClick={restaurarPadrao} title={`Voltar para ${ipcaSugerido}% (IPCA acumulado dos últimos 12 meses)`}
              className="w-7 h-7 rounded-md border flex items-center justify-center hover:border-white/25"
              style={{ borderColor: 'var(--border-subtle)', color: MUTED }}>
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Taxa MENSAL de fato aplicada sobre o patrimônio — o IPCA acima é o
          acumulado de 12 meses; sem isso à vista, não dá pra conferir que o
          reinvestimento abaixo usa a taxa convertida, não a anual crua. */}
      <p className="text-[11px] text-right -mt-3 mb-4" style={{ color: MUTED }}>
        equivalente a {fmtPct(r.taxaMensalAplicadaPct)} ao mês
      </p>

      {/* Cobertura por aportes recentes — só faz sentido exibir quando há de
          fato um patrimônio anterior (comprado há mais de 12 meses) sendo
          corroído pela inflação; posição toda nova (sem base anterior) não
          tem "defasagem" nenhuma pra cobrir. */}
      {r.cobertura.perdaInflacaoAnual > 0 && (
        r.cobertura.isDefasagemCoberta ? (
          <div className="flex items-start gap-2 mb-4 rounded-lg px-3 py-2"
            style={{ background: `${COR_RENDA_LIVRE}15`, border: `1px solid ${COR_RENDA_LIVRE}40` }}>
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: COR_RENDA_LIVRE }} />
            <p className="text-[12px]" style={{ color: COR_RENDA_LIVRE }}>
              <span className="font-semibold">Defasagem coberta por compras.</span> Suas compras dos
              últimos 12 meses ({formatBRL(r.cobertura.totalAportes12m)}) já cobriram a perda de inflação
              do ano sobre o patrimônio anterior ({formatBRL(r.cobertura.perdaInflacaoAnual)}) — o
              rendimento deste mês é 100% renda livre.
            </p>
          </div>
        ) : (
          <p className="text-[11px] mb-4" style={{ color: MUTED }}>
            Compras dos últimos 12 meses ({formatBRL(r.cobertura.totalAportes12m)}) cobriram parte da
            perda de inflação do ano sobre o patrimônio anterior ({formatBRL(r.cobertura.perdaInflacaoAnual)})
            — ainda faltam {formatBRL(r.cobertura.defasagemPendente)}.
          </p>
        )
      )}

      {/* Blocos de métrica */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg p-3" style={{ background: 'var(--tint-1)' }}>
          <p className="text-[11px]" style={{ color: MUTED }}>Rendimento recebido</p>
          <p className="text-[16px] font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
            {formatBRL(rendimentoTotal)}
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--tint-1)' }}>
          <p className="text-[11px]" style={{ color: MUTED }}>Reinvestimento mínimo (IPCA)</p>
          <p className="text-[16px] font-semibold mt-0.5" style={{ color: COR_REINVESTIMENTO }}>
            {formatBRL(r.valorReinvestimento)}
            <span className="text-[12px] font-normal ml-1.5" style={{ color: MUTED }}>{fmtPct(r.percentualReinvestimento)}</span>
          </p>
          {/* Zerado de propósito com IPCA negativo (deflação) — sem isso,
              "R$ 0,00" ao lado de um "0%" parece bug em vez de intencional. */}
          {r.deflacao && (
            <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
              Taxa mensal de {fmtPct(r.taxaMensalAplicadaPct)} (deflação) — nada a repor neste mês
            </p>
          )}
          {/* Não dá pra comprar cota fracionada — o valor "exato" acima é só
              referência; na prática o usuário compra um nº inteiro de cotas,
              arredondado pra cima (cobre um pouco A MAIS que o mínimo). */}
          {!!r.cotasNecessarias && (
            <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
              ≈ {r.cotasNecessarias} cota{r.cotasNecessarias === 1 ? '' : 's'} nova{r.cotasNecessarias === 1 ? '' : 's'}
              {' '}({formatBRL(r.cotasNecessarias * precoCota)})
            </p>
          )}
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--tint-1)' }}>
          <p className="text-[11px]" style={{ color: MUTED }}>Renda real livre</p>
          <p className="text-[16px] font-semibold mt-0.5" style={{ color: r.deficit ? COR_ALERTA : COR_RENDA_LIVRE }}>
            {formatBRL(r.rendaRealLivre)}
            <span className="text-[12px] font-normal ml-1.5" style={{ color: MUTED }}>{fmtPct(r.percentualRendaLivre)}</span>
          </p>
        </div>
      </div>

      {/* Barra proporcional */}
      {r.semRendimento ? (
        <p className="text-[12px] text-center py-1" style={{ color: MUTED }}>Sem provento neste período.</p>
      ) : (
        <div className="h-3 rounded-full overflow-hidden flex" style={{ background: 'var(--tint-2)' }}
          title={`${fmtPct(r.percentualReinvestimentoBarra)} reinvestimento · ${fmtPct(r.percentualRendaLivreBarra)} renda livre`}>
          {r.percentualReinvestimentoBarra > 0 && (
            <div style={{ width: `${r.percentualReinvestimentoBarra}%`, background: COR_REINVESTIMENTO }} />
          )}
          {r.percentualRendaLivreBarra > 0 && (
            <div style={{ width: `${r.percentualRendaLivreBarra}%`, background: COR_RENDA_LIVRE }} />
          )}
        </div>
      )}
      <div className="flex items-center justify-between mt-1.5 text-[11px]" style={{ color: MUTED }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: COR_REINVESTIMENTO }} /> Reinvestir
        </span>
        <span className="inline-flex items-center gap-1.5">
          Renda livre <span className="w-2 h-2 rounded-full" style={{ background: COR_RENDA_LIVRE }} />
        </span>
      </div>

      {/* Alerta: inflação supera o provento */}
      {r.deficit && (
        <div className="flex items-start gap-2 mt-3 rounded-lg px-3 py-2"
          style={{ background: `${COR_ALERTA}15`, border: `1px solid ${COR_ALERTA}40` }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: COR_ALERTA }} />
          <p className="text-[12px]" style={{ color: COR_ALERTA }}>
            Atenção: a inflação deste período foi superior ao rendimento distribuído — mesmo reinvestindo
            tudo, a cota perde poder de compra.
          </p>
        </div>
      )}
    </section>
  )
}
