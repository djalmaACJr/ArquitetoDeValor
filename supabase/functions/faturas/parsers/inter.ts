// supabase/functions/faturas/parsers/inter.ts
//
// Parser de fatura do Banco Inter.
//
// Formato observado (cartão de crédito do Inter):
//
//   CARTÃO 5364****5976
//   Data            Movimentação        Beneficiário    Valor
//   17 de mai. 2026 CARTAODETODO* mai   -               R$ 33,40
//   Total CARTÃO 5364****5976                           R$ 33,40
//
// Características:
//   • Cabeçalho "CARTÃO XXXX****YYYY" — 4 primeiros + 4 últimos do número.
//     A mesma fatura pode ter vários cabeçalhos (cartão principal + virtuais).
//   • Data em pt-BR no formato extenso "DD de mes. AAAA" (mes = 3 letras
//     minúsculas + ponto: jan., fev., mar., abr., mai., jun., jul., ago.,
//     set., out., nov., dez.).
//   • Coluna `Beneficiário` pode ser "-" (vazio) ou um nome.
//   • Valor sempre com prefixo "R$".
//   • Linhas "Total CARTÃO ..." são sub-totais por cartão — devem ser filtradas.
//
// O unpdf tipicamente concatena as linhas com espaços, formando uma string
// contínua. Esse parser usa matchAll em todo o texto, igual ao Nubank.

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
//   2 = mês abrev (3 letras minúsculas, com ponto opcional)
//   3 = ano (4 dígitos)
//   4 = descrição+beneficiário (non-greedy até R$)
//   5 = sinal opcional — APENAS adjacente a R$ (sem espaço entre eles).
//       Isso evita falso positivo do `-` da coluna Beneficiário (que
//       aparece sozinho como literal quando o beneficiário está vazio).
//       Aceita `−` (U+2212) ou `-` (hífen) imediatamente antes de R$.
//   6 = valor sem prefixo
const RE_INTER_TX =
  /(\d{1,2})\s+de\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\s+(\d{4})\s+(.+?)\s+([−-]?)R\$\s*([\d.]+,\d{2})/gi;

// Vencimento: o Inter costuma usar "Vencimento: DD/MM/YYYY" no cabeçalho.
const RE_VENCIMENTO =
  /vencimento[:\s]+(\d{1,2})\/(\d{1,2})\/(\d{4})/i;

// Total da fatura — padrões específicos do Inter. Evita o helper genérico
// que captura "Total parcial", "Pagamento mínimo", "Saldo anterior", etc.
// Inter costuma usar variantes de "Valor total" / "Total da fatura".
const RE_TOTAL_INTER_PADROES = [
  /total\s+da\s+fatura[:\s]+R?\$?\s*([\d.,]+)/i,
  /valor\s+da\s+fatura[:\s]+R?\$?\s*([\d.,]+)/i,
  /valor\s+a\s+pagar[:\s]+R?\$?\s*([\d.,]+)/i,
  /total\s+a\s+pagar[:\s]+R?\$?\s*([\d.,]+)/i,
];

// Linhas que parecem subtotal/total/cabeçalho e devem ser ignoradas.
// Exemplos reais:
//   "Total CARTÃO 5364****5976"
//   "Total"
//   "Pagamento" (recebido pelo Inter)
//   "Saldo anterior"
//   "PAGTO DEBITO AUTOMATICO" / "PGTO DEB AUT" — débito automático da
//     fatura: é o usuário pagando a fatura via débito em conta, NÃO uma
//     compra. Pertence ao histórico do extrato como transferência, não
//     deve virar item da fatura.
const DESC_PROIBIDA =
  /^(total\b|subtotal|pagamento\b|pa?g(amen)?to\s+d[ée]b|saldo\b|cart[ãa]o\s+\d|encargos|juros|anuidade|iof|tarifa|limite|d[ée]bito\s+autom)/i;

