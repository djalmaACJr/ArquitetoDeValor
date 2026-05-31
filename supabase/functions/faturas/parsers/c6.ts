// supabase/functions/faturas/parsers/c6.ts
//
// Parser de fatura do C6 Bank.
//
// Formato observado (cartão de crédito C6 Platinum, com cartões virtuais):
//
//   Cartão C6 Platinum
//   ...
//   Vencimento: 05/06/2026
//   ...
//   C6 Platinum Virtual Final 8809 - DJALMA JR  Cartão Virtual  Subtotal deste cartão R$ 356,90
//   22 ago   MTD*AMORSAUDE BETIM - Parcela 10/10                 270,00
//   07 mai   GOOGLE MICROSOFT ONED                                33,00
//   11 mai   GOOGLE YOUTUBE                                       53,90
//
// Características importantes:
//   • Data sem ano: "DD mes" (mes em minúsculo, 3 letras, sem ponto).
//     O ano vem do vencimento — se mês_compra > mês_venc, é ano anterior
//     (ex.: parcela 10/10 da compra original em ago/2025 cai numa fatura
//     de vencimento jun/2026).
//   • Valor SEM prefixo R$ — só "270,00" puro. Distingue do "R$ 356,90"
//     do subtotal (que tem R$ explícito e não tem data antes).
//   • Cartões virtuais aparecem como "Final XXXX" — capturado pro
//     observacao do item ("Cartão final XXXX").
//   • Estornos podem vir como "-270,00" (hífen colado no valor) ou
//     com "(R$ X,YY)" — implementamos só o sinal adjacente por enquanto.

import {
  parseValorBR, detectarParcelas,
} from "./helpers.ts";
import type { ParserFatura, ParsedFatura, ParsedLinha } from "./tipos.ts";

const MESES_PT: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

