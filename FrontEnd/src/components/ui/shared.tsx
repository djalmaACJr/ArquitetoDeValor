// src/components/ui/shared.tsx
// Para mudar o Drawer (ex: trocar por modal), edite só este arquivo.
// Todas as páginas que importam daqui refletem automaticamente.
import { useState, useEffect } from 'react'
import { X, Check } from 'lucide-react'

const CORES_SM = [
  '#00c896','#4da6ff','#f0b429','#7F77DD',
  '#ff6b4a','#e91e8c','#ff7a00','#820ad1',
]
const CORES_ALL = [
  '#00c896','#00b894','#1abc9c','#2ecc71','#27ae60','#55efc4','#00d2d3','#00cec9',
  '#4da6ff','#0984e3','#2980b9','#00b1ea','#74b9ff','#0652DD','#1289A7','#6c5ce7',
  '#7F77DD','#820ad1','#9b59b6','#8e44ad','#a29bfe','#e056fd','#be2edd','#fd79a8',
  '#e91e8c','#e91e63','#e74c3c','#c0392b','#d63031','#ff7675','#e84393','#fd3153',
  '#ff7a00','#e67e22','#d35400','#f0b429','#f9ca24','#f0932b','#fdcb6e','#ffeaa7',
  '#607d8b','#636e72','#2d3436','#95a5a6','#7f8c8d','#34495e','#b2bec3','#dfe6e9',
]
const ICONES_SM = ['🏠','🍔','🚗','💊','💰','💳','📈','💼']
const ICONES_ALL = [
  // Moradia
  '🏠','🏢','🔑','🛋','🛏','🚿','🪴','🧹',
  '💡','⚡','💧','🔧','🔨','🛠','🪣','📦',
  // Alimentação
  '🍔','🍕','🍣','🍜','🥗','🥐','🛒','🍳',
  '🥩','🥦','🍷','🍺','☕','🧃','🍦','🎂',
  // Transporte
  '🚗','🚕','🚌','🛵','⛽','✈️','🚲','🚂',
  '🛻','🏍','🚁','⛵','🅿️','🗺','🧳','🎫',
  // Saúde & Bem-estar
  '💊','🩺','🏥','💉','🩹','🦷','👓','🧬',
  '🏋','🧘','🚴','🏊','🥗','😴','🧖','💆',
  // Educação & Trabalho
  '📚','🎓','✏️','🖊','📖','🏫','💼','🗂',
  '💻','📱','🖥','⌨️','📡','🖨','📠','🔬',
  // Finanças
  '💰','💳','💵','📈','📊','🏦','💎','🪙',
  '🤑','💸','🏧','📉','🔐','📑','🧾','💹',
  // Lazer & Entretenimento
  '🎮','🎵','🎬','🎭','🎨','🎯','⚽','🎾',
  '🏖','🎪','🎠','🎡','🎢','🎤','🎧','📺',
  // Vestuário & Beleza
  '👕','👟','👗','👔','🕶','💍','👜','💄',
  '🧴','🪒','💅','🧣','🧤','🎩','👠','🛍',
  // Família & Casa
  '👶','🧒','👧','👦','👨','👩','👴','👵',
  '🐶','🐱','🐾','🌱','🌻','🌿','🍃','🏡',
  // Serviços & Assinaturas
  '📺','📻','🔔','📧','📮','🗓','📅','⏰',
  '🔄','🧾','📋','📌','🗃','🗄','🔏','🏷',
]

