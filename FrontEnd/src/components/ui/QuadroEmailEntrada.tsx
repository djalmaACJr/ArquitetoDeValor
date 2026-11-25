import { useState } from 'react'
import { Check, Copy, Inbox, Mail, ShieldAlert, Trash2 } from 'lucide-react'
import { useEmailEntrada } from '../../hooks/useEmailEntrada'
import { SelectDark } from './shared'
import { AjudaEncaminhamento, SugestoesRemetentes } from './AjudaEmailEntrada'
import type { EmailEntradaMensagem } from '../../types'

const MUTED = '#8b92a8'
const RETENCOES = [7, 30, 60, 90, 180, 365]
const CLASSE: Record<string, string> = { ASSEMBLEIA: 'Assembleia', RENDIMENTO: 'Rendimento', FATO_RELEVANTE: 'Fato relevante', OUTRO: 'Outro' }

function quandoBR(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ${d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`
}

function Mensagem({ m, onVista, onDecidir, onExcluir }: {
  m: EmailEntradaMensagem; onVista: () => void; onDecidir: (a: 'aprovar' | 'bloquear') => void; onExcluir: () => void
}) {
  const quarentena = m.status === 'QUARENTENA'
  return (
    <div className="rounded-xl border p-3 space-y-1.5"
      style={{ borderColor: quarentena ? 'rgba(240,180,41,0.5)' : !m.visto_em ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}
      onMouseEnter={() => { if (!m.visto_em && !quarentena) onVista() }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white text-[14px] font-semibold break-words">{m.assunto || '(sem assunto)'}</p>
          <p className="text-[12px] break-all" style={{ color: MUTED }}>
            {m.remetente} · {quandoBR(m.recebido_em)}
            {m.classificacao && <span> · {CLASSE[m.classificacao] ?? m.classificacao}</span>}
            {m.status === 'IGNORADO' && <span> · bloqueado</span>}
          </p>
        </div>
        <button onClick={onExcluir} title="Excluir" aria-label="Excluir mensagem" className="p-1.5 rounded-md hover:bg-white/10 shrink-0" style={{ color: MUTED }}><Trash2 size={15} /></button>
      </div>
      {m.resumo && (
        <div className="space-y-1">
          <p className="text-[13px] text-white/90">{m.resumo}</p>
          {m.classificacao === 'ASSEMBLEIA' && m.inv_ativos?.ticker && (
            <p className="text-[12px]" style={{ color: '#f0b429' }}>Pode ser sobre a assembleia de {m.inv_ativos.ticker}, um FII da sua carteira. Confira o documento oficial na aba Assembleias.</p>
          )}
          <p className="text-[11px]" style={{ color: MUTED }}>Resumo por IA a partir do e-mail — é só um aviso. Confirme datas e prazos no documento oficial.</p>
        </div>
      )}
      {quarentena && (
        <div className="rounded-lg p-2.5 space-y-2" style={{ background: 'rgba(240,180,41,0.08)' }}>
          <p className="text-[12px] flex items-center gap-1.5" style={{ color: '#f0b429' }}>
            <ShieldAlert size={13} /> Remetente desconhecido (ou sem autenticação válida). Nada foi analisado. Confira antes de aprovar.
          </p>
          {m.trecho && <p className="text-[12px] text-white/70 whitespace-pre-wrap break-words">{m.trecho}</p>}
          <div className="flex gap-2">
            <button onClick={() => onDecidir('aprovar')} className="px-2.5 py-1 rounded-md text-[12px] font-semibold text-white" style={{ background: '#3b82f6' }}>Aprovar remetente</button>
            <button onClick={() => onDecidir('bloquear')} className="px-2.5 py-1 rounded-md text-[12px] hover:bg-white/10" style={{ color: MUTED, border: '1px solid rgba(255,255,255,0.15)' }}>Bloquear</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Caixa de entrada por e-mail: o usuário encaminha e-mails de administradoras/B3 para um endereço próprio.
export default function QuadroEmailEntrada({ avisar }: { avisar: (m: string) => void }) {
  const q = useEmailEntrada()
  const [apelido, setApelido] = useState('')
  const [novoRem, setNovoRem] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [sub, setSub] = useState<'caixa' | 'config'>('caixa')
  const end = q.endereco
  const pendentes = q.mensagens.filter((m) => m.status === 'QUARENTENA').length

  const rodar = async (fn: () => Promise<{ ok: boolean; erro?: string | null }>, ok?: string) => {
    setOcupado(true)
    const r = await fn()
    setOcupado(false)
    avisar(r.ok ? (ok ?? 'Pronto.') : (r.erro ?? 'Não foi possível concluir.'))
    return r.ok
  }

  async function copiar() {
    if (!end) return
    try { await navigator.clipboard.writeText(end.email); setCopiado(true); setTimeout(() => setCopiado(false), 2500) }
    catch { avisar('Não foi possível copiar. Selecione o endereço e copie manualmente.') }
  }

  return (
    <div className="space-y-4" data-tutorial="email-entrada">
      <div>
        <h2 className="text-white text-[16px] font-semibold flex items-center gap-2"><Mail size={16} style={{ color: '#3b82f6' }} /> E-mails</h2>
        <p className="text-[12px] mt-1" style={{ color: MUTED }}>
          Encaminhe para um endereço só seu os e-mails de administradoras e da B3 (convocações, comunicados). O e-mail serve de aviso:
          o app não guarda o texto da mensagem e confirma datas e prazos no documento oficial. Remetentes desconhecidos ficam em quarentena até você aprovar.
        </p>
        <p className="text-[12px] mt-1" style={{ color: MUTED }}>
          Privacidade: o e-mail passa pelo provedor de entrada (Resend), que, segundo a política dele, mantém uma cópia por cerca de 30 dias.
          Excluir uma mensagem aqui apaga o registro do app, mas não a cópia do provedor, que expira sozinha. Por isso, encaminhe só os remetentes de interesse (use filtros) e não encaminhe e-mails com dados sensíveis.
        </p>
      </div>

      {q.loading ? (
        <p className="text-[13px]" style={{ color: MUTED }}>Carregando…</p>
      ) : !end ? (
        <div className="rounded-xl border border-white/10 p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <p className="text-[13px] text-white/90">Escolha um apelido (3 a 20 letras minúsculas e números). O endereço terá um código secreto no final.</p>
          <div className="flex flex-wrap gap-2">
            <input value={apelido} onChange={(e) => setApelido(e.target.value.toLowerCase())} maxLength={20} placeholder="ex.: meunome"
              aria-label="Apelido do endereço" className="px-3 py-1.5 rounded-lg text-[13px] text-white bg-transparent border border-white/20" />
            <button disabled={ocupado || apelido.length < 3} onClick={() => rodar(() => q.criarEndereco(apelido), 'Endereço criado.')}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>Criar meu endereço</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-white/10" role="tablist" aria-label="E-mails">
            {([['caixa', 'Caixa de entrada', pendentes], ['config', 'Configuração e ajuda', 0]] as const).map(([id, rotulo, n]) => (
              <button key={id} role="tab" aria-selected={sub === id} onClick={() => setSub(id)}
                className="px-3 py-1.5 text-[13px] font-medium -mb-px border-b-2 transition-colors"
                style={{ color: sub === id ? '#fff' : MUTED, borderColor: sub === id ? '#3b82f6' : 'transparent' }}>
                {rotulo}{n > 0 && <span className="ml-1.5 text-[11px] text-amber-300">{n} p/ aprovar</span>}
              </button>
            ))}
          </div>

          {sub === 'config' && (
          <>
          <div className="rounded-xl border border-white/10 p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div>
              <p className="text-[12px]" style={{ color: MUTED }}>Seu endereço de entrada</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-[13px] text-white break-all">{end.email}</code>
                <button onClick={copiar} className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] hover:bg-white/10" style={{ color: '#3b82f6', border: '1px solid rgba(59,130,246,0.4)' }}>
                  {copiado ? <Check size={13} /> : <Copy size={13} />} {copiado ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <p className="text-[11px] mt-1" style={{ color: MUTED }}>Não divulgue este endereço. Se vazar, gere outro: o antigo para de funcionar na hora.</p>
            </div>

            <label className="flex items-center gap-2 text-[13px] text-white/90 cursor-pointer">
              <input type="checkbox" checked={end.ativo} disabled={ocupado} onChange={() => rodar(() => q.configurar({ ativo: !end.ativo }), end.ativo ? 'Recebimento pausado.' : 'Recebimento ligado.')} />
              Receber e-mails neste endereço
            </label>

            <label className="flex items-start gap-2 text-[13px] text-white/90 cursor-pointer" data-tutorial="email-resumo-ia">
              <input type="checkbox" className="mt-1" checked={end.resumo_ia} disabled={ocupado}
                onChange={() => rodar(() => q.configurar({ resumo_ia: !end.resumo_ia }), end.resumo_ia ? 'Resumo por IA desligado.' : 'Resumo por IA ligado.')} />
              <span>
                Resumir com IA os e-mails de remetentes permitidos
                <span className="block text-[12px]" style={{ color: MUTED }}>
                  Usa a sua IA ativa (Perfil → Integração com IA) e consome tokens da sua chave: no máximo 10 resumos por dia. Remetentes em quarentena nunca vão para a IA;
                  e-mails já aprovados antes não são resumidos retroativamente.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-end gap-3" data-tutorial="email-retencao">
              <div className="min-w-[200px]">
                <p className="text-[12px] mb-1" style={{ color: MUTED }}>Guardar mensagens por</p>
                <SelectDark value={String(end.retencao_dias)} disabled={ocupado}
                  onChange={(e) => rodar(() => q.configurar({ retencao_dias: Number(e.target.value) }), 'Prazo de retenção salvo.')}>
                  {(RETENCOES.includes(end.retencao_dias) ? RETENCOES : [...RETENCOES, end.retencao_dias].sort((a, b) => a - b)).map((d) => <option key={d} value={String(d)}>{d} dias</option>)}
                </SelectDark>
              </div>
              <button disabled={ocupado} onClick={() => { if (window.confirm('Gerar um novo endereço? O atual deixará de funcionar e você precisará atualizar o encaminhamento nos seus e-mails.')) void rodar(q.renovarCodigo, 'Novo endereço gerado.') }}
                className="px-3 py-1.5 rounded-lg text-[12px] hover:bg-white/10" style={{ color: MUTED, border: '1px solid rgba(255,255,255,0.15)' }}>Gerar novo endereço</button>
            </div>
            <p className="text-[12px]" style={{ color: MUTED }}>Mensagens mais antigas que {end.retencao_dias} dias são apagadas automaticamente, todo dia de manhã.</p>

            <AjudaEncaminhamento />
          </div>

          <div className="rounded-xl border border-white/10 p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <p className="text-white text-[14px] font-semibold">Remetentes</p>
            <p className="text-[12px]" style={{ color: MUTED }}>Aceite um e-mail (a@b.com) ou um domínio inteiro (@b3.com.br). Quem não está na lista vai para a quarentena.</p>
            {q.remetentes.length === 0 ? (
              <p className="text-[12px]" style={{ color: MUTED }}>Nenhum remetente ainda.</p>
            ) : (
              <ul className="space-y-1">
                {q.remetentes.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-[13px] text-white/90">
                    <span className="break-all">{r.padrao} <span className="text-[11px]" style={{ color: r.status === 'PERMITIDO' ? '#4ade80' : '#f87171' }}>{r.status === 'PERMITIDO' ? 'permitido' : 'bloqueado'}</span></span>
                    <button disabled={ocupado} onClick={() => rodar(() => q.removerRemetente(r.id), 'Remetente removido.')} aria-label={`Remover ${r.padrao}`}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] hover:bg-white/10 disabled:opacity-50 shrink-0" style={{ color: '#f87171', border: '1px solid rgba(248,113,113,0.4)' }}>
                      <Trash2 size={13} /> Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <input value={novoRem} onChange={(e) => setNovoRem(e.target.value)} placeholder="@b3.com.br ou aviso@administradora.com.br" aria-label="Novo remetente"
                className="px-3 py-1.5 rounded-lg text-[13px] text-white bg-transparent border border-white/20 min-w-[260px]" />
              <button disabled={ocupado || !novoRem.trim()} onClick={async () => { if (await rodar(() => q.adicionarRemetente(novoRem.trim().toLowerCase()), 'Remetente permitido.')) setNovoRem('') }}
                className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>Permitir</button>
            </div>
            <SugestoesRemetentes jaTem={q.remetentes.map((r) => r.padrao)} ocupado={ocupado}
              onPermitir={(p) => { void rodar(() => q.adicionarRemetente(p), 'Remetente permitido.') }} />
          </div>
          </>
          )}

          {sub === 'caixa' && (
          <div className="space-y-2">
            <p className="text-white text-[14px] font-semibold flex items-center gap-2"><Inbox size={15} style={{ color: '#3b82f6' }} /> Caixa de entrada</p>
            {q.mensagens.length === 0 ? (
              <div className="text-[13px] text-center py-6 space-y-2" style={{ color: MUTED }}>
                <p>Nenhuma mensagem recebida ainda.</p>
                <p>Para receber, configure o encaminhamento automático no seu e-mail (Gmail, Outlook, Yahoo, iCloud e outros).</p>
                <button onClick={() => setSub('config')} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#3b82f6' }}>
                  Ver como configurar o encaminhamento
                </button>
              </div>
            ) : q.mensagens.map((m) => (
              <Mensagem key={m.id} m={m} onVista={() => { void q.marcarVista(m.id) }}
                onDecidir={(a) => { void rodar(() => q.decidirMensagem(m.id, a), a === 'aprovar' ? 'Remetente aprovado.' : 'Remetente bloqueado.') }}
                onExcluir={() => { void rodar(() => q.excluirMensagem(m.id), 'Mensagem excluída.') }} />
            ))}
          </div>
          )}
        </>
      )}
    </div>
  )
}
