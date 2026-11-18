// Testes da classificação pura de alertasFii.ts — rode com:
//   deno test --node-modules-dir=auto --allow-env --allow-net=none alertasFii.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { classificarAlertaFii } from "./alertasFii.ts";

Deno.test("liquidação do fundo é alerta; liquidação financeira de oferta não", () => {
  assertEquals(classificarAlertaFii("Comunicado sobre a Liquidação do Fundo e entrega de cotas"), "LIQUIDACAO");
  assertEquals(classificarAlertaFii("Aprovada a dissolução e liquidação do fundo em assembleia"), "LIQUIDACAO");
  assertEquals(classificarAlertaFii("Liquidação financeira da oferta pública da 5ª emissão de cotas"), null);
  assertEquals(classificarAlertaFii("Anúncio de encerramento da oferta — liquidação da emissão"), null);
});

Deno.test("incorporação / fusão / cisão", () => {
  assertEquals(classificarAlertaFii("Proposta de incorporação do FII X pelo FII Y"), "INCORPORACAO");
  assertEquals(classificarAlertaFii("Fusão entre fundos imobiliários"), "INCORPORACAO");
});

Deno.test("transformação e troca de código", () => {
  assertEquals(classificarAlertaFii("Transformação do fundo em FIAGRO"), "TRANSFORMACAO");
  assertEquals(classificarAlertaFii("Novo código de negociação das cotas"), "TROCA_CODIGO");
});

Deno.test("texto comum ou vazio não gera alerta", () => {
  assertEquals(classificarAlertaFii("Convocação de assembleia geral ordinária — aprovação de contas"), null);
  assertEquals(classificarAlertaFii("Divulgação de rendimentos"), null);
  assertEquals(classificarAlertaFii(null), null);
  assertEquals(classificarAlertaFii(""), null);
});