// ── Drawer ────────────────────────────────────────────────────
// Responsivo: full-width em mobile, 420px fixo em desktop.
// Desliza da direita. Para trocar para modal: edite só aqui.
export function Drawer({
  open, onClose, titulo, subtitulo, children, rodape,
}: {
  open: boolean; onClose: () => void; titulo: string
  subtitulo?: string; children: React.ReactNode; rodape?: React.ReactNode
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [open, onClose])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <div onClick={onClose}
        style={{ pointerEvents: open ? 'auto' : 'none', opacity: open ? 1 : 0 }}
        className="fixed inset-0 bg-black/60 z-[100] transition-opacity duration-300" />

      <div role="dialog" aria-modal="true"
        style={{
          left: open ? '220px' : '-600px',
          width: 'min(460px, calc(100vw - 220px))',
        }}
        className="fixed top-0 h-full z-[101]
          bg-[#1a1f2e] border-r border-white/10 flex flex-col transition-all duration-300">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
          <div>
            <p className="text-[14px] font-semibold" style={{ color: '#e8eaf0' }}>{titulo}</p>
            {subtitulo && <p className="text-[11px] mt-0.5" style={{ color: '#8b92a8' }}>{subtitulo}</p>}
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center
              transition-all hover:border-white/30"
            style={{ color: '#8b92a8' }}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a3045 transparent' }}>
          {children}
        </div>

        {/* Rodapé */}
        {rodape && (
          <div className="px-5 py-4 border-t border-white/10 flex gap-2 flex-shrink-0">
            {rodape}
          </div>
        )}
      </div>
    </>
  )
}

// ── ColorPicker ───────────────────────────────────────────────
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [expandido, setExpandido] = useState(false)
  const [hexInput,  setHexInput]  = useState(value)
  const [hexValido, setHexValido] = useState(true)

  useEffect(() => { setHexInput(value) }, [value])

  const isHex = (h: string) => /^#[0-9A-Fa-f]{6}$/.test(h)
  const pick  = (c: string) => { onChange(c); setHexInput(c); setHexValido(true) }
  const lista = expandido ? CORES_ALL : CORES_SM

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-9 gap-1">
        {lista.map(c => (
          <button key={c} onClick={() => pick(c)} title={c}
            style={{
              background: c,
              borderColor: c.toLowerCase() === value.toLowerCase() ? '#fff' : 'transparent',
              transform:   c.toLowerCase() === value.toLowerCase() ? 'scale(1.12)' : 'scale(1)',
            }}
            className="w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-transform hover:scale-110">
            {c.toLowerCase() === value.toLowerCase() && <Check size={11} className="text-white drop-shadow-md" />}
          </button>
        ))}
        <button onClick={() => setExpandido(e => !e)}
          className="w-8 h-8 rounded-lg border border-dashed border-white/20 flex items-center justify-center
            text-[10px] font-bold transition-all hover:border-white/40"
          style={{ color: '#8b92a8' }}>
          {expandido ? '▲' : '···'}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={isHex(hexInput) ? hexInput : '#000000'} onChange={e => pick(e.target.value)}
          className="w-8 h-8 rounded-lg border border-white/10 cursor-pointer p-0.5 bg-[#252d42]" />
        <input type="text" value={hexInput} maxLength={7} placeholder="#000000"
          onChange={e => {
            setHexInput(e.target.value)
            if (isHex(e.target.value)) { setHexValido(true); onChange(e.target.value) }
            else setHexValido(false)
          }}
          style={{ borderColor: hexValido ? 'rgba(255,255,255,0.1)' : '#f87171', color: '#e8eaf0' }}
          className="flex-1 bg-[#252d42] border rounded-lg px-2.5 py-1.5
            text-[12px] font-mono outline-none focus:border-av-green transition-colors" />
        <div className="w-7 h-7 rounded-full border-2 border-white/10 flex-shrink-0"
          style={{ background: isHex(hexInput) ? hexInput : '#2d3436' }} />
      </div>
    </div>
  )
}


