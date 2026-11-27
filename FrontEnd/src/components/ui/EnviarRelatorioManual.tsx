// Envio manual do PDF de um relatório (quando a fonte automática não o tem — ex.: um
// FII que o Fundos.NET não devolve, mas cujo relatório você achou no Investidor10).
// O texto é lido no servidor, o arquivo fica privado e a análise usa a sua IA ativa.
import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { enviarRelatorioManual, useRelatoriosFii } from '../../hooks/useRelatoriosFii'

const MUTED = '#8b92a8'
const MAX_MB = 10

export default function EnviarRelatorioManual({ ativoId, ticker, onConcluido }: {
  /** Sem ativo: o servidor identifica de quem é o PDF pelo texto; com ativo, confere que é dele. */
  ativoId?: string
  ticker?: string
  /** Chamado ao fim (com a mensagem a exibir) — o pai pode recarregar a lista de relatórios. */
  onConcluido?: (mensagem: string, ok: boolean) => void
}) {
  const { analisar } = useRelatoriosFii()
  const [aberto, setAberto] = useState(false)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [mes, setMes] = useState('')
  const [ocupado, setOcupado] = useState<'enviando' | 'analisando' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function fechar() {
    setAberto(false); setArquivo(null); setErro(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function enviar() {
    if (!arquivo) { setErro('Escolha o arquivo PDF.'); return }
    if (arquivo.size > MAX_MB * 1024 * 1024) { setErro(`PDF maior que ${MAX_MB} MB.`); return }
    if (!/^\d{4}-\d{2}$/.test(mes)) { setErro('Informe o mês de competência do relatório.'); return }
    setErro(null); setOcupado('enviando')
    const up = await enviarRelatorioManual(ativoId, arquivo, mes)
    if (!up.ok || !up.dados) { setOcupado(null); setErro(up.erro ?? 'Não foi possível enviar o relatório.'); return }

    setOcupado('analisando')
    const an = await analisar(up.dados.ativo_id, up.dados.id)
    setOcupado(null)
    fechar()
    // O relatório já ficou salvo mesmo se a IA falhar — ele aparece como "não analisado".
    onConcluido?.(an.ok
      ? `Relatório de ${up.dados.ticker} (${(up.dados.data_referencia ?? '').slice(0, 7)}) enviado e analisado.`
      : `Relatório enviado, mas a análise falhou: ${an.erro ?? 'erro desconhecido'}. Use "Analisar" na lista para tentar de novo.`, an.ok)
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} title="Subir o PDF de um relatório que não foi encontrado automaticamente"
        className="flex items-center gap-1.5 text-[12px] px-2 py-1 rounded-md border border-white/10 hover:border-white/25 text-white/80">
        <Upload size={12} /> Enviar relatório
      </button>
    )
  }

  return (
    <div className="w-full rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
      <p className="text-[12.5px] text-white/85 font-medium">Enviar relatório (PDF){ticker ? ` — ${ticker}` : ''}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-[11.5px] mb-1" style={{ color: MUTED }}>Arquivo PDF (até {MAX_MB} MB)</p>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" disabled={ocupado !== null}
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="text-[12.5px] text-white/80 file:mr-2 file:rounded-md file:border file:border-white/15 file:bg-white/5 file:px-2 file:py-1 file:text-[12px] file:text-white/80" />
        </div>
        <div>
          <p className="text-[11.5px] mb-1" style={{ color: MUTED }}>Competência (opcional)</p>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} disabled={ocupado !== null}
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[12.5px] text-white" />
        </div>
        <button type="button" onClick={enviar} disabled={ocupado !== null || !arquivo}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md font-semibold text-white disabled:opacity-50" style={{ background: '#3b82f6' }}>
          <Upload size={12} className={ocupado ? 'animate-pulse' : ''} />
          {ocupado === 'enviando' ? 'Enviando…' : ocupado === 'analisando' ? 'Analisando… (até 1 min)' : 'Enviar e analisar'}
        </button>
        <button type="button" onClick={fechar} disabled={ocupado !== null} className="text-[12px] underline disabled:opacity-50" style={{ color: MUTED }}>
          Cancelar
        </button>
      </div>
      {erro && <p className="text-[12.5px]" style={{ color: '#ff5c7a' }}>{erro}</p>}
      <p className="text-[11.5px]" style={{ color: MUTED }}>
        O sistema confere de qual ativo é o PDF (e recusa se for de outro ou se você já o enviou) e detecta o mês sozinho se você deixar a competência em branco. O arquivo fica visível só para você. A análise usa a sua IA ativa e consome tokens da sua chave.
      </p>
    </div>
  )
}
