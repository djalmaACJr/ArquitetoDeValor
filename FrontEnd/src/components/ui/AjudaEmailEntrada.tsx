const MUTED = '#8b92a8'

// Passo a passo do encaminhamento nos provedores mais usados. Os menus mudam com o tempo:
// o texto diz isso e dá o nome da função a procurar.
const PROVEDORES: { nome: string; passos: string[]; nota?: string }[] = [
  {
    nome: 'Gmail (Google)',
    passos: [
      'No computador, abra o Gmail → engrenagem → Ver todas as configurações → aba "Encaminhamento e POP/IMAP".',
      'Clique em "Adicionar um endereço de encaminhamento" e cole o seu endereço de entrada (acima).',
      'O Google envia um código de confirmação para esse endereço. Ele aparece aqui, na aba Caixa de entrada, em quarentena. Copie o código, volte ao Gmail e digite.',
      'Ainda nas configurações, abra "Filtros e endereços bloqueados" → Criar novo filtro → em "De" coloque o remetente (ex.: @b3.com.br) → Criar filtro → marque "Encaminhar para" e escolha o seu endereço de entrada.',
    ],
    nota: 'Use sempre filtro por remetente: assim só o que interessa sai do seu Gmail. Não ligue o encaminhamento de todos os e-mails.',
  },
  {
    nome: 'Outlook / Hotmail / Live',
    passos: [
      'Abra o Outlook na web (outlook.live.com) → engrenagem (Configurações) → E-mail → Regras → Adicionar nova regra.',
      'Dê um nome, em "Adicionar uma condição" escolha "Endereço do remetente" (ou "De") e informe o remetente (ex.: b3.com.br).',
      'Em "Adicionar uma ação" escolha "Redirecionar para" (melhor) ou "Encaminhar para" e informe o seu endereço de entrada. Salve.',
    ],
    nota: 'Prefira "Redirecionar": ele mantém o remetente original. Se só houver "Encaminhar", o e-mail chega aqui como se fosse enviado por você — nesse caso, permita o seu próprio endereço do Outlook na lista de remetentes.',
  },
  {
    nome: 'Yahoo Mail',
    passos: [
      'Abra o Yahoo Mail → Configurações → Mais configurações → Caixas de correio → escolha a sua conta.',
      'Em "Encaminhamento", informe o seu endereço de entrada e confirme o código que o Yahoo enviar (ele aparece aqui, em quarentena).',
      'Para encaminhar só alguns remetentes, use Configurações → Filtros → Adicionar novo filtro.',
    ],
    nota: 'O encaminhamento no Yahoo pode exigir um plano pago (Yahoo Mail Plus). Se a opção não aparecer, é por isso.',
  },
  {
    nome: 'iCloud Mail (Apple)',
    passos: [
      'Entre em icloud.com/mail → engrenagem → Configurações → Regras (ou "Gerenciar regras") → Adicionar uma regra.',
      'Condição: "Se uma mensagem for de" + o remetente (ex.: b3.com.br). Ação: "Encaminhar para" + o seu endereço de entrada.',
      'Salve a regra e, se o iCloud pedir, confirme o endereço de destino.',
    ],
  },
  {
    nome: 'UOL, BOL, Terra e outros',
    passos: [
      'Procure nas configurações do webmail por "Encaminhamento", "Redirecionamento", "Regras" ou "Filtros".',
      'Crie uma regra: se o remetente for o que você quer, encaminhe uma cópia para o seu endereço de entrada.',
      'Se o provedor pedir confirmação, o e-mail dele chega aqui, em quarentena.',
    ],
    nota: 'Alguns provedores gratuitos não oferecem encaminhamento. Nesse caso, considere receber esses avisos em Gmail ou Outlook e encaminhar de lá.',
  },
]

