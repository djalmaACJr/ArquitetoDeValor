// SISTEMA DE VERSÃO CENTRALIZADO - ÚNICO FONTE DA VERDADE
//
// FORMATO: X.Y.Z
// 1º nível (X): Novas features (ex: 1.0.0, 2.0.0)
// 2º nível (Y): Correções/Hotfixes (ex: 1.0.0, 1.1.0, 1.2.0) 
// 3º nível (Z): Tentativas (ex: 1.1.1, 1.1.2)

export const APP_VERSION = "6.2.0"

export const getVersionInfo = () => ({
  version: APP_VERSION,
  levels: {
    major: "Novas features",
    minor: "Correções/Hotfixes",
    patch: "Tentativas"
  },
  current: {
    level: "minor",
    description: "Rosca 'Ativos por tipo' em Meus ativos; filtro de categoria com múltipla seleção e comparação por categoria (linha no gráfico + bloco na tabela) no quadro Rentabilidade dos Destaques, com realce ao passar o mouse na legenda; manutenção de ativos (atualizar tickets/padronizar Tesouro) movida para Configurações e exibida só quando necessário; 'Somente com valor' ativo por padrão em Meus ativos"
  }
})

export default APP_VERSION