// Nome de cada ícone para exibir no tooltip (title)
const ICONE_NOME: Record<string, string> = {
  '🏠':'Casa','🏢':'Prédio','🏡':'Casa com jardim','🔑':'Chave','💡':'Energia elétrica',
  '⚡':'Eletricidade','💧':'Água','🔧':'Manutenção','🔨':'Obra/reforma','📦':'Caixa/mudança',
  '🧹':'Limpeza','🪴':'Plantas','🛋':'Mobília','🛏':'Quarto','🚿':'Banho','🪣':'Faxina',
  '🍔':'Hambúrguer','🍕':'Pizza','🍣':'Sushi','🍜':'Macarrão','🥗':'Salada','🥐':'Padaria',
  '🛒':'Supermercado','🍳':'Cozinha','🥩':'Carne','🍷':'Vinho','🍺':'Cerveja','☕':'Café',
  '🎂':'Bolo/aniversário','🍦':'Sorvete','🧃':'Suco','🥦':'Verduras',
  '🚗':'Carro','🚕':'Táxi/Uber','🚌':'Ônibus','🛵':'Moto','⛽':'Combustível',
  '✈️':'Avião/viagem','🚲':'Bicicleta','🚂':'Trem/metrô','🛻':'Caminhonete',
  '🚁':'Helicóptero','⛵':'Barco','🧳':'Mala/viagem','🎫':'Passagem/ingresso',
  '🗺':'Mapa','🅿️':'Estacionamento','🚀':'Especial',
  '💊':'Remédio','🩺':'Médico','🏥':'Hospital','💉':'Vacina','🩹':'Curativo',
  '🦷':'Dentista','👓':'Óculos','🧬':'Exame/laboratório','🏋':'Academia',
  '🧘':'Yoga/meditação','🚴':'Ciclismo','🏊':'Natação','😴':'Sono/descanso',
  '🧖':'Estética/spa','💆':'Massagem','🌡':'Temperatura/febre',
  '📚':'Livros/estudo','🎓':'Faculdade/curso','✏️':'Escola','🖊':'Escrita',
  '📖':'Leitura','🏫':'Escola/colégio','💼':'Trabalho','🗂':'Arquivos',
  '💻':'Computador/notebook','📱':'Celular/plano','🖥':'Desktop','📡':'Internet',
  '🔬':'Ciência/pesquisa','📠':'Fax','🖨':'Impressora','⌨️':'Teclado',
  '💰':'Dinheiro/renda','💳':'Cartão de crédito','💵':'Cédulas','📈':'Investimento',
  '📊':'Relatório/análise','🏦':'Banco','💎':'Joias/luxo','🪙':'Moeda',
  '🤑':'Lucro/ganho','💸':'Gasto/despesa','🏧':'Caixa eletrônico','📉':'Queda/perda',
  '🧾':'Nota fiscal/recibo','💹':'Câmbio','🔐':'Seguro/cofre','📑':'Documento',
  '🎮':'Videogame','🎵':'Música','🎬':'Cinema/streaming','🎨':'Arte/hobby',
  '🎯':'Meta/objetivo','⚽':'Futebol','🎾':'Tênis','🏖':'Praia/férias',
  '🎤':'Karaokê/show','🎧':'Fone/podcast','📺':'TV/streaming','📻':'Rádio',
  '🎭':'Teatro','🎪':'Evento','🏄':'Surf/lazer','🎻':'Instrumento musical',
  '👕':'Roupa/camiseta','👟':'Tênis/calçado','👗':'Vestido/moda','👔':'Camisa social',
  '🕶':'Óculos de sol','💍':'Joia/aliança','👜':'Bolsa','💄':'Maquiagem/beleza',
  '🧴':'Skincare/creme','💅':'Manicure','🧣':'Cachecol/acessório','🧤':'Luvas',
  '👠':'Salto alto','🛍':'Compras/shopping','🎩':'Chapéu','🧢':'Boné',
  '👶':'Bebê/filho','🧒':'Criança','👧':'Filha','👦':'Filho','🐶':'Cachorro/pet',
  '🐱':'Gato/pet','🐾':'Pet/veterinário','🌱':'Jardim/planta','🌻':'Flores',
  '🌿':'Natureza','🏡':'Sítio/chácara','👨':'Adulto','👩':'Adulta',
  '👴':'Idoso','👵':'Idosa','🤝':'Acordos/parcerias',
  '🔔':'Assinatura/alerta','📧':'E-mail/serviço','📮':'Correios','🗓':'Agenda/mensalidade',
  '📅':'Data/vencimento','⏰':'Prazo/alarme','🔄':'Recorrente/transferência',
  '📋':'Fatura/lista','📌':'Fixo/importante','🏷':'Etiqueta/preço',
  '🔏':'Seguro/privado','📑':'Contrato','🗃':'Arquivo','📣':'Comunicação',
  '🔁':'Repetição/recorrente','💬':'Comunicação',
}