function parseDataInter(dia: string, mesAbrev: string, ano: number): string | null {
  const mes = MESES_PT[mesAbrev.toLowerCase()];
  if (!mes) return null;
  const d = parseInt(dia, 10);
  if (d < 1 || d > 31) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function extrairVencimentoInter(texto: string): string | null {
  const m = texto.match(RE_VENCIMENTO);
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  const ano = parseInt(m[3], 10);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function extrairValorTotalInter(texto: string): number | null {
  for (const re of RE_TOTAL_INTER_PADROES) {
    const m = texto.match(re);
    if (m) {
      const v = parseValorBR(m[1]);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

/** Remove o sufixo de beneficiário " - " ou " <nome>" que aparece entre
 *  a descrição e o valor. Como não temos delimitador rígido, mantemos a
 *  string inteira (incluindo beneficiário) — a sandbox deixa o usuário
 *  ajustar se quiser. Mas se houver um " -" final isolado (beneficiário
 *  vazio), removemos. */
function limparDescricao(s: string): string {
  return s.replace(/\s+-\s*$/, "").trim();
}

export const parserInter: ParserFatura = {
  id: "inter",

  detectar(texto: string): boolean {
    const t = texto.toLowerCase();
    // Marcadores característicos do Inter:
    //   - "banco inter" no cabeçalho
    //   - CNPJ 00.416.968/0001-01 (Inter)
    //   - "cartão XXXX****YYYY" formato característico (Inter usa 4+****+4)
    return (
      t.includes("banco inter") ||
      t.includes("inter s.a") ||
      t.includes("inter s/a") ||
      texto.includes("00.416.968/0001-01") ||
      /cart[ãa]o\s+\d{4}\*{2,}\d{4}/i.test(texto)
    );
  },

  parsear(texto: string): ParsedFatura {
    const avisos: string[] = [];
    const venc        = extrairVencimentoInter(texto);
    const totalLabel  = extrairValorTotalInter(texto);

    if (!venc) avisos.push("Vencimento Inter não detectado — informe manualmente se necessário.");

    const lancamentos: ParsedLinha[] = [];

    // Normaliza espaços pra que o matchAll trabalhe numa string contínua.
    const texto1L = texto.replace(/\s+/g, " ");
    const mesVenc = venc ? parseInt(venc.slice(5, 7), 10) : null;

    // Mantém o último "CARTÃO XXXX****YYYY" visto pra anotar em `observacao`
    // (assim o usuário vê a qual cartão virtual cada item pertence). O regex
    // é aplicado em paralelo ao matchAll de transações.
    type SectionMark = { pos: number; sufixo: string }
    const sections: SectionMark[] = [];
    for (const m of texto1L.matchAll(/cart[ãa]o\s+(\d{4})\*{2,}(\d{4})/gi)) {
      sections.push({ pos: m.index ?? 0, sufixo: m[2] });
    }
    const sufixoNaPos = (pos: number): string | null => {
      let best: string | null = null;
      for (const s of sections) {
        if (s.pos <= pos) best = s.sufixo;
        else break;
      }
      return best;
    };

    for (const m of texto1L.matchAll(RE_INTER_TX)) {
      const [whole, dia, mesAbrev, anoStr, descRaw, sinal, valorRaw] = m;
      const desc = limparDescricao(descRaw);

      if (desc.length < 3) continue;
      if (DESC_PROIBIDA.test(desc)) continue;

      const ano = parseInt(anoStr, 10);
      const data_compra = parseDataInter(dia, mesAbrev, ano);
      const valor       = parseValorBR(valorRaw);
      if (!data_compra || !Number.isFinite(valor) || valor <= 0) continue;

      // Heurística ano-cruzado: fatura jan/fev com compras de dez do ano
      // anterior. Como o Inter inclui o ano completo na data, esse caso é
      // raro — mas mantemos a defesa.
      let dataAjustada = data_compra;
      const mesCompra = parseInt(data_compra.slice(5, 7), 10);
      if (mesVenc !== null && mesCompra > mesVenc && mesVenc <= 2) {
        dataAjustada = `${ano - 1}${data_compra.slice(4)}`;
      }

      // Estornos/créditos: sinal "−" (U+2212) ou "-" antes do R$.
      const tipo = (sinal === "−" || sinal === "-") ? "RECEITA" as const : "DESPESA" as const;

      const parc = detectarParcelas(desc);
      // Estabelecimento = início da descrição (antes de " - " ou " <beneficiário>").
      const estabelecimento = desc.split(/\s+-\s+/)[0] ?? desc;

      const sufixo = sufixoNaPos(m.index ?? 0);
      const observacao = sufixo ? `Cartão final ${sufixo}` : null;

      lancamentos.push({
        data_compra:     dataAjustada,
        descricao:       desc,
        estabelecimento: estabelecimento,
        valor,
        parcela_atual:   parc?.atual ?? null,
        parcela_total:   parc?.total ?? null,
        observacao,
        tipo,
      });
      void whole;
    }

    if (lancamentos.length === 0) {
      avisos.push("Parser Inter não encontrou lançamentos — formato pode ter mudado.");
    }

    // Total da fatura: prefere a SOMA dos itens parseados (mais confiável
    // no Inter — não há "Total + IOF" como em alguns outros bancos). Só
    // cai no totalLabel se nenhum item foi extraído.
    const somaItens = lancamentos.reduce(
      (s, l) => s + (l.tipo === "RECEITA" ? -Number(l.valor) : Number(l.valor)), 0,
    );
    const total = lancamentos.length > 0 ? somaItens : totalLabel;
    if (total == null) avisos.push("Valor total Inter não detectado.");

    return {
      emissor:           "inter",
      vencimento_fatura: venc,
      valor_total:       total,
      lancamentos,
      avisos,
    };
  },
};
