// Quadro "Avaliação do Conselho" da página do ativo: mostra a última avaliação
// dos mentores de IA deste ativo (a mesma de /investimentos/avaliacoes) —
// nota final, tendência, nível de consenso, nota por critério e por mentor.
// Somente leitura; para reavaliar, o link leva à página de Avaliações.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Minus, Users } from 'lucide-react'
import { useInvAvaliacoes } from '../../hooks/useInvAvaliacoes'
import { CRITERIOS_QUESTAO, CRITERIO_LABEL } from '../../lib/constants'
import { rotuloMentor } from '../../lib/iaProvedores'
import { formatData } from '../../lib/utils'
import type { NivelConsenso } from '../../types'

const MUTED = '#8b92a8'
const COR_CONSENSO: Record<NivelConsenso, string> = { ALTO: '#00c896', MEDIO: '#f0b429', BAIXO: '#ff5c7a' }
const LABEL_CONSENSO: Record<NivelConsenso, string> = { ALTO: 'Alto', MEDIO: 'Médio', BAIXO: 'Baixo' }

function corNota(n: number | null | undefined): string {
  if (n == null) return MUTED
  return n >= 7 ? '#00c896' : n < 5 ? '#ff5c7a' : '#f0b429'
}
const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1))

export default function QuadroAvaliacaoMentores({ ativoId }: { ativoId: string }) {
  const { avaliacoes, loading } = useInvAvaliacoes()
  const [verTodas, setVerTodas] = useState(false)
  const av = avaliacoes.find(a => a.ativo_id === ativoId)

  const notasMentores = av?.consenso.mentores.map(m => m.nota).filter((v): v is number => v != null) ?? []
  let nivel: NivelConsenso | null = av?.consenso.nivel_consenso ?? null
  if (av && !nivel) {
    if (notasMentores.length < 2) nivel = 'ALTO'
    else {
      const m = notasMentores.reduce((s, v) => s + v, 0) / notasMentores.length
      const dp = Math.sqrt(notasMentores.reduce((s, v) => s + (v - m) ** 2, 0) / notasMentores.length)
      nivel = dp < 1 ? 'ALTO' : dp < 2 ? 'MEDIO' : 'BAIXO'
    }
  }

  const h = av?.historico
  const atual = h?.[h.length - 1]?.nota_final
  const anterior = h && h.length >= 2 ? h[h.length - 2]?.nota_final : null
  const delta = atual != null && anterior != null ? Math.round((atual - anterior) * 10) / 10 : null
  const dir = delta == null ? null : Math.abs(delta) < 0.05 ? 'manteve' : delta > 0 ? 'subiu' : 'desceu'
  const corTend = dir === 'subiu' ? '#00c896' : dir === 'desceu' ? '#ff5c7a' : MUTED
  const IconTend = dir === 'subiu' ? ArrowUp : dir === 'desceu' ? ArrowDown : Minus

  // Mais recente primeiro; por padrão só as 5 últimas.
  const histCompleto = [...(h ?? [])].reverse()
  const histVisivel = verTodas ? histCompleto : histCompleto.slice(0, 5)

  return (
    <section className="h-full rounded-xl border border-white/10 bg-white/[0.02] p-4" data-tutorial="detalhe-avaliacao-mentores">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-[14px] font-semibold text-white/80 flex items-center gap-1.5">
          <Users size={14} /> Avaliação do Conselho
        </h2>
        <Link to="/investimentos/avaliacoes" className="text-[12.5px] text-av-green hover:underline">
          Ver avaliações →
        </Link>
      </div>

      {loading && <p className="text-[13px]" style={{ color: MUTED }}>Carregando…</p>}

      {!loading && !av && (
        <p className="text-[13px]" style={{ color: MUTED }}>
          Este ativo ainda não foi avaliado pelos mentores. Rode a avaliação em Avaliações.
        </p>
      )}

      {av && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <span className="text-[34px] font-bold leading-none" style={{ color: corNota(av.nota_final) }}>
              {fmt(av.nota_final)}
            </span>
            <span className="text-[12px] pb-1" style={{ color: MUTED }}>nota final (0–10)</span>
            {dir && delta != null && (
              <span className="inline-flex items-center gap-0.5 text-[12px] pb-1" style={{ color: corTend }}
                title={`Avaliação anterior: ${fmt(anterior)}`}>
                <IconTend size={13} />{dir !== 'manteve' && (delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1))}
              </span>
            )}
            {nivel && (
              <span className="ml-auto text-[12px] pb-1" style={{ color: MUTED }}>
                Consenso <span className="font-semibold" style={{ color: COR_CONSENSO[nivel] }}>{LABEL_CONSENSO[nivel]}</span>
              </span>
            )}
          </div>

          {av.consenso.criterios && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {CRITERIOS_QUESTAO.map(c => (
                <div key={c} className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2.5 py-1.5">
                  <span className="text-[12px] truncate" style={{ color: MUTED }}>{CRITERIO_LABEL[c]}</span>
                  <span className="text-[13px] font-semibold shrink-0" style={{ color: corNota(av.consenso.criterios?.[c]) }}>
                    {fmt(av.consenso.criterios?.[c])}
                  </span>
                </div>
              ))}
            </div>
          )}

          {av.consenso.mentores.length > 0 && (
            <div>
              <p className="text-[10.5px] uppercase tracking-wide mb-1" style={{ color: MUTED }}>Nota por mentor</p>
              <div className="flex flex-wrap gap-1.5">
                {av.consenso.mentores.map(m => (
                  <span key={m.config_id} className="rounded-md border border-white/10 px-2 py-1 text-[12.5px]"
                    title={m.erro ?? m.modelo ?? undefined}>
                    <span style={{ color: MUTED }}>{rotuloMentor(m.nome, m.provedor)}</span>{' '}
                    <span className="font-semibold" style={{ color: m.erro ? '#f87171' : corNota(m.nota) }}>
                      {m.erro ? 'erro' : fmt(m.nota)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {histCompleto.length > 0 && (
            <div>
              <p className="text-[10.5px] uppercase tracking-wide mb-1" style={{ color: MUTED }}>
                Histórico de avaliações ({histCompleto.length})
              </p>
              <div className="rounded-md border border-white/10 divide-y divide-white/5">
                {histVisivel.map((it, i) => {
                  const ant = histCompleto[i + 1]?.nota_final
                  const d = it.nota_final != null && ant != null ? Math.round((it.nota_final - ant) * 10) / 10 : null
                  return (
                    <div key={it.gerado_em} className="flex items-center gap-3 px-2.5 py-1.5 text-[12.5px] flex-wrap">
                      <span className="w-[78px] shrink-0" style={{ color: MUTED }}>{formatData(it.gerado_em.slice(0, 10))}</span>
                      <span className="font-semibold w-[34px] shrink-0" style={{ color: corNota(it.nota_final) }}>{fmt(it.nota_final)}</span>
                      <span className="w-[40px] shrink-0 text-[11.5px]"
                        style={{ color: d == null || Math.abs(d) < 0.05 ? MUTED : d > 0 ? '#00c896' : '#ff5c7a' }}>
                        {d == null ? '' : Math.abs(d) < 0.05 ? '=' : d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1)}
                      </span>
                      {it.criterios && (
                        <span className="text-[11.5px]" style={{ color: MUTED }}>
                          {CRITERIOS_QUESTAO.map(c => `${CRITERIO_LABEL[c].split(' ')[0]} ${fmt(it.criterios?.[c])}`).join(' · ')}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              {histCompleto.length > 5 && (
                <button type="button" onClick={() => setVerTodas(v => !v)}
                  className="mt-1 text-[12px] text-av-green hover:underline">
                  {verTodas ? 'Mostrar menos' : `Ver todas (${histCompleto.length})`}
                </button>
              )}
            </div>
          )}

          <p className="text-[11.5px]" style={{ color: MUTED }}>Avaliado em {formatData(av.gerado_em.slice(0, 10))}</p>
        </div>
      )}
    </section>
  )
}