// ── IconPicker ────────────────────────────────────────────────
// Mapa de palavras-chave para busca por nome
const ICONE_TAGS: Record<string, string[]> = {
  // Moradia
  '🏠': ['casa','moradia','lar','aluguel','imovel','home'],
  '🏢': ['predio','apartamento','condominio','empresa'],
  '🔑': ['chave','aluguel','acesso','imovel'],
  '🛋': ['sofa','sala','movel','decoracao'],
  '🛏': ['cama','quarto','dormir'],
  '🚿': ['banho','chuveiro','agua'],
  '🪴': ['planta','jardim','natureza'],
  '🧹': ['limpeza','faxina','diarista'],
  '💡': ['luz','energia','eletricidade','conta de luz'],
  '⚡': ['energia','eletricidade','luz','choque'],
  '💧': ['agua','conta de agua','hidraulica'],
  '🔧': ['manutencao','reparo','conserto','ferramenta'],
  '🔨': ['obra','reforma','construcao'],
  '🛠': ['ferramenta','conserto','manutencao'],
  '🪣': ['limpeza','balde','faxina'],
  '📦': ['caixa','mudanca','entrega','pacote'],
  // Alimentação
  '🍔': ['hamburguer','lanche','fast food','alimentacao'],
  '🍕': ['pizza','alimentacao','jantar'],
  '🍣': ['sushi','japones','alimentacao'],
  '🍜': ['macarrao','massa','sopa','alimentacao'],
  '🥗': ['salada','dieta','saudavel'],
  '🥐': ['padaria','pao','cafe da manha'],
  '🛒': ['mercado','supermercado','compras','feira'],
  '🍳': ['cozinha','ovo','frigideira','refeicao'],
  '🥩': ['carne','churrasco','acougue'],
  '🥦': ['verdura','legume','feira','saude'],
  '🍷': ['vinho','bebida','restaurante'],
  '🍺': ['cerveja','bebida','bar'],
  '☕': ['cafe','cafeteria','manha'],
  '🧃': ['suco','bebida','crianca'],
  // Transporte
  '🚗': ['carro','automovel','transporte'],
  '🚕': ['taxi','uber','99','transporte'],
  '🚌': ['onibus','transporte publico','metro'],
  '🛵': ['moto','motocicleta','delivery'],
  '⛽': ['gasolina','combustivel','posto','etanol'],
  '✈️': ['aviao','viagem','passagem','voo'],
  '🚲': ['bicicleta','bike','ciclismo'],
  '🚂': ['trem','metro','transporte'],
  '🛻': ['caminhonete','pickup','veiculo'],
  '🏍': ['moto','motocicleta','veloz'],
  '🧳': ['viagem','mala','turismo'],
  '🎫': ['passagem','ingresso','bilhete'],
  // Saúde
  '💊': ['remedio','medicamento','farmacia','saude'],
  '🩺': ['medico','consulta','clinica','saude'],
  '🏥': ['hospital','emergencia','saude'],
  '💉': ['vacina','injecao','exame'],
  '🩹': ['curativo','ferimento','primeiros socorros'],
  '🦷': ['dentista','odontologia','dente'],
  '👓': ['oculos','otica','visao'],
  '🏋': ['academia','musculacao','ginastica'],
  '🧘': ['yoga','pilates','meditacao'],
  '🚴': ['ciclismo','bicicleta','exercicio'],
  '🏊': ['natacao','piscina','exercicio'],
  '😴': ['sono','descanso'],
  '🧖': ['estetica','spa','beleza'],
  '💆': ['massagem','relaxamento','spa'],
  // Educação & Trabalho
  '📚': ['livro','estudo','educacao','leitura'],
  '🎓': ['faculdade','curso','formatura','escola'],
  '✏️': ['lapis','escola','estudo','escrita'],
  '🖊': ['caneta','escrita','assinatura'],
  '📖': ['livro','leitura','estudo'],
  '🏫': ['escola','colegio','educacao'],
  '💼': ['trabalho','emprego','salario','negocios'],
  '🗂': ['arquivos','organizacao','pastas'],
  '💻': ['computador','notebook','tecnologia','home office'],
  '📱': ['celular','smartphone','telefone','plano'],
  '🖥': ['computador','desktop','monitor'],
  '📡': ['internet','sinal','provedor'],
  // Finanças
  '💰': ['dinheiro','renda','receita','salario'],
  '💳': ['cartao','credito','debito'],
  '💵': ['nota','dinheiro','renda','saque'],
  '📈': ['investimento','bolsa','crescimento','rendimento'],
  '📊': ['grafico','relatorio','analise','resultado'],
  '🏦': ['banco','financeiro','conta','agencia'],
  '💎': ['joia','luxo','precioso','valor'],
  '🪙': ['moeda','dinheiro','troco'],
  '🤑': ['dinheiro','lucro','ganho'],
  '💸': ['gasto','despesa','saida'],
  '🏧': ['caixa eletronico','saque','banco'],
  '📉': ['queda','perda','prejuizo'],
  '🧾': ['recibo','nota fiscal','comprovante'],
  '💹': ['cambio','dolar','investimento'],
  // Lazer
  '🎮': ['jogo','game','videogame','entretenimento'],
  '🎵': ['musica','show','streaming','spotify'],
  '🎬': ['filme','cinema','streaming','netflix'],
  '🎨': ['arte','hobby','criatividade'],
  '🎯': ['meta','objetivo','esporte'],
  '⚽': ['futebol','esporte','bola'],
  '🎾': ['tenis','quadra','esporte'],
  '🏖': ['praia','ferias','viagem','lazer'],
  '🎪': ['circo','evento','show'],
  '🎤': ['karaoke','musica','show'],
  '🎧': ['fone','musica','podcast'],
  '📺': ['televisao','tv','streaming'],
  // Vestuário & Beleza
  '👕': ['roupa','camiseta','vestuario'],
  '👟': ['tenis','sapato','calcado'],
  '👗': ['vestido','roupa','moda'],
  '👔': ['camisa','trabalho','social'],
  '🕶': ['oculos de sol','acessorio'],
  '💍': ['joia','anel','alianca'],
  '👜': ['bolsa','acessorio','moda'],
  '💄': ['maquiagem','beleza','cosmeticos'],
  '🧴': ['creme','skincare','beleza'],
  '💅': ['unhas','manicure','estetica'],
  '🛍': ['compras','shopping','sacola'],
  // Família & Pets
  '👶': ['bebe','filho','crianca'],
  '🧒': ['crianca','filho','escola'],
  '🐶': ['cachorro','pet','animal'],
  '🐱': ['gato','pet','animal'],
  '🐾': ['pet','animal','veterinario'],
  '🌱': ['jardim','planta','natureza'],
  '🌻': ['flor','jardim','decoracao'],
  '🏡': ['casa','sitio','chacara'],
  // Serviços & Assinaturas
  '🔔': ['notificacao','assinatura','alerta'],
  '📧': ['email','servico','comunicacao'],
  '🗓': ['agenda','data','parcela','mensalidade'],
  '📅': ['data','vencimento','prazo'],
  '⏰': ['alarme','prazo','hora'],
  '🔄': ['recorrente','transferencia','mensal'],
  '📋': ['lista','documento','fatura'],
  '📌': ['importante','fixo','marcado'],
  '🏷': ['etiqueta','preco','tag'],
  '🔐': ['seguro','protecao','cofre'],
}

