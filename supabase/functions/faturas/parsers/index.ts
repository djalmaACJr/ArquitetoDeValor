// supabase/functions/faturas/parsers/index.ts
//
// Pipeline de parsing de fatura. Dado o texto extraído do PDF, executa
// os parsers conhecidos em ordem: o primeiro que `detectar(texto) === true`
// é escolhido; se nenhum específico aceitar, cai no genérico.
//
// Para adicionar um novo emissor (Inter, C6, Itaú, …):
//   1. Crie ./<emissor>.ts implementando ParserFatura.
//   2. Importe aqui e adicione na lista `PARSERS` ANTES do genérico.

import type { ParserFatura, ParsedFatura } from "./tipos.ts";
import { parserNubank }   from "./nubank.ts";
import { parserGenerico } from "./generico.ts";

const PARSERS: ParserFatura[] = [
  parserNubank,
  // parserInter,    // TODO F2.x
  // parserC6,       // TODO F2.x
  parserGenerico,    // fallback — sempre por último
];

export function parsearFatura(texto: string): ParsedFatura {
  for (const p of PARSERS) {
    if (p.detectar(texto)) {
      return p.parsear(texto);
    }
  }
  // Garantia: o parserGenerico sempre aceita; o for acima sempre retorna.
  // Mas mantemos um fallback explícito por defesa.
  return parserGenerico.parsear(texto);
}

export type { ParserFatura, ParsedFatura };
export type { ParsedLinha } from "./tipos.ts";
