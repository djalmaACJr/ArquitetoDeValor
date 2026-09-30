// supabase/functions/faturas/parsers/itau.ts
//
// Parser de fatura do Itaú (cartão de crédito).
//
// Formato observado (fatura PDF baixada do app/site Itaú):
//
//   Lançamentos: compras e saques
//   Djalma A C Junior
//   DATA ESTABELECIMENTO VALOR EM R$
//   26/09 ASSAI ATACADIS 01/03            158,07
//   outros BETIM
//   Lançamentos no cartão                 158,07
//   Lançamentos: produtos e serviços
//   DATA PRODUTOS/SERVIÇOS VALOR EM R$
//   26/09 Mensalidade - Plano do            19,90
//   Anuidade Diferenciada
//   Lançamentos produtos e serviços         19,90
//   Total dos lançamentos atuais           177,97
//   Compras parceladas - próximas faturas
//   DATA ESTABELECIMENTO VALOR EM R$
//   26/09 ASSAI ATACADIS 02/03            158,07
//   ...
//
// Características importantes:
//   • Data sem ano: "DD/MM" — o ano vem do vencimento, com a mesma
//     heurística de ano cruzado de helpers.parseDataBR (mês da compra >
//     mês do vencimento → ano anterior).
//   • Valor SEM prefixo "R$" nas linhas de lançamento — só "158,07" puro
//     (o "R$" só aparece uma vez, no cabeçalho da coluna "VALOR EM R$").
//   • O unpdf tipicamente achata as linhas em espaços (mesmo caso do
//     Inter/C6 — ver comentário em inter.ts), então este parser trabalha
//     na string inteira normalizada, não linha a linha como o genérico.
//   • Cada transação pode ter uma linha de CONTINUAÇÃO logo depois, sem
//     data nem valor (ex.: "outros BETIM", "Anuidade Diferenciada" — o
//     resto do nome do estabelecimento/produto que não coube na largura da
//     coluna). Como ela vem DEPOIS do valor que fecha o match da regex,
//     é simplesmente ignorada — não começa com "DD/MM", então nunca vira
//     o início de uma nova transação nem é incluída na descrição da atual.
//   • A seção "Compras parceladas - próximas faturas" reaproveita o MESMO
//     formato de linha pra listar as parcelas futuras de compras já
//     parceladas — não são lançamentos DESTA fatura e têm que ser
//     excluídas, senão a parcela seguinte de uma compra parcelada entraria
//     duplicada (uma vez como lançamento atual, outra como "próxima").
//     Isso é feito recortando o texto entre o primeiro "Lançamentos:" e o
//     primeiro marcador de fim encontrado (ver REGEXS_FIM) — normalmente
//     "Total dos lançamentos atuais", que fecha exatamente as duas
//     subseções que interessam (compras/saques e produtos/serviços) antes
//     de "Compras parceladas" começar.

import {
  parseValorBR, parseDataBR, detectarParcelas,
} from "./helpers.ts";
import type { ParserFatura, ParsedFatura, ParsedLinha } from "./tipos.ts";

