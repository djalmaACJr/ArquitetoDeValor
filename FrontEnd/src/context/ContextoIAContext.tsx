// src/context/ContextoIAContext.tsx
//
// Contexto global que cada página pode "preencher" com um snapshot dos
// dados visíveis (resumo do mês, lista de transações, insights, etc.).
// O ChatMascote lê esse snapshot e oferece anexá-lo à conversa, permitindo
// que a IA "veja" os mesmos dados que o usuário está vendo na tela.
//
// IMPORTANTE — arquitetura split context:
//   - SetterCtx: valor estável (useCallback). Páginas que ESCREVEM via
//     `useRegistrarContextoIA` consomem APENAS este. Como o valor nunca
//     muda, não são re-renderizadas quando o contexto atualiza.
//   - ValueCtx: contém o snapshot atual. Só o ChatMascote (consumidor)
//     subscreve aqui.
//
// Sem o split, useContext propaga re-render pra TODAS as páginas a cada
// `definirContexto(...)`, causando loop (página renderiza → effect dispara
// → setContexto → Provider re-renderiza → página re-renderiza → effect
// dispara de novo → ...).
//
// Uso típico em uma página:
//
//   useRegistrarContextoIA(useMemo(() => ({
//     titulo: `Dashboard · ${mesLabel(mes)}`,
//     dados: { ... },
//   }), [mes, ...]))

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export interface ContextoIA {
  /** Título curto (1 linha) — ex.: "Dashboard · Mai/2026" */
  titulo:    string
  /** Descrição breve do que os dados representam */
  descricao?: string
  /** Snapshot serializável dos dados da página */
  dados:     unknown
}

type Setter = (c: ContextoIA | null) => void

// Dois contextos distintos: leitura (muda) e escrita (estável).
const ValueCtx  = createContext<ContextoIA | null>(null)
const SetterCtx = createContext<Setter>(() => { /* noop */ })

export function ContextoIAProvider({ children }: { children: ReactNode }) {
  const [contexto, setContexto] = useState<ContextoIA | null>(null)
  // Estável — useCallback([]) garante que páginas que consomem só o setter
  // não re-renderizam quando o contexto muda.
  const definir = useCallback<Setter>(c => setContexto(c), [])
  return (
    <SetterCtx.Provider value={definir}>
      <ValueCtx.Provider value={contexto}>
        {children}
      </ValueCtx.Provider>
    </SetterCtx.Provider>
  )
}

/** Lê o contexto atual. Só usado pelo ChatMascote. */
export function useContextoIA(): ContextoIA | null {
  return useContext(ValueCtx)
}

/**
 * Registra dados da página atual no contexto global de IA. Auto-limpa na
 * desmontagem. Memoize o `contexto` com useMemo pra evitar re-registro a
 * cada render.
 *
 * Esta função consome SOMENTE o setter (que é estável), então NÃO causa
 * re-render da página quando o contexto muda. Isso quebra o ciclo
 * descrito no header do arquivo.
 */
export function useRegistrarContextoIA(contexto: ContextoIA | null) {
  const definir = useContext(SetterCtx)
  useEffect(() => {
    definir(contexto)
    return () => definir(null)
  }, [contexto, definir])
}

/**
 * Serializa o contexto pra texto que será injetado na conversa com a IA.
 * Formato compacto pra economizar tokens.
 */
export function serializarContexto(c: ContextoIA): string {
  const partes: string[] = []
  partes.push(`[Contexto da página: ${c.titulo}]`)
  if (c.descricao) partes.push(c.descricao)
  partes.push('Dados:')
  partes.push(JSON.stringify(c.dados, null, 2))
  return partes.join('\n')
}

// `useMemo` é importado apenas porque outros arquivos (consumidores) o
// reexportam indiretamente — mantém a forma compatível com a versão
// anterior do módulo.
export { useMemo }
