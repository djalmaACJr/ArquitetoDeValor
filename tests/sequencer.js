// Ordem determinística das suítes Jest: por nome do arquivo (01_ … 13_).
//
// O sequenciador padrão do Jest, sem cache de execuções anteriores (CI), ordena por
// TAMANHO do arquivo — maior primeiro. Com a 13_agregados (a maior), ela passou a rodar
// ANTES de todas e a consumir cedo o orçamento de CPU "burst" do compute compartilhado do
// Supabase; 12_investimentos e 11_objetivos, que rodam depois, estouravam timeout (achado
// out/2026: CA-INV26 e os hooks de 11_objetivos). Ordem por nome roda as suítes leves
// primeiro e deixa as mais pesadas para o fim, sempre na mesma sequência.
const Sequencer = require('@jest/test-sequencer').default;

class SequenciadorPorNome extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => a.path.localeCompare(b.path));
  }
}

module.exports = SequenciadorPorNome;
