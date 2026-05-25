// supabase/functions/faturas/parsers/nubank.ts
//
// Parser de fatura do Nubank.
//
// Formato real observado em fatura de 2026-05 (extraído via unpdf):
//
//   29 MAR •••• 3690 Assai Atacadista Lj213 - Parcela 1/2 R$ 213,78
//   29 MAR Desconto Antecipação Vindi *Investidor10 −R$ 8,91
//   06 ABR •••• 9673 Claude.Ai Subscription BRL 110.00 = USD 21.32 ... R$ 113,98
//
// Características importantes:
//   • `DD MMM` (mês abrev em pt-BR: JAN/FEV/MAR/...)
//   • opcional `•••• XXXX` = sufixo do cartão virtual (4 dígitos)
//   • descrição livre (pode conter "- Parcela X/Y", "Antecipada -", etc.)
//   • valor com prefixo R$ — sinal `−` (U+2212, MINUS SIGN, ≠ hífen) indica estorno
//
// O unpdf NÃO preserva quebras de linha entre transações de forma confiável,
// então usamos `matchAll` em todo o texto. Filtros pegam totais ("Total de
// compras ...", "Pagamento recebido ...") que não têm DD MMM no início.

import {
  parseValorBR, detectarParcelas, extrairValorTotal,
} from "./helpers.ts";
import type { ParserFatura, ParsedFatura, ParsedLinha } from "./tipos.ts";

const MESES_PT: Record<string, number> = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
};