// Captura UMA transação. Grupos:
//   1 = dia
//   2 = mês abrev (3 letras minúsculas, sem ponto)
//   3 = descrição (non-greedy até o valor)
//   4 = sinal opcional adjacente ao valor (− U+2212 ou - hífen)
//   5 = valor sem prefixo R$ — formato BR com vírgula
//
// O \b após o valor evita engolir uma fração maior (ex.: "270,000")
// ou casar com "Parcela 10/10" (sem vírgula).
const RE_C6_TX =
  /(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(.+?)\s+([−-]?)([\d]{1,3}(?:\.\d{3})*,\d{2})\b/gi;

const RE_VENCIMENTO_C6 =
  /vencimento[:\s]+(\d{1,2})\/(\d{1,2})\/(\d{4})/i;

// "Valor da fatura: R$ 356,90" — usado quando não há "total a pagar".
const RE_TOTAL_C6 =
  /valor\s+da\s+fatura[:\s]+R?\$?\s*([\d.]+,\d{2})/i;

// Marca de cartão virtual: "Final 8809" (4 dígitos).
// Usado pra anotar o cartão final em cada item parseado.
const RE_CARTAO_FINAL = /final\s+(\d{4})/gi;

// Linhas/strings que parecem cabeçalho/total/encargo e devem ser ignoradas.
// O C6 tem muito cabeçalho — encargos, IOF, parcelamento, etc. Tudo isso
// vem ANTES da seção de transações.
const DESC_PROIBIDA =
  /^(total\b|subtotal\b|pagamento\b|pag\s+(fatura|boleto)|saldo\b|encargos|juros|anuidade|iof\b|tarifa\b|limite|cart[ãa]o\b|vencimento|melhor\s+dia|fechamento|composi[çc][ãa]o|entrada\s+\+|em\s+at[ée]|valor\s+da\s+fatura|d[ée]bito\s+autom|pa?g(amen)?to\s+d[ée]b|pix\b|c[óo]digo|d[úu]vidas?|valor\s+m[íi]nimo|parcelamento)/i;

function parseDataC6(dia: string, mesAbrev: string, ano: number): string | null {
  const mes = MESES_PT[mesAbrev.toLowerCase()];
  if (!mes) return null;
  const d = parseInt(dia, 10);
  if (d < 1 || d > 31) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function extrairVencimentoC6(texto: string): string | null {
  const m = texto.match(RE_VENCIMENTO_C6);
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  const ano = parseInt(m[3], 10);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function extrairValorTotalC6(texto: string): number | null {
  const m = texto.match(RE_TOTAL_C6);
  if (!m) return null;
  const v = parseValorBR(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export const parserC6: ParserFatura = {
  id: "c6",

  detectar(texto: string): boolean {
    const t = texto.toLowerCase();
    return (
      t.includes("c6 bank") ||
      t.includes("cartão c6") ||
      t.includes("cartao c6") ||
      t.includes("c6 platinum") ||
      t.includes("c6 carbon")
    );
  },

  parsear(texto: string): ParsedFatura {
    const avisos: string[] = [];
    const venc  = extrairVencimentoC6(texto);
    const total = extrairValorTotalC6(texto);

    if (!venc)  avisos.push("Vencimento C6 não detectado — informe manualmente se necessário.");
    if (!total) avisos.push("Valor total C6 não detectado.");

    if (!venc) {
      return { emissor: "c6", vencimento_fatura: null, valor_total: total, lancamentos: [], avisos };
    }

    const anoVenc = parseInt(venc.slice(0, 4), 10);
    const mesVenc = parseInt(venc.slice(5, 7), 10);
    const lancamentos: ParsedLinha[] = [];

    // Normaliza espaços pra trabalhar numa string contínua.
    const texto1L = texto.replace(/\s+/g, " ");

    // Indexa todas as ocorrências de "Final XXXX" pra associar cada
    // transação ao cartão virtual mais próximo antes dela.
    type SectionMark = { pos: number; sufixo: string }
    const sections: SectionMark[] = [];
    for (const m of texto1L.matchAll(RE_CARTAO_FINAL)) {
      sections.push({ pos: m.index ?? 0, sufixo: m[1] });
    }
    const sufixoNaPos = (pos: number): string | null => {
      let best: string | null = null;
      for (const s of sections) {
        if (s.pos <= pos) best = s.sufixo;
        else break;
      }
      return best;
    };

    for (const m of texto1L.matchAll(RE_C6_TX)) {
      const [, dia, mesAbrev, descRaw, sinal, valorRaw] = m;
      const desc = descRaw.trim().replace(/\s+-\s*$/, "");

      if (desc.length < 3) continue;
      if (DESC_PROIBIDA.test(desc)) continue;

      // Heurística de ano: a data da compra precisa estar ANTES do venc.
      // Se mes_compra > mes_venc → ano anterior. Ex.: venc 06/2026 com
      // "22 ago" → 22-ago-2025 (parcela tardia).
      const anoCompra = (parseInt(mesAbrev ? MESES_PT[mesAbrev.toLowerCase()].toString() : "0", 10) > mesVenc)
        ? anoVenc - 1
        : anoVenc;
      const data_compra = parseDataC6(dia, mesAbrev, anoCompra);
      const valor       = parseValorBR(valorRaw);
      if (!data_compra || !Number.isFinite(valor) || valor <= 0) continue;

      // Sinal adjacente ao valor → RECEITA (estorno/crédito).
      const tipo = (sinal === "−" || sinal === "-") ? "RECEITA" as const : "DESPESA" as const;

      const parc = detectarParcelas(desc);
      const estabelecimento = desc.split(/\s+-\s+/)[0] ?? desc;
      const sufixo = sufixoNaPos(m.index ?? 0);
      const observacao = sufixo ? `Cartão final ${sufixo}` : null;

      lancamentos.push({
        data_compra,
        descricao:       desc,
        estabelecimento: estabelecimento,
        valor,
        parcela_atual:   parc?.atual ?? null,
        parcela_total:   parc?.total ?? null,
        observacao,
        tipo,
      });
    }

    if (lancamentos.length === 0) {
      avisos.push("Parser C6 não encontrou lançamentos — formato pode ter mudado.");
    }

    return {
      emissor:           "c6",
      vencimento_fatura: venc,
      valor_total:       total,
      lancamentos,
      avisos,
    };
  },
};