function normalizar(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function IconPicker({ value, onChange }: { value: string; onChange: (ic: string) => void }) {
  const [expandido,  setExpandido]  = useState(false)
  const [busca,      setBusca]      = useState('')
  const [manual,     setManual]     = useState('')

  const buscaNorm = normalizar(busca.trim())

  const listaFiltrada = buscaNorm
    ? ICONES_ALL.filter(ic => {
        const tags = ICONE_TAGS[ic] ?? []
        return tags.some(t => normalizar(t).includes(buscaNorm)) ||
               normalizar(ic).includes(buscaNorm)
      })
    : expandido ? ICONES_ALL : ICONES_SM

  const handleManual = (v: string) => {
    setManual(v)
    // Pega o primeiro emoji do texto digitado
    const match = [...v].find(c => c.codePointAt(0)! > 127)
    if (match) { onChange(match); setManual('') }
  }

  return (
    <div className="space-y-2">
      {/* Campo de busca */}
      <input
        value={busca}
        onChange={e => setBusca(e.target.value)}
        placeholder="Buscar por nome: casa, carro, saúde..."
        className="w-full bg-[#252d42] border border-white/10 rounded-lg px-2.5 py-1.5
          text-[12px] outline-none focus:border-av-green transition-colors placeholder:text-white/30"
        style={{ color: '#e8eaf0' }}
      />

      {/* Grade de ícones */}
      <div className="grid grid-cols-9 gap-1">
        {listaFiltrada.map(ic => (
          <button key={ic} onClick={() => { onChange(ic); setBusca('') }}
            title={ICONE_NOME[ic] ?? ic}
            className={`w-8 h-8 rounded-lg text-[15px] flex items-center justify-center border transition-all
              ${ic === value ? 'border-av-green bg-av-green/10' : 'border-white/10 hover:border-white/25 bg-[#252d42]'}`}>
            {ic}
          </button>
        ))}
        {!buscaNorm && (
          <button onClick={() => setExpandido(e => !e)}
            className="w-8 h-8 rounded-lg border border-dashed border-white/20 flex items-center justify-center
              text-[10px] font-bold transition-all hover:border-white/40"
            style={{ color: '#8b92a8' }}>
            {expandido ? '▲' : '···'}
          </button>
        )}
        {buscaNorm && listaFiltrada.length === 0 && (
          <div className="col-span-9 text-[11px] py-2 text-center" style={{ color: '#8b92a8' }}>
            Nenhum ícone encontrado
          </div>
        )}
      </div>

      {/* Campo para colar emoji manualmente */}
      <div className="flex items-center gap-2">
        <input
          value={manual}
          onChange={e => handleManual(e.target.value)}
          placeholder="Cole um emoji aqui  🔍"
          className="flex-1 bg-[#252d42] border border-white/10 rounded-lg px-2.5 py-1.5
            text-[13px] outline-none focus:border-av-green transition-colors placeholder:text-white/30"
          style={{ color: '#e8eaf0' }}
        />
        {value && (
          <div className="w-8 h-8 rounded-lg border border-av-green bg-av-green/10
            flex items-center justify-center text-[18px] flex-shrink-0">
            {value}
          </div>
        )}
      </div>

      {/* Dica para buscar emojis novos */}
      <p className="text-[10px]" style={{ color: '#8b92a8' }}>
        Não encontrou?{' '}
        <a href="https://emojipedia.org" target="_blank" rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-av-green transition-colors"
          style={{ color: '#4da6ff' }}>
          Busque em emojipedia.org
        </a>
        {' '}e cole no campo acima.
      </p>
    </div>
  )
}

// ── Field ─────────────────────────────────────────────────────
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#8b92a8' }}>{label}</p>
      {children}
    </div>
  )
}

