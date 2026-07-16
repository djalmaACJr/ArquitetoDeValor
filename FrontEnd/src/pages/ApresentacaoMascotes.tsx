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
import { ArrowLeft, Check, Sun, Moon, Sparkles, Trash2, Wrench } from 'lucide-react'
import { srcMascote, type MascoteNome, type MascotePose } from '../components/ui/Mascote'
import { useMascotePreferido } from '../hooks/useMascotePreferido'
import { useTheme } from '../hooks/useTheme'
import type { Familia, Modo } from '../lib/themes'

interface MascoteInfo {
  id:        MascoteNome
  profissao: string
  cor:       string
  apresentacao: string
  /** Pequena frase de convite — voz do personagem pedindo pra ser escolhido. */
  convite:   string
}

const MASCOTES: MascoteInfo[] = [
  {
    id: 'sabio',
    profissao: 'Conselheiro',
    cor: '#d4a86e',
    apresentacao: 'Sou o Conselheiro — paciência, disciplina e longo prazo.',
    convite: 'Caminhe comigo — devagar e firme.',
  },
  {
    id: 'arquiteta',
    profissao: 'Arquiteta',
    cor: '#e878a8',
    apresentacao: 'Sou a Arquiteta — estrutura, cálculo e controle.',
    convite: 'Vamos colocar tudo no lugar?',
  },
  {
    id: 'gato',
    profissao: 'Mago',
    cor: '#b48cff',
    apresentacao: 'Sou o Mago — magia dos juros compostos e multiplicação.',
    convite: 'Pchsst — me escolha e a mágica começa!',
  },
  {
    id: 'raposa',
    profissao: 'Estrategista',
    cor: '#50c86e',
    apresentacao: 'Sou a Estrategista — leitura de mercado e custo de oportunidade.',
    convite: 'Estratégia precisa de aliados — vem comigo.',
  },
]

// Poses que serão alternadas durante o fluxo — pré-carregadas pra
// trocas instantâneas (sem flash de imagem ausente)
const POSES_PRELOAD: MascotePose[] = ['curioso', 'feliz', 'triste', 'sentado', 'comprimento-inicio']

// Fases do fluxo:
//   apresentando  → cards mostram apresentação (~4s)
//   aguardando    → usuário pode clicar em UM mascote, em "Aleatório" ou em "Nenhum"
//   escolhido     → um mascote ficou feliz, outros tristes (fluxo individual)
//   sentar        → outros 3 sentaram, escolhido em destaque
//   nomeando      → usuário dá apelido ao mascote escolhido (fluxo individual)
//   todos-alegres → usuário escolheu "Aleatório" — todos vão pra pose feliz
//   nomeando-todos→ formulário pra dar apelido aos 4 (fluxo Aleatório)
//   tema          → escolha de família + modo dia/noite
//   aviso-dados   → último passo do 1º acesso (avisa sobre seed)
type Fase =
  | 'apresentando' | 'aguardando' | 'escolhido' | 'sentar' | 'nomeando'
  | 'todos-alegres' | 'nomeando-todos'
  | 'tema' | 'aviso-dados'