// Vencimento: "Com vencimento em: DD/MM/YYYY" (resumo do cartão) ou
// "Data de Vencimento ... DD/MM/YYYY" / "Vencimento: DD/MM/YYYY" (boleto
// anexo à fatura) — tenta na ordem, usa o primeiro que bater.
const REGEXS_VENCIMENTO = [
  /com\s+vencimento\s+em[:\s]+(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
  /vencimento[:\s]+(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
];

// "O total da sua fatura é: R$ 177,97" — preferido; fallback pro genérico
// "Total desta fatura 177,97" do resumo no topo.
const REGEXS_TOTAL = [
  /o\s+total\s+da\s+sua\s+fatura\s+[ée][:\s]+R?\$?\s*([\d.,]+)/i,
  /total\s+desta\s+fatura[:\s]+R?\$?\s*([\d.,]+)/i,
];

// Início das seções de lançamentos do período atual (podem existir as duas:
// "compras e saques" e "produtos e serviços" — cada uma com sua própria
// tabela DATA/descrição/VALOR, mas o mesmo formato de linha).
const RE_INICIO_LANCAMENTOS = /lan[çc]amentos:\s*(compras\s+e\s+saques|produtos\s+e\s+servi[çc]os)/i;

// Candidatos a marcador de FIM da região de lançamentos atuais, em ordem de
// preferência — usa o que aparecer primeiro no texto (mais próximo do
// início). "Total dos lançamentos atuais" é o mais confiável (soma exata
// do que deve entrar); os outros são fallback caso o texto venha diferente.
const REGEXS_FIM = [
  /total\s+dos\s+lan[çc]amentos\s+atuais/i,
  /compras\s+parceladas\s*-\s*pr[óo]ximas\s+faturas/i,
  /limites\s+de\s+cr[ée]dito/i,
];

// Captura UMA transação dentro do trecho recortado. Grupos:
//   1 = dia, 2 = mês, 3 = descrição (non-greedy até o valor),
//   4 = sinal opcional adjacente ao valor (estorno/crédito — não
//       observado na amostra real, mas mantido por paridade com os
//       demais parsers, que tratam esse caso), 5 = valor sem prefixo R$.
const RE_ITAU_TX =
  /(\d{2})\/(\d{2})\s+(.+?)\s+([−-]?)([\d]{1,3}(?:\.\d{3})*,\d{2})\b/g;

// Defesa extra: linhas de cabeçalho/subtotal que por algum motivo passem
// pelo recorte de seção (não deveriam, já que não começam com "DD/MM").
const DESC_PROIBIDA = /^(lan[çc]amentos\b|data\b|total\b|subtotal\b)/i;

function encontrarPrimeiro(texto: string, regexes: RegExp[]): number {
  let melhor = -1;
  for (const re of regexes) {
    const idx = texto.search(re);
    if (idx >= 0 && (melhor < 0 || idx < melhor)) melhor = idx;
  }
  return melhor;
}

function extrairVencimentoItau(texto: string): string | null {
  for (const re of REGEXS_VENCIMENTO) {
    const m = texto.match(re);
    if (!m) continue;
    const dia = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    const ano = parseInt(m[3], 10);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    }
  }
  return null;
}

function extrairValorTotalItau(texto: string): number | null {
  for (const re of REGEXS_TOTAL) {
    const m = texto.match(re);
    if (m) {
      const v = parseValorBR(m[1]);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

export const parserItau: ParserFatura = {
  id: "itau",

  detectar(texto: string): boolean {
    const t = texto.toLowerCase();
    return (
      t.includes("banco itaú") ||
      t.includes("banco itau") ||
      t.includes("itaú unibanco") ||
      t.includes("itau unibanco") ||
      t.includes("itau.com.br") ||
      /fatura\s+ita[úu]/i.test(texto)
    );
  },

  parsear(texto: string): ParsedFatura {
    const avisos: string[] = [];
    const venc  = extrairVencimentoItau(texto);
    const total = extrairValorTotalItau(texto);

    if (!venc) avisos.push("Vencimento Itaú não detectado — informe manualmente se necessário.");

    const texto1L = texto.replace(/\s+/g, " ");
    const anoVenc = venc ? parseInt(venc.slice(0, 4), 10) : undefined;
    const mesVenc = venc ? parseInt(venc.slice(5, 7), 10) : undefined;

    const lancamentos: ParsedLinha[] = [];
    const idxInicio = texto1L.search(RE_INICIO_LANCAMENTOS);

    if (idxInicio < 0) {
      avisos.push("Seção de lançamentos Itaú não encontrada — formato pode ter mudado.");
    } else {
      const idxFimRel = encontrarPrimeiro(texto1L.slice(idxInicio), REGEXS_FIM);
      const idxFim = idxFimRel >= 0 ? idxInicio + idxFimRel : texto1L.length;
      const trecho = texto1L.slice(idxInicio, idxFim);

      for (const m of trecho.matchAll(RE_ITAU_TX)) {
        const [, dia, mes, descRaw, sinal, valorRaw] = m;
        const desc = descRaw.trim();
        if (desc.length < 3) continue;
        if (DESC_PROIBIDA.test(desc)) continue;

        const data_compra = parseDataBR(`${dia}/${mes}`, anoVenc, mesVenc);
        const valor       = parseValorBR(valorRaw);
        if (!data_compra || !Number.isFinite(valor) || valor <= 0) continue;

        const tipo = (sinal === "−" || sinal === "-") ? "RECEITA" as const : "DESPESA" as const;
        const parc = detectarParcelas(desc);
        const estabelecimento = desc.split(/\s+-\s+/)[0] ?? desc;

        lancamentos.push({
          data_compra,
          descricao:       desc,
          estabelecimento,
          valor,
          parcela_atual:   parc?.atual ?? null,
          parcela_total:   parc?.total ?? null,
          tipo,
        });
      }
    }

    if (lancamentos.length === 0) {
      avisos.push("Parser Itaú não encontrou lançamentos — formato pode ter mudado.");
    }

    return {
      emissor:           "itau",
      vencimento_fatura: venc,
      valor_total:       total,
      lancamentos,
      avisos,
    };
  },
};