// ── Input ─────────────────────────────────────────────────────
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      style={{ color: '#e8eaf0', ...props.style }}
      className={`w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2
        text-[13px] outline-none focus:border-av-green transition-colors
        placeholder:text-white/30 ${props.className ?? ''}`} />
  )
}

// ── SelectDark ────────────────────────────────────────────────
export function SelectDark(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props}
      style={{ color: '#e8eaf0', ...props.style }}
      className={`w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2
        text-[13px] outline-none focus:border-av-green transition-colors cursor-pointer
        ${props.className ?? ''}`} />
  )
}

// ── Toggle ────────────────────────────────────────────────────
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <button onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${checked ? 'bg-av-green' : 'bg-white/10'}`}>
        <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all"
          style={{ left: checked ? '22px' : '2px' }} />
      </button>
      {label && <span className="text-[12px]" style={{ color: '#8b92a8' }}>{label}</span>}
    </div>
  )
}

// ── PreviewBadge ──────────────────────────────────────────────
export function PreviewBadge({ icone, label, cor }: { icone: string; label: string; cor: string }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-semibold"
      style={{ background: `${cor}22`, color: cor }}>
      <span>{icone || '●'}</span>
      <span>{label || '—'}</span>
    </div>
  )
}

// ── BtnSalvar ─────────────────────────────────────────────────
export function BtnSalvar({ editando, onClick, salvando, labelSalvar = 'Salvar', labelEditar = 'Atualizar' }: {
  editando: boolean; onClick: () => void; salvando?: boolean; labelSalvar?: string; labelEditar?: string
}) {
  return (
    <button onClick={onClick} disabled={salvando}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg
        text-[12px] font-semibold transition-all disabled:opacity-50
        ${editando ? 'bg-[#7F77DD] hover:bg-[#6c64cc]' : 'bg-av-green hover:bg-av-green/90'}`}
      style={{ color: editando ? '#fff' : '#0a0f1a' }}>
      <Check size={13} />
      {salvando ? 'Salvando...' : editando ? labelEditar : labelSalvar}
    </button>
  )
}

