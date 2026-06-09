// supabase/functions/faturas/parsers/mercadopago.ts
//
// Parser para faturas do Mercado Pago (cartão de crédito).
//
// O PDF do Mercado Pago é extraído pelo unpdf como um fluxo contínuo
// de texto SEM quebras de linha entre as transações — por isso o parser
// genérico (linha a linha) não encontra nada.
//
// Estratégia:
//   1. Detectar pela presença de "Mercado Pago" no texto.
//   2. Cortar o texto a partir de "Movimentações na fatura".
//   3. Aplicar regex global (não linha a linha) para capturar blocos
//      no formato:  DD/MM  <descrição>  R$  valor
//      usando lookahead negativo  (?!\/\d{2,4})  para ignorar datas
//      completas (08/06/2026) que o PDF inclui em seções de resumo.
//   4. Excluir pagamentos de fatura e linhas de total.
//   5. Detectar parcelas via helper (ex.: "Parcela 4 de 10" → 4/10).

import {
  parseValorBR, parseDataBR, detectarParcelas,
  extrairVencimento, extrairValorTotal,
} from "./helpers.ts";
import type { ParserFatura, ParsedFatura, ParsedLinha } from "./tipos.ts";

// DD/MM seguido de descrição e depois R$ valor.
// O lookahead (?!\/\d{2,4}) evita capturar "08/06" dentro de "08/06/2026".
const RE_TX = /\b(\d{2}\/\d{2})(?!\/\d{2,4})\s+(.+?)\s+R\$\s*([\d.]+,\d{2})/g;

// Padrões a ignorar: pagamento da fatura, linha de total de seção.
const RE_IGNORAR = /^(pagamento\s+da\s+fatura|pagamento\s+recebido|total\b)/i;

export const parserMercadoPago: ParserFatura = {
  id: "mercadopago",

  detectar(texto: string): boolean {
    const t = texto.toLowerCase();
    return t.includes("mercado pago") || t.includes("mercadopago");
  },

  parsear(texto: string): ParsedFatura {
    const avisos: string[] = [];
    const venc  = extrairVencimento(texto);
    const total = extrairValorTotal(texto);
    if (!venc)  avisos.push("Vencimento não detectado — preencha manualmente.");
    if (!total) avisos.push("Valor total não detectado.");

    // Inferir competência da fatura a partir do vencimento
    const mVenc = texto.match(/vence\s+em\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    const anoFatura = mVenc ? parseInt(mVenc[3], 10) : new Date().getFullYear();
    const mesFatura = mVenc ? parseInt(mVenc[2], 10) : new Date().getMonth() + 1;

    // Detectar número do cartão (ex.: "************5408")
    const mCartao = texto.match(/\[(\*+\d{4})\]/);
    const cartaoInfo = mCartao ? `Cartão final ${mCartao[1].replace(/\*/g, '').trim()}` : null;

    // Cortar o texto a partir da seção de movimentações para evitar
    // falsos positivos em datas do cabeçalho e rodapé da fatura.
    const idxMov = texto.search(/movimenta[çc][õo]es\s+na\s+fatura/i);
    const textoTx = idxMov >= 0 ? texto.slice(idxMov) : texto;

    const lancamentos: ParsedLinha[] = [];
    let m: RegExpExecArray | null;

    RE_TX.lastIndex = 0;
    while ((m = RE_TX.exec(textoTx)) !== null) {
      const [, dataRaw, descRaw, valorRaw] = m;
      const desc = descRaw.trim();

      if (RE_IGNORAR.test(desc)) continue;

      const data_compra = parseDataBR(dataRaw, anoFatura, mesFatura);
      const valor = parseValorBR(valorRaw);
      if (!data_compra || !Number.isFinite(valor) || valor <= 0) continue;

      const parc = detectarParcelas(desc);

      lancamentos.push({
        data_compra,
        descricao:       desc,
        estabelecimento: desc.split(/\s*\*\s*|\s{2,}/).at(0) ?? null,
        valor,
        parcela_atual:   parc?.atual ?? null,
        parcela_total:   parc?.total ?? null,
        observacao:      cartaoInfo,
      });
    }

    if (lancamentos.length === 0) {
      avisos.push("Nenhuma transação reconhecida — layout pode ter mudado ou o PDF usa imagem escaneada.");
    }

    return {
      emissor:           "mercadopago",
      vencimento_fatura: venc,
      valor_total:       total,
      lancamentos,
      avisos,
    };
  },
};
