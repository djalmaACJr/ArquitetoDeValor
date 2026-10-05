// src/lib/espacoAtivo.ts
//
// "Espaço" ativo do usuário logado — os próprios dados (padrão) ou os
// dados de um dono que o autorizou como agregado (conta compartilhada,
// ver CompartilhamentoPage). Store fora do React, mesmo padrão de
// operacaoLonga.ts/avisoFecharAba.ts: `lib/api.ts` precisa ler o
// `dono_id` ativo SINCRONAMENTE pra anexar o header `X-Contexto-User-Id`
// em toda chamada — e o mesmo valor também precisa dirigir UI reativa
// (seletor de espaço na Sidebar), daí o publish/subscribe pra
// `useSyncExternalStore`.
//
// A Edge Function nunca confia só nisso — resolverContexto() revalida
// server-side via fn_agregado_tem_acesso a cada request. O que este store
// decide é só "qual header mandar", nunca "o que é permitido".

export interface ModuloPermissao {
  modulo: 'EXTRATO' | 'OBJETIVOS' | 'INVESTIMENTOS'
  pode_escrever: boolean
}

export interface VinculoAgregado {
  id: string
  dono_id: string
  dono_nome: string
  // Fase 1 é só leitura independente do módulo — permissoes[] só passa a
  // ser preenchido/consultado de verdade a partir da Fase 2 (escrita).
  permissoes: ModuloPermissao[]
}

interface EspacoAtivo {
  /** null = "Meus dados" (padrão). */
  vinculo: VinculoAgregado | null
}

let estado: EspacoAtivo = { vinculo: null }
const listeners = new Set<() => void>()
// Sobrescrita por initEspacoAtivo(uid) — namespaced por usuário logado
// pra nunca herdar o espaço ativo de uma conta pra outra no mesmo navegador.
let chaveStorage = 'arqvalor:espaco-ativo'

function notificar() { for (const l of listeners) l() }

/** Chamado no login/troca de usuário (ver main.tsx) — carrega o espaço
 *  salvo para ESTE uid, se houver. uid=null (deslogado) zera o estado. */
export function initEspacoAtivo(uid: string | null): void {
  chaveStorage = uid ? `arqvalor:espaco-ativo:${uid}` : 'arqvalor:espaco-ativo:anon'
  let vinculo: VinculoAgregado | null = null
  try {
    const raw = localStorage.getItem(chaveStorage)
    vinculo = raw ? (JSON.parse(raw) as VinculoAgregado) : null
  } catch { /* JSON inválido/storage indisponível — volta pra "Meus dados" */ }
  estado = { vinculo }
  notificar()
}

export function subscribeEspacoAtivo(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// getSnapshot precisa devolver referência ESTÁVEL enquanto nada muda (regra
// do useSyncExternalStore) — mesmo padrão de avisoFecharAba.ts.
export function getEspacoAtivoSnapshot(): EspacoAtivo {
  return estado
}

export function setEspacoAtivo(vinculo: VinculoAgregado | null): void {
  if (estado.vinculo?.id === vinculo?.id) return
  estado = { vinculo }
  try {
    if (vinculo) localStorage.setItem(chaveStorage, JSON.stringify(vinculo))
    else localStorage.removeItem(chaveStorage)
  } catch { /* quota cheia ou storage indisponível — segue só em memória */ }
  notificar()
}

/** Lido por lib/api.ts (fora da árvore React) a cada requisição. */
export function contextoUserIdAtivo(): string | null {
  return estado.vinculo?.dono_id ?? null
}

export function permissaoDoModulo(modulo: ModuloPermissao['modulo']): ModuloPermissao | null {
  return estado.vinculo?.permissoes.find(p => p.modulo === modulo) ?? null
}
