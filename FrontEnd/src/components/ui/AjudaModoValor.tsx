import BotaoAjuda from './BotaoAjuda'

/** "?" do seletor Valores | % da receita | Corrigido IPCA (Comparativo e Progressão). */
export default function AjudaModoValor({ unidade }: { unidade: 'período' | 'ano' }) {
  return (
    <BotaoAjuda titulo="Como exibir os valores">
      <p>
        Comparar {unidade === 'ano' ? 'anos' : 'períodos'} distantes em reais puros engana: a inflação
        faz o mesmo gasto parecer maior hoje. Estes modos corrigem isso:
      </p>
      <p><b style={{ color: '#e8eaf0' }}>Valores</b> — os números como foram lançados (nominais).</p>
      <p>
        <b style={{ color: '#e8eaf0' }}>% da receita</b> — cada categoria vira a fatia da receita total do
        próprio {unidade}. Em despesas: "de cada R$ 100 que ganhei, quanto foi para este item".
        Em receitas: a composição da renda (quanto veio de cada fonte). As diferenças saem em
        pontos percentuais (pp). Não depende de índice nenhum.
      </p>
      <p>
        <b style={{ color: '#e8eaf0' }}>Corrigido IPCA</b> — todos os valores são levados para os preços
        da última competência publicada. Receita e despesa passam a ser comparáveis em poder de compra.
        O IPCA está disponível a partir de jan/2006; lançamentos anteriores ficam sem correção.
      </p>
    </BotaoAjuda>
  )
}