export default function ApresentacaoMascotes() {
  const navigate = useNavigate()
  const { setMascote, definirApelido, definirVariosApelidos, apelidos, primeiroAcesso } = useMascotePreferido()
  const [fase, setFase] = useState<Fase>('apresentando')
  const [escolhido, setEscolhido] = useState<MascoteNome | null>(null)
  const [apelido, setApelido] = useState('')
  // Apelidos dos 4 mascotes no fluxo "Aleatório". Pré-carregados pelo
  // useEffect abaixo quando o hook resolve os apelidos persistidos.
  const [apelidosTodos, setApelidosTodos] = useState<Record<MascoteNome, string>>({
    sabio: '', arquiteta: '', gato: '', raposa: '',
  })

  // Quando o hook traz apelidos persistidos (retomada — usuário já nomeou
  // mentores em outra ocasião), pré-carrega nos campos para o usuário só
  // editar o que quiser. `apelidos` chega vazio na 1ª renderização e
  // populado depois do fetch.
  //
  // Padrão React 19 "derived state on dependency change": compara as
  // dependências e atualiza state inline, em vez de usar useEffect com
  // setState (anti-pattern que causa render em cascata).
  const [apelidosBaseDep, setApelidosBaseDep] = useState({
    sabio:     apelidos.sabio,
    arquiteta: apelidos.arquiteta,
    gato:      apelidos.gato,
    raposa:    apelidos.raposa,
  })
  if (
    apelidosBaseDep.sabio     !== apelidos.sabio     ||
    apelidosBaseDep.arquiteta !== apelidos.arquiteta ||
    apelidosBaseDep.gato      !== apelidos.gato      ||
    apelidosBaseDep.raposa    !== apelidos.raposa
  ) {
    setApelidosBaseDep({
      sabio:     apelidos.sabio,
      arquiteta: apelidos.arquiteta,
      gato:      apelidos.gato,
      raposa:    apelidos.raposa,
    })
    setApelidosTodos(prev => ({
      sabio:     apelidos.sabio     ?? prev.sabio,
      arquiteta: apelidos.arquiteta ?? prev.arquiteta,
      gato:      apelidos.gato      ?? prev.gato,
      raposa:    apelidos.raposa    ?? prev.raposa,
    }))
  }
  const [salvando, setSalvando] = useState(false)
  // Anima o emoji 🎲 quando o usuário clica em "Aleatório" — o dado rola,
  // chacoalha um pouco e cai. Dura ~900ms; só depois disso a fase muda.
  const [rolandoDado, setRolandoDado] = useState(false)

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
    // Se o usuário já tinha apelidado este mentor antes, traz o nome
    // pra o input de "nomeando" — fica fácil só revisar ou editar.
    setApelido(apelidos[id] ?? '')
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
    setFase('tema')
  }

  function aoPularNome() {
    if (!escolhido) return
    setMascote(escolhido)
    setFase('tema')
  }

  // ── Fluxo "Aleatório" ──────────────────────────────────────────────
  function aoEscolherAleatorio() {
    if (fase !== 'aguardando' || rolandoDado) return
    // Anima o dado rolando antes de mudar de fase (~900ms).
    // Sinaliza com null pra logica de pose: todos vão pra 'feliz'.
    setEscolhido(null)
    setRolandoDado(true)
    setTimeout(() => {
      setRolandoDado(false)
      setFase('todos-alegres')
      setTimeout(() => setFase('nomeando-todos'), 1000)
    }, 900)
  }

  async function aoSalvarTodos() {
    setSalvando(true)
    setMascote('aleatorio')
    // Filtra só os apelidos preenchidos (apelidos vazios são limpos pelo hook)
    const limpos: Partial<Record<MascoteNome, string>> = {}
    for (const [nome, ap] of Object.entries(apelidosTodos)) {
      if (ap.trim()) limpos[nome as MascoteNome] = ap.trim()
    }
    if (Object.keys(limpos).length > 0) {
      await definirVariosApelidos(limpos)
    }
    setSalvando(false)
    setFase('tema')
  }

  function aoPularNomesTodos() {
    setMascote('aleatorio')
    setFase('tema')
  }

  // ── Fluxo "Nenhum" ─────────────────────────────────────────────────
  function aoEscolherNenhum() {
    if (fase !== 'aguardando') return
    setMascote('nenhum')
    setFase('tema')
  }

  function aoConcluirTema() {
    // Em primeiro acesso, mostra o aviso sobre os dados de exemplo
    // criados pelo seed (Carteira, cartões, categorias). Em retomada
    // (trocando o mascote pelo perfil), pula esse aviso.
    if (primeiroAcesso) {
      setFase('aviso-dados')
    } else {
      navigate('/', { replace: true })
    }
  }

  function aoConcluirAvisoDados() {
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

  // Layout especial do fluxo "Aleatório": nomeia os 4 mascotes
  if (fase === 'nomeando-todos') {
    return <LayoutNomeandoTodos
      apelidos={apelidosTodos}
      onApelidoChange={(nome, valor) => setApelidosTodos(prev => ({ ...prev, [nome]: valor }))}
      onSalvar={aoSalvarTodos}
      onPular={aoPularNomesTodos}
      onEscolherOutro={() => { setFase('aguardando') }}
      salvando={salvando}
    />
  }

  // Etapa: escolha de tema (família + modo dia/noite)
  if (fase === 'tema') {
    return <LayoutTema onConcluir={aoConcluirTema}/>
  }

  // Última etapa do 1º acesso: avisa sobre os dados de exemplo.
  // No fluxo "Aleatório" `escolhido` é null — usa 'sabio' como fallback
  // visual (mascote padrão); o que importa é mostrar o aviso e o botão
  // de concluir, não trocar por outro mentor.
  if (fase === 'aviso-dados') {
    return <LayoutAvisoDados mascote={escolhido ?? 'sabio'} onConcluir={aoConcluirAvisoDados}/>
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

        {/* Opções extras: Aleatório (rotação diária) e Nenhum (sem mentores).
            Só aparecem quando o usuário ainda pode escolher (fase 'aguardando'). */}
        {fase === 'aguardando' && (
          <div className="mt-5">
            <p
              className="text-[13px] text-center mb-2 uppercase tracking-widest"
              style={{ color: 'var(--text-muted)' }}
            >
              ou
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto">
              <button
                type="button"
                onClick={aoEscolherAleatorio}
                disabled={rolandoDado}
                className="rounded-2xl p-3 text-left transition-all hover:scale-[1.02] disabled:cursor-default"
                style={{
                  background: '#ffffff',
                  border: '2px dashed rgba(0,0,0,0.15)',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`text-[26px] leading-none inline-block origin-center${rolandoDado ? ' rolando-dado' : ''}`}
                  >🎲</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-bold mb-0.5" style={{ color: '#0f172a' }}>
                      Aleatório
                    </p>
                    <p className="text-[12px] leading-snug" style={{ color: '#475569' }}>
                      Um mentor diferente a cada dia — variedade nos conselhos.
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={aoEscolherNenhum}
                className="rounded-2xl p-3 text-left transition-all hover:scale-[1.02]"
                style={{
                  background: '#ffffff',
                  border: '2px dashed rgba(0,0,0,0.15)',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-[26px] leading-none">🤐</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-bold mb-0.5" style={{ color: '#0f172a' }}>
                      Nenhum
                    </p>
                    <p className="text-[12px] leading-snug" style={{ color: '#475569' }}>
                      Sem balões nem dicas. Só o parecer do resultado do mês na tela principal.
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Animação do dado: classe `.rolando-dado` definida em globals.css
          (compartilhada com PerfilPage.SecaoMascote). */}
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
    // Fluxo "Aleatório" — todos os mascotes ficam alegres.
    if (fase === 'todos-alegres' || fase === 'nomeando-todos') return 'feliz'
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
    ? '2px solid rgba(0,0,0,0.08)'
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
        // Fundo BRANCO fixo independente do tema — os mascotes foram pintados
        // assumindo fundo claro; em temas escuros (verde-floresta, marrom etc.)
        // a borda do pelo/roupa some.
        background: '#ffffff',
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
        <p className="text-center text-[12px] mt-1 leading-snug line-clamp-2" style={{ color: '#4b5563' }}>
          {info.apresentacao}
        </p>
      )}

      {clicavel && (
        <div
          className="mt-1.5 mx-auto inline-block text-[12px] font-medium italic py-0.5 px-2.5 rounded-full text-center"
          style={{ background: `${info.cor}22`, color: info.cor }}
        >
          {info.convite}
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

// ── Layout do fluxo "Aleatório" — nomeia os 4 ─────────────────────────
// Mostra os 4 mascotes alegres em destaque + um campo de apelido pra
// cada um. Salvar grava todos os apelidos preenchidos e seta a
// preferência = 'aleatorio' (rotação diária).
interface LayoutNomeandoTodosProps {
  apelidos:          Record<MascoteNome, string>
  onApelidoChange:   (nome: MascoteNome, valor: string) => void
  onSalvar:          () => void
  onPular:           () => void
  onEscolherOutro:   () => void
  salvando:          boolean
}

function LayoutNomeandoTodos({
  apelidos, onApelidoChange, onSalvar, onPular, onEscolherOutro, salvando,
}: LayoutNomeandoTodosProps) {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-start py-6 px-3"
      style={{ background: 'var(--bg-page)' }}
    >
      <div className="max-w-3xl w-full">
        <h2 className="text-[22px] font-bold text-center mb-1" style={{ color: 'var(--text-primary)' }}>
          Vamos batizar todos os mentores
        </h2>
        <p className="text-[14px] text-center mb-5 max-w-xl mx-auto" style={{ color: 'var(--text-muted)' }}>
          A cada dia um mentor diferente vai te acompanhar. Dê um apelido pra cada um — ou deixe em branco pra usar o nome padrão.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {MASCOTES.map(m => (
            <div
              key={m.id}
              className="rounded-2xl p-3 flex items-center gap-3"
              style={{ background: '#ffffff', border: `2px solid ${m.cor}66` }}
            >
              <img
                src={srcMascote(m.id, 'feliz')}
                alt=""
                style={{ height: 70, width: 'auto', objectFit: 'contain' }}
                className="select-none pointer-events-none flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold mb-1" style={{ color: m.cor }}>
                  {m.profissao}
                </p>
                <input
                  type="text"
                  value={apelidos[m.id]}
                  onChange={e => onApelidoChange(m.id, e.target.value)}
                  maxLength={40}
                  placeholder={m.profissao}
                  className="w-full rounded-lg px-2.5 py-1.5 text-[14px] focus:outline-none transition-colors"
                  style={{
                    background: 'rgba(0,0,0,0.04)',
                    color: '#0f172a',
                    border: '1px solid rgba(0,0,0,0.1)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mb-3">
          <button
            type="button"
            onClick={onEscolherOutro}
            disabled={salvando}
            className="text-[13px] underline transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ color: 'var(--av-blue)' }}
          >
            ← Voltar e escolher outra opção
          </button>
        </div>

        <div className="flex gap-2 max-w-md mx-auto">
          <button
            type="button"
            onClick={onPular}
            disabled={salvando}
            className="flex-1 py-2.5 rounded-lg text-[15px] font-medium transition-colors hover:opacity-80 disabled:opacity-50"
            style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
          >
            Usar nomes padrão
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
      </div>
    </div>
  )
}

// ── Layout dedicado para fase TEMA ────────────────────────────────────
// Última etapa: usuário escolhe a família de tema (Clássico ou um dos 4
// mascotes) e o modo (dia/noite). Os tokens CSS aplicam imediatamente
// na preview ao redor — assim ele vê o resultado antes de confirmar.

function LayoutTema({ onConcluir }: { onConcluir: () => void }) {
  const { familia, modo, familias, setFamilia, toggle } = useTheme()

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-start py-6 px-3"
      style={{ background: 'var(--bg-page)' }}
    >
      <div className="max-w-3xl w-full">
        <h1
          className="text-[22px] md:text-[26px] font-bold text-center mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          Escolha o visual do app
        </h1>
        <p
          className="text-[14px] text-center mb-4 max-w-xl mx-auto"
          style={{ color: 'var(--text-muted)' }}
        >
          A cor de fundo e os destaques mudam imediatamente — você pode trocar depois em Perfil → Aparência.
        </p>

        {/* Toggle dia/noite no topo */}
        <div className="flex justify-center mb-4">
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full border text-[14px] font-semibold transition-all hover:opacity-80"
            style={{
              borderColor: 'rgba(255,255,255,0.15)',
              background:  modo === 'noite' ? 'rgba(77,166,255,0.12)' : 'rgba(240,180,41,0.12)',
              color:       modo === 'noite' ? '#4da6ff' : '#f0b429',
            }}
          >
            {modo === 'noite' ? <Moon size={14}/> : <Sun size={14}/>}
            Modo: {modo === 'noite' ? 'Noite' : 'Dia'}
          </button>
        </div>

        {/* Grid de famílias */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
          {familias.map((f: Familia) => {
            const ativo = f.id === familia.id
            const cor   = f.cores[modo as Modo]
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFamilia(f.id)}
                className="text-left rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.02]"
                style={{
                  borderColor: ativo ? '#00c896' : 'rgba(255,255,255,0.10)',
                  background:  cor.bg,
                }}
              >
                <div className="flex items-center gap-2 px-3 pt-3">
                  {f.mascote ? (
                    <img
                      src={srcMascote(f.mascote, 'feliz')}
                      alt=""
                      width={36}
                      height={36}
                      className="object-contain flex-shrink-0"
                      style={{ height: 36, width: 'auto' }}
                    />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center text-[18px]"
                      style={{ background: cor.accent + '22', color: cor.accent }}
                    >★</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold truncate" style={{ color: cor.text }}>
                      {f.label}
                    </p>
                    <p className="text-[12px] truncate" style={{ color: cor.text, opacity: 0.55 }}>
                      {f.descricao}
                    </p>
                  </div>
                  {ativo && (
                    <Check size={16} style={{ color: '#00c896', flexShrink: 0 }}/>
                  )}
                </div>
                {/* Faixa de cores accent + bg */}
                <div className="flex h-2 mt-2">
                  <div style={{ background: cor.accent, flex: 1 }}/>
                  <div style={{ background: cor.text,   flex: 1, opacity: 0.4 }}/>
                </div>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onConcluir}
          className="w-full py-3 rounded-xl text-[16px] font-semibold transition-colors hover:opacity-90"
          style={{ background: '#00c896', color: '#0a0f1a' }}
        >
          Pronto, vamos lá!
        </button>
      </div>
    </div>
  )
}

// ─── LayoutAvisoDados ─────────────────────────────────────────────────
// Tela final do 1º acesso: avisa que dados de exemplo foram criados pelo
// seed (Carteira, cartões pré-cadastrados, categorias-base e lançamentos
// de exemplo com datas relativas ao mês do cadastro) e onde achar a
// opção de limpar tudo.
function LayoutAvisoDados({ mascote, onConcluir }: {
  mascote: MascoteNome
  onConcluir: () => void
}) {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-6"
      style={{ background: 'var(--bg-page)' }}
    >
      <div
        className="max-w-lg w-full rounded-2xl p-6 md:p-8"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div className="flex items-start gap-4 mb-5">
          <img
            src={srcMascote(mascote, 'feliz')}
            alt=""
            className="w-20 h-20 md:w-24 md:h-24 object-contain flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles size={16} style={{ color: '#f0b429' }}/>
              <h2 className="text-[20px] md:text-[22px] font-bold"
                style={{ color: 'var(--text-primary)' }}>
                Antes de começar
              </h2>
            </div>
            <p className="text-[15px] leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}>
              Pra você navegar e conhecer o app com calma, já deixei criadas
              algumas <strong>contas</strong> (Carteira, Nubank, Inter, C6),
              <strong> categorias</strong> (Moradia, Alimentação, Transporte,
              Saúde, Renda e Transferências) e alguns{' '}
              <strong>lançamentos de exemplo</strong> — receitas, despesas e
              uma transferência, todos marcados com "(exemplo)".
            </p>
          </div>
        </div>

        <div
          className="rounded-xl p-4 mb-5"
          style={{
            background: 'rgba(0,200,150,0.06)',
            border: '1px solid rgba(0,200,150,0.2)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <Trash2 size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#00c896' }}/>
            <div className="flex-1">
              <p className="text-[15px] font-semibold mb-1"
                style={{ color: 'var(--text-primary)' }}>
                Quando quiser, pode limpar tudo
              </p>
              <p className="text-[14px] leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}>
                No menu lateral, abra{' '}
                <span className="inline-flex items-center gap-1 font-medium"
                  style={{ color: 'var(--text-primary)' }}>
                  <Wrench size={12}/> Ferramentas
                </span>{' '}
                e use <strong>Limpar tudo</strong> (apaga contas, categorias
                e lançamentos) ou <strong>Limpar transações</strong> (mantém
                a estrutura). Não tem volta — então faça quando estiver
                pronto pra começar do zero com seus próprios dados.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onConcluir}
          className="w-full py-3 rounded-xl text-[16px] font-semibold transition-colors hover:opacity-90"
          style={{ background: '#00c896', color: '#0a0f1a' }}
        >
          Entendi, vamos começar
        </button>
      </div>
    </div>
  )
}
