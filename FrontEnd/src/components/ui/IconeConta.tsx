// src/components/ui/IconeConta.tsx
// Renderiza ícone de conta: base64, URL http, emoji ou fallback

export function IconeConta({
  icone, cor, size = 'md',
}: {
  icone?: string | null
  cor?:   string | null
  size?:  'sm' | 'md' | 'lg'
}) {
  const dims  = { sm: 'w-5 h-5', md: 'w-8 h-8', lg: 'w-10 h-10' }[size]
  const texto = { sm: 'text-xs',  md: 'text-sm',  lg: 'text-lg'  }[size]
  const bg    = cor ? `${cor}20` : 'rgba(77,166,255,0.12)'
  const isImg = !!(icone?.startsWith('http') || icone?.startsWith('/') || icone?.startsWith('data:'))

  return (
    <div
      className={`${dims} rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden`}
      style={{ background: bg }}
    >
      {isImg ? (
        <img
          src={icone!}
          alt=""
          className="w-full h-full object-contain p-[2px]"
          onError={e => {
            const img = e.target as HTMLImageElement
            img.style.display = 'none'
            if (img.parentElement) img.parentElement.textContent = '🏦'
          }}
        />
      ) : (
        <span className={texto}>{icone || '🏦'}</span>
      )}
    </div>
  )
}
