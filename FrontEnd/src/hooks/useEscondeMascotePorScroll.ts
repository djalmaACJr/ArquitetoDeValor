import { useSyncExternalStore } from 'react'
import { subscribeEscondeMascotePorScroll, getEscondeMascotePorScroll } from '../lib/scrollMascote'

// true só no Android e só depois que o <main> rolou passado do limiar —
// ver src/lib/scrollMascote.ts.
export function useEscondeMascotePorScroll() {
  return useSyncExternalStore(subscribeEscondeMascotePorScroll, getEscondeMascotePorScroll, () => false)
}