// ── BtnCancelar ───────────────────────────────────────────────
export function BtnCancelar({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-4 py-2.5 rounded-lg border border-white/10 text-[12px] font-semibold
        transition-all hover:border-white/20"
      style={{ color: '#8b92a8' }}>
      Cancelar
    </button>
  )
}

// ── Segmented ─────────────────────────────────────────────────
export function Segmented({ opcoes, value, onChange }: {
  opcoes: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex bg-[#252d42] border border-white/10 rounded-lg overflow-hidden">
      {opcoes.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className="flex-1 py-2 text-[11px] font-semibold transition-all"
          style={{
            background: o.value === value ? 'rgba(0,200,150,0.15)' : 'transparent',
            color: o.value === value ? '#00c896' : '#8b92a8',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────
export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="mb-4 px-4 py-2.5 bg-av-green/10 border border-av-green/30 text-[12px] font-semibold rounded-lg"
      style={{ color: '#00c896' }}>
      {msg}
    </div>
  )
}

// ── ModalExcluir ──────────────────────────────────────────────
export function ModalExcluir({ nome, mensagem, onConfirmar, onCancelar, salvando }: {
  nome: string; mensagem?: string
  onConfirmar: () => void; onCancelar: () => void; salvando: boolean
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancelar} />
      <div className="relative bg-[#1a1f2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">
        <p className="text-[14px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>Excluir "{nome}"?</p>
        <p className="text-[12px] mb-5" style={{ color: '#8b92a8' }}>
          {mensagem ?? 'Esta ação não pode ser desfeita.'}
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancelar}
            className="px-4 py-2 text-[12px] border border-white/10 rounded-lg transition-all hover:border-white/20"
            style={{ color: '#8b92a8' }}>
            Cancelar
          </button>
          <button onClick={onConfirmar} disabled={salvando}
            className="px-4 py-2 text-[12px] font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors">
            {salvando ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  )
}