// Captura UMA transação completa. Grupos:
//   1 = dia
//   2 = mês abrev
//   3 = sufixo cartão virtual (opcional)
//   4 = descrição (non-greedy até R$)
//   5 = sinal opcional (− U+2212 ou - hífen)
//   6 = valor sem prefixo
//
// Sem `^` porque transações ficam concatenadas em uma linha gigante após o
// unpdf. A non-greedy + boundary forte no `R\$\s*\d+,\d{2}` evita engolir
// múltiplos lançamentos numa só match.
//
// `(?!\d{4})` bloqueia o caso "28 ABR 2026" do cabeçalho "EMISSÃO E ENVIO
// 28 ABR 2026": transações reais nunca têm um ano de 4 dígitos logo após
// o mês abreviado.
const RE_NUBANK_TX =
  /(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(?!\d{4})(?:•+\s*(\d{2,8})\s+)?(.+?)\s+([−-])?\s*R\$\s*([\d.]+,\d{2})/gi;

// Remove o cabeçalho de seção de transações que o unpdf repete em cada
// página: "TRANSAÇÕES DE 29 MAR A 28 ABR ". Sem essa limpeza, o "28 ABR"
// do intervalo de período passa no `(?!\d{4})` (pois vem depois "10 ABR"
// não um ano) e o (.+?) não-guloso engole a 1ª transação real da página.
const RE_HEADER_PERIODO_NUBANK =
  /TRANSA[ÇC][ÕO]ES\s+DE\s+\d{1,2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+[A-Z]\s+\d{1,2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+/gi;

const RE_VENCIMENTO =
  /vencimento[:\s]+(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})/i;

// Descrições que parecem cabeçalho/total/pagamento e devem ser ignoradas.
// Exemplos reais que apareceram no PDF:
//   "a 28 ABR"                 (do "29 MAR a 28 ABR" do resumo)
//   "Djalma A C Junior"        (nome do titular antes do total)
//   "Fechamento da próxima fatura ..."
//   "Pagamento em 06 ABR"      (pagamento recebido pelo Nubank — não é compra)
const DESC_PROIBIDA = /^(a\s|de\s|até\s|fechamento|saldo|total|pagamento\b|limite|próxim|emiss[ãa]o|valor\s+m[áa]ximo)/i;

function parseDataNubank(dia: string, mesAbrev: string, ano: number): string | null {
  const mes = MESES_PT[mesAbrev.toUpperCase()];
  if (!mes) return null;
  const d = parseInt(dia, 10);
  if (d < 1 || d > 31) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extrairVencimentoNubank(texto: string): { iso: string | null; ano: number | null } {
  const m = texto.match(RE_VENCIMENTO);
  if (!m) return { iso: null, ano: null };
  const ano = parseInt(m[3], 10);
  const iso = parseDataNubank(m[1], m[2], ano);
  return { iso, ano };
}

export const parserNubank: ParserFatura = {
  id: "nubank",

  detectar(texto: string): boolean {
    // Marcadores característicos do Nubank. O CNPJ 18.236.120/0001-58 dá
    // zero falso positivo, mas a string "nubank" também serve.
    const t = texto.toLowerCase();
    return (
      t.includes("nu pagamentos") ||
      t.includes("nubank") ||
      texto.includes("18.236.120/0001-58")
    );
  },

  parsear(texto: string): ParsedFatura {
    const avisos: string[] = [];
    const { iso: venc, ano } = extrairVencimentoNubank(texto);
    const total = extrairValorTotal(texto);

    if (!venc)  avisos.push("Vencimento Nubank não detectado.");
    if (!ano)   avisos.push("Ano da fatura Nubank não detectado — datas das compras podem ficar erradas.");
    if (!total) avisos.push("Valor total Nubank não detectado.");

    const anoUsado = ano ?? new Date().getFullYear();
    const lancamentos: ParsedLinha[] = [];

    // Normaliza espaços e remove o cabeçalho de período que o unpdf repete
    // em cada página ("TRANSAÇÕES DE 29 MAR A 28 ABR "). Deve ser feito
    // ANTES do matchAll para que o "28 ABR" do cabeçalho não seja confundido
    // com data de transação e engula a 1ª transação real da página.
    const texto1L = texto.replace(/\s+/g, " ").replace(RE_HEADER_PERIODO_NUBANK, " ");
    const mesVenc = venc ? parseInt(venc.slice(5, 7), 10) : null;

    for (const m of texto1L.matchAll(RE_NUBANK_TX)) {
      const [, dia, mesAbrev, sufixo, descRaw, sinal, valorRaw] = m;
      const desc = descRaw.trim();

      // Filtra "matches" que são na verdade resumos da fatura (sem
      // estabelecimento real após a data).
      if (desc.length < 3) continue;
      if (DESC_PROIBIDA.test(desc)) continue;

      // Créditos (estornos, descontos) vêm com sinal "−" (U+2212) ou "-".
      // Valor permanece positivo; tipo RECEITA diferencia do débito normal.
      const tipo = (sinal === "−" || sinal === "-") ? "RECEITA" as const : "DESPESA" as const;

      const data_compra = parseDataNubank(dia, mesAbrev, anoUsado);
      let   valor       = parseValorBR(valorRaw);

      // Transações internacionais trazem a taxa de câmbio antes do valor real:
      //   "Claude.Ai Subscription BRL 110.00 = USD 21.32 Conversão: BRL 5.34 = USD 1 = R$ 5,34 R$ 113,98"
      // O não-guloso para em R$ 5,34 (taxa); o valor real R$ 113,98 fica logo
      // após o fim do match. Detectamos pelo padrão "BRL X = USD" na descrição
      // e relemos o trecho seguinte para corrigir o valor.
      if (/BRL\s+[\d.]+\s*=\s*USD/i.test(desc)) {
        const pos   = (m.index ?? 0) + m[0].length;
        const apos  = texto1L.slice(pos, pos + 50);
        const mReal = apos.match(/^\s*R\$\s*([\d.]+,\d{2})/i);
        if (mReal) {
          const vReal = parseValorBR(mReal[1]);
          if (Number.isFinite(vReal) && vReal > valor) valor = vReal;
        }
      }

      if (!data_compra || !Number.isFinite(valor) || valor <= 0) continue;

      // Heurística de ano cruzado: fatura que vence em jan/fev costuma ter
      // compras de dez do ano anterior. Recua o ano nesses casos.
      let dataAjustada = data_compra;
      const mesCompra = parseInt(data_compra.slice(5, 7), 10);
      if (mesVenc !== null && mesCompra > mesVenc && mesVenc <= 2) {
        dataAjustada = `${anoUsado - 1}${data_compra.slice(4)}`;
      }

      const parc = detectarParcelas(desc);
      // Estabelecimento = início da descrição (antes de "- Parcela ..." ou similar).
      const estabelecimento = desc.split(/\s+-\s+/)[0] ?? desc;

      // Sufixo do cartão virtual vai no campo `observacao` do item; em F3
      // podemos casar com arqvalor.contas.cartoes_virtuais pra mostrar apelido.
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
    }

    if (lancamentos.length === 0) {
      avisos.push("Parser Nubank não encontrou lançamentos — formato pode ter mudado.");
    }

    return {
      emissor:           "nubank",
      vencimento_fatura: venc,
      valor_total:       total,
      lancamentos,
      avisos,
    };
  },
};
