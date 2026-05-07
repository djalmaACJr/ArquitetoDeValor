// src/lib/logger.ts
// Logger condicional — em build de produção `import.meta.env.DEV` é
// substituído por `false` e o bundler tree-shake o ramo `if (DEV)`,
// removendo os argumentos das chamadas (incluindo template strings).
//
// Uso:
//   import { log, debug } from '../lib/logger'
//   log('algo aconteceu', payload)
//
// `console.warn` e `console.error` continuam disponíveis diretamente
// — eles devem ser preservados para reporte legítimo de erros.

const DEV = import.meta.env.DEV

export const log:   typeof console.log   = DEV ? console.log.bind(console)   : () => {}
export const debug: typeof console.debug = DEV ? console.debug.bind(console) : () => {}
export const info:  typeof console.info  = DEV ? console.info.bind(console)  : () => {}
