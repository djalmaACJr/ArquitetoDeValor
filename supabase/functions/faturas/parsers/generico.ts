// supabase/functions/faturas/parsers/generico.ts
//
// Parser genérico de fatura — usado quando nenhum emissor específico é
// reconhecido pelo cabeçalho. Procura padrões comuns:
//
//   <DD/MM[/YYYY]> <descrição livre> <R$? valor>
//
// É o "best effort" — pode capturar linhas que não são lançamento (ex.:
// "Crédito de R$ 50,00 em 03/02") mas a sandbox permite o usuário
// ignorar antes de confirmar. Cada item duvidoso é melhor que perder.
//
// Reconhecimento de parcela: helper detectarParcelas() roda na descrição.

import {
  parseValorBR, parseDataBR, detectarParcelas,
  extrairVencimento, extrairValorTotal, normalizarLinhas,
} from "./helpers.ts";
import type { ParserFatura, ParsedFatura, ParsedLinha } from "./tipos.ts";

// Linha de lançamento típica:
//   "03/02  UBER *TRIP HELP.UBER.COM           R$ 24,90"
// Permite valor sem R$ e com sinal negativo (estornos).
//
// Estratégia: separa em 3 grupos via greedy/non-greedy:
//   ^DATA  ⟨ DESC ⟩  VALOR$
// onde VALOR sempre fecha a linha.
const RE_LINHA = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+(-?\s*R?\$?\s*[\d.]+,\d{2})\s*$/;

function inferirAnoMesFatura(texto: string): { ano?: number; mes?: number } {
  // Procura datas YYYY-MM ou DD/MM/YYYY no cabeçalho para inferir competência.
  const m1 = texto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) return { ano: parseInt(m1[3], 10), mes: parseInt(m1[2], 10) };
  return {};
}

export const parserGenerico: ParserFatura = {
  id: "generico",

  detectar(_texto: string): boolean {
    // Fallback — só é escolhido se nenhum parser específico aceitar primeiro.
    return true;
  },

  parsear(texto: string): ParsedFatura {
    const avisos: string[] = [];
    const venc  = extrairVencimento(texto);
    const total = extrairValorTotal(texto);
    if (!venc)  avisos.push("Vencimento não detectado — preencha manualmente se necessário.");
    if (!total) avisos.push("Valor total não detectado.");

    const { ano, mes } = inferirAnoMesFatura(texto);
    const lancamentos: ParsedLinha[] = [];

    for (const linha of normalizarLinhas(texto)) {
      const m = linha.match(RE_LINHA);
      if (!m) continue;

      const [, dataRaw, descRaw, valorRaw] = m;
      const data_compra = parseDataBR(dataRaw, ano, mes);
      const valor       = parseValorBR(valorRaw);
      if (!data_compra || !Number.isFinite(valor)) continue;

      // Estornos/créditos: valor negativo na fatura → ignoramos no parser
      // genérico (sandbox ainda permite criar manualmente se for o caso).
      if (valor <= 0) continue;

      const parc = detectarParcelas(descRaw);

      lancamentos.push({
        data_compra,
        descricao:    descRaw.trim(),
        estabelecimento: descRaw.trim().split(/\s{2,}|\s-\s/).at(0) ?? null,
        valor,
        parcela_atual: parc?.atual ?? null,
        parcela_total: parc?.total ?? null,
      });
    }

    if (lancamentos.length === 0) {
      avisos.push("Nenhuma linha reconhecida como lançamento. Pode ser PDF escaneado (sem texto) ou layout não suportado.");
    }

    return {
      emissor:           "generico",
      vencimento_fatura: venc,
      valor_total:       total,
      lancamentos,
      avisos,
    };
  },
};