export function AjudaEncaminhamento() {
  return (
    <details open className="text-[12px]" style={{ color: MUTED }} data-tutorial="email-ajuda">
      <summary className="cursor-pointer text-white/85 text-[13px]">Como configurar o encaminhamento automático (Gmail, Outlook, Yahoo, iCloud e outros)</summary>
      <div className="mt-2 space-y-2">
        <p>
          O objetivo é que uma <b className="text-white/85">cópia</b> dos e-mails certos chegue ao seu endereço de entrada. Os e-mails continuam na sua caixa normal.
          Os nomes dos menus mudam de vez em quando: se não achar, procure a função indicada em negrito.
        </p>
        {PROVEDORES.map((p) => (
          <details key={p.nome} className="rounded-lg border border-white/10 px-3 py-2">
            <summary className="cursor-pointer text-white/90 text-[13px] font-medium">{p.nome}</summary>
            <ol className="list-decimal pl-5 mt-2 space-y-1">
              {p.passos.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            {p.nota && <p className="mt-2" style={{ color: '#f0b429' }}>{p.nota}</p>}
          </details>
        ))}
        <p>
          <b className="text-white/85">Dica:</b> o primeiro e-mail de cada remetente cai em quarentena. Confira de quem ele é e aprove na aba Caixa de entrada:
          é o jeito mais seguro de descobrir o endereço exato que a administradora usa.
        </p>
      </div>
    </details>
  )
}

// Exemplos de remetentes comuns de FIIs/ações. São só pontos de partida: o endereço real
// pode ser diferente — confira no e-mail original (Gmail: "Mostrar original").
const REMETENTES_EXEMPLO: { padrao: string; nome: string }[] = [
  { padrao: '@b3.com.br',           nome: 'B3 (avisos e comunicados)' },
  { padrao: '@cvm.gov.br',          nome: 'CVM' },
  { padrao: '@btgpactual.com',      nome: 'BTG Pactual (administradora/gestora)' },
  { padrao: '@xpi.com.br',          nome: 'XP Investimentos' },
  { padrao: '@kinea.com.br',        nome: 'Kinea (gestora)' },
  { padrao: '@vincipartners.com',   nome: 'Vinci Partners (gestora)' },
  { padrao: '@riobravo.com.br',     nome: 'Rio Bravo (gestora)' },
  { padrao: '@bancointer.com.br',   nome: 'Banco Inter' },
  { padrao: '@brltrust.com.br',     nome: 'BRL Trust (administradora)' },
  { padrao: '@oliveiratrust.com.br', nome: 'Oliveira Trust (administradora)' },
  { padrao: '@vortx.com.br',        nome: 'Vórtx (administradora)' },
  { padrao: '@intrag.com.br',       nome: 'Intrag (administradora)' },
]

export function SugestoesRemetentes({ jaTem, ocupado, onPermitir }: { jaTem: string[]; ocupado: boolean; onPermitir: (padrao: string) => void }) {
  const faltam = REMETENTES_EXEMPLO.filter((r) => !jaTem.includes(r.padrao))
  if (faltam.length === 0) return null
  return (
    <details className="text-[12px]" style={{ color: MUTED }} data-tutorial="email-sugestoes">
      <summary className="cursor-pointer text-white/85 text-[13px]">Exemplos de remetentes para permitir</summary>
      <p className="mt-2">
        São exemplos comuns, não uma lista oficial: o endereço pode ser outro. Confira o remetente real nos e-mails que você recebe (e na quarentena) antes de permitir.
        Permitir um domínio libera todos os e-mails dele; para ser mais restrito, informe o endereço completo.
      </p>
      <ul className="mt-2 space-y-1">
        {faltam.map((r) => (
          <li key={r.padrao} className="flex items-center justify-between gap-2">
            <span className="text-white/85"><span className="break-all">{r.padrao}</span> <span style={{ color: MUTED }}>· {r.nome}</span></span>
            <button disabled={ocupado} onClick={() => onPermitir(r.padrao)}
              className="px-2 py-0.5 rounded-md text-[12px] hover:bg-white/10 disabled:opacity-50 shrink-0" style={{ color: '#3b82f6', border: '1px solid rgba(59,130,246,0.4)' }}>Permitir</button>
          </li>
        ))}
      </ul>
    </details>
  )
}
