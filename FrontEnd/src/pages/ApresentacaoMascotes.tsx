// src/pages/ApresentacaoMascotes.tsx
//
// Tela de boas-vindas / escolha de mascote. Disparada automaticamente
// no 1º acesso (quando `mascote_preferido` é NULL no banco) e também
// acessível depois via botão "Trocar mascote" no ChatMascote.
//
// Fluxo:
//   1. APRESENTANDO   — 4 cards exibem `<mascote>-comprimentando.webm`.
//                       Se o arquivo não carregar, exibe a pose
//                       `comprimento-inicio` (fallback gracioso).
//   2. AGUARDANDO     — cards mostram pose `curioso` e ficam clicáveis.
//   3. ESCOLHIDO      — escolhido vai pra `feliz`; outros 3 ficam `triste`.
//   4. SENTAR         — não-escolhidos vão pra `sentado`.
//   5. NOMEANDO       — layout muda: escolhido em destaque + form inline
//                       (não é mais modal sobreposto).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Mascote, { srcMascote, type MascoteNome, type MascotePose } from '../components/ui/Mascote'
import { useMascotePreferido } from '../hooks/useMascotePreferido'

interface MascoteInfo {
  id:        MascoteNome
  profissao: string
  cor:       string
  apresentacao: string
}

const MASCOTES: MascoteInfo[] = [
  {
    id: 'sabio',
    profissao: 'Conselheiro',
    cor: '#d4a86e',
    apresentacao: 'Sou o Conselheiro — paciência, disciplina e longo prazo.',
  },
  {
    id: 'arquiteta',
    profissao: 'Arquiteta',
    cor: '#e878a8',
    apresentacao: 'Sou a Arquiteta — estrutura, cálculo e controle.',
  },
  {
    id: 'gato',
    profissao: 'Mago',
    cor: '#b48cff',
    apresentacao: 'Sou o Mago — magia dos juros compostos e multiplicação.',
  },
  {
    id: 'raposa',
    profissao: 'Estrategista',
    cor: '#50c86e',
    apresentacao: 'Sou a Estrategista — leitura de mercado e custo de oportunidade.',
  },
]

// Poses que serão alternadas durante o fluxo — pré-carregadas pra
// trocas instantâneas (sem flash de imagem ausente)
const POSES_PRELOAD: MascotePose[] = ['curioso', 'feliz', 'triste', 'sentado', 'comprimento-inicio']

type Fase = 'apresentando' | 'aguardando' | 'escolhido' | 'sentar' | 'nomeando'

export default function ApresentacaoMascotes() {
  const navigate = useNavigate()
  const { setMascote, definirApelido, primeiroAcesso } = useMascotePreferido()
  const [fase, setFase] = useState<Fase>('apresentando')
  const [escolhido, setEscolhido] = useState<MascoteNome | null>(null)
  const [apelido, setApelido] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Pré-carrega todas as poses de todos os mascotes — garante que ao
  // trocar de pose (curioso → triste → sentado) a imagem aparece
  // instantaneamente sem flicker.
  useEffect(() => {
    const imgs: HTMLImageElement[] = []
    for (const m of MASCOTES) {
      for (const p of POSES_PRELOAD) {
        const img = new Image()
        img.src = srcMascote(m.id, p)
        imgs.push(img)
      }
    }
    return () => { imgs.length = 0 }
  }, [])

  // Apresentação dura ~4s (uma volta dos vídeos / pose estática)
  useEffect(() => {
    if (fase !== 'apresentando') return
    const t = setTimeout(() => setFase('aguardando'), 4000)
    return () => clearTimeout(t)
  }, [fase])

  function aoEscolher(id: MascoteNome) {
    if (fase !== 'aguardando') return
    setEscolhido(id)
    setFase('escolhido')
    // Mais ágil: 800ms triste → sentar; +500ms → nomeando
    setTimeout(() => setFase('sentar'), 800)
    setTimeout(() => setFase('nomeando'), 1300)
  }

  async function aoSalvar() {
    if (!escolhido) return
    setSalvando(true)
    setMascote(escolhido)
    if (apelido.trim()) {
      await definirApelido(escolhido, apelido.trim())
    }
    setSalvando(false)
    navigate('/', { replace: true })
  }

  function aoPularNome() {
    if (!escolhido) return
    setMascote(escolhido)
    navigate('/', { replace: true })
  }

  function aoCancelar() {
    navigate('/', { replace: true })
  }

  // Botão Cancelar só aparece se NÃO for primeiro acesso (no 1º acesso
  // o usuário precisa escolher; em retomada, pode desistir e voltar)
  const podeCancelar = primeiroAcesso === false

  function aoEscolherOutro() {
    setEscolhido(null)
    setApelido('')
    setFase('aguardando')
  }

  // Layout especial pra fase 'nomeando': escolhido em destaque, outros pequenos
  if (fase === 'nomeando' && escolhido) {
    return <LayoutNomeando
      escolhido={escolhido}
      apelido={apelido}
      onApelidoChange={setApelido}
      onSalvar={aoSalvar}
      onPular={aoPularNome}
      onEscolherOutro={aoEscolherOutro}
      salvando={salvando}
    />
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-start py-5 px-3 relative"
      style={{ background: 'var(--bg-page)' }}
    >
      {podeCancelar && (
        <button
          type="button"
          onClick={aoCancelar}
          className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-medium transition-colors"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
        >
          <ArrowLeft size={14}/> Cancelar
        </button>
      )}

      <div className="max-w-4xl w-full">
        <h1
          className="text-[22px] md:text-[26px] font-bold text-center mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          Conheça os seus mentores
        </h1>
        <p
          className="text-[14px] text-center mb-4 max-w-xl mx-auto"
          style={{ color: 'var(--text-muted)' }}
        >
          {fase === 'apresentando' && 'Veja cada um se apresentar. Você poderá escolher logo em seguida.'}
          {fase === 'aguardando'   && 'Escolha o mentor que vai te acompanhar no app. Você pode trocar depois.'}
          {fase === 'escolhido'    && 'Ótima escolha!'}
          {fase === 'sentar'       && 'Os outros vão descansar — você pode voltar pra eles depois.'}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {MASCOTES.map(m => (
            <CardMascote
              key={m.id}
              info={m}
              fase={fase}
              ehEscolhido={escolhido === m.id}
              ehNaoEscolhido={!!escolhido && escolhido !== m.id}
              onEscolher={() => aoEscolher(m.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Card individual ──────────────────────────────────────────────────

interface CardProps {
  info:           MascoteInfo
  fase:           Fase
  ehEscolhido:    boolean
  ehNaoEscolhido: boolean
  onEscolher:     () => void
}

function CardMascote({ info, fase, ehEscolhido, ehNaoEscolhido, onEscolher }: CardProps) {
  const [videoTerminou, setVideoTerminou] = useState(false)
  // Quando o video tiver erro, fica em null permanente — exibe pose `comprimento-inicio`
  const [semVideo, setSemVideo] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const pose: MascotePose | null = useMemo(() => {
    if (fase === 'sentar' && ehNaoEscolhido)    return 'sentado'
    if (fase === 'escolhido' && ehNaoEscolhido) return 'triste'
    if (fase === 'nomeando' && ehNaoEscolhido)  return 'sentado'
    if (ehEscolhido && fase !== 'apresentando') return 'feliz'
    if (fase === 'aguardando' || videoTerminou) return 'curioso'
    // Se o webm falhou de carregar, exibe a pose de boas-vindas estática
    if (semVideo) return 'comprimento-inicio'
    return null
  }, [fase, ehEscolhido, ehNaoEscolhido, videoTerminou, semVideo])

  const clicavel = fase === 'aguardando'

  const borda = ehEscolhido
    ? `2px solid ${info.cor}`
    : ehNaoEscolhido
    ? '2px solid var(--border-subtle)'
    : `2px solid ${info.cor}66`

  return (
    <button
      type="button"
      onClick={onEscolher}
      disabled={!clicavel}
      className={`relative rounded-2xl overflow-hidden p-2.5 flex flex-col ${
        clicavel ? 'cursor-pointer hover:scale-[1.03]' : 'cursor-default'
      } ${ehEscolhido ? 'scale-105' : ehNaoEscolhido ? 'opacity-60 scale-95' : ''}`}
      style={{
        background: 'var(--bg-card)',
        border:     borda,
        transition: 'transform 250ms ease, opacity 250ms ease, border-color 250ms ease',
      }}
    >
      <div
        className="flex items-center justify-center mb-2 overflow-hidden mx-auto"
        style={{ height: 180, width: '100%' }}
      >
        {pose === null ? (
          <video
            ref={videoRef}
            src={`/mascotes/${info.id}-comprimentando.webm`}
            autoPlay
            muted
            playsInline
            loop={false}
            onEnded={() => setVideoTerminou(true)}
            onError={() => setSemVideo(true)}
            style={{ height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <img
            src={srcMascote(info.id, pose)}
            alt=""
            style={{ height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }}
            className="select-none pointer-events-none"
          />
        )}
      </div>

      <p className="text-center font-bold text-[15px] md:text-[16px]" style={{ color: info.cor }}>
        {info.profissao}
      </p>

      {fase === 'aguardando' && (
        <p className="text-center text-[12px] mt-1 leading-snug line-clamp-2" style={{ color: 'var(--text-muted)' }}>
          {info.apresentacao}
        </p>
      )}

      {clicavel && (
        <div
          className="mt-1.5 mx-auto inline-block text-[12px] font-semibold py-0.5 px-2.5 rounded-full"
          style={{ background: `${info.cor}22`, color: info.cor }}
        >
          Sou eu! ✓
        </div>
      )}
    </button>
  )
}

// ── Layout dedicado para fase NOMEANDO ────────────────────────────────
// Mostra o mascote escolhido em destaque + form de apelido inline.
// Não é mais modal sobreposto.

interface LayoutNomeandoProps {
  escolhido:        MascoteNome
  apelido:          string
  onApelidoChange:  (s: string) => void
  onSalvar:         () => void
  onPular:          () => void
  onEscolherOutro:  () => void
  salvando:         boolean
}

function LayoutNomeando({ escolhido, apelido, onApelidoChange, onSalvar, onPular, onEscolherOutro, salvando }: LayoutNomeandoProps) {
  const info = MASCOTES.find(m => m.id === escolhido)!
  const outros = MASCOTES.filter(m => m.id !== escolhido)

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center py-6 px-3"
      style={{ background: 'var(--bg-page)' }}
    >
      <div className="max-w-md w-full">
        {/* Mascote escolhido em destaque */}
        <div className="flex flex-col items-center mb-4">
          <img
            src={srcMascote(escolhido, 'feliz')}
            alt=""
            style={{ height: 200, width: 'auto', objectFit: 'contain', display: 'block' }}
            className="select-none pointer-events-none mb-2"
          />
          <p className="text-[18px] font-bold" style={{ color: info.cor }}>
            {info.profissao}
          </p>
        </div>

        <h2 className="text-[20px] font-bold text-center mb-1" style={{ color: 'var(--text-primary)' }}>
          Como prefere me chamar?
        </h2>
        <p className="text-[14px] text-center mb-4" style={{ color: 'var(--text-muted)' }}>
          Dê um apelido pessoal — ou deixe em branco pra usar o nome padrão.
        </p>

        <input
          type="text"
          value={apelido}
          onChange={e => onApelidoChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSalvar() }}
          autoFocus
          maxLength={40}
          placeholder={info.profissao}
          className="w-full rounded-lg px-3 py-2.5 text-[16px] focus:outline-none transition-colors mb-3"
          style={{
            background: 'var(--bg-input)',
            color:      'var(--text-primary)',
            border:     '1px solid var(--border-subtle)',
          }}
        />

        {/* Link discreto pra trocar o mascote */}
        <div className="text-center mb-3">
          <button
            type="button"
            onClick={onEscolherOutro}
            disabled={salvando}
            className="text-[13px] underline transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ color: 'var(--av-blue)' }}
          >
            ← Escolher outro mentor
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPular}
            disabled={salvando}
            className="flex-1 py-2.5 rounded-lg text-[15px] font-medium transition-colors hover:opacity-80 disabled:opacity-50"
            style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
          >
            Usar nome padrão
          </button>
          <button
            type="button"
            onClick={onSalvar}
            disabled={salvando}
            className="flex-1 py-2.5 rounded-lg text-[15px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ background: '#00c896', color: '#0a0f1a' }}
          >
            {salvando ? 'Salvando…' : 'Confirmar'}
          </button>
        </div>

        {/* Os outros 3 mascotes sentados em miniatura embaixo (decorativo) */}
        <div className="flex justify-center gap-3 mt-6 opacity-50">
          {outros.map(m => (
            <img
              key={m.id}
              src={srcMascote(m.id, 'sentado')}
              alt=""
              style={{ height: 56, width: 'auto', objectFit: 'contain' }}
              className="select-none pointer-events-none"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
