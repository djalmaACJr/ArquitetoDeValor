// SISTEMA DE VERSÃO CENTRALIZADO - ÚNICO FONTE DA VERDADE
//
// FORMATO: X.Y.Z
// 1º nível (X): Novas features (ex: 1.0.0, 2.0.0)
// 2º nível (Y): Correções/Hotfixes (ex: 1.0.0, 1.1.0, 1.2.0) 
// 3º nível (Z): Tentativas (ex: 1.1.1, 1.1.2)

export const APP_VERSION = "6.4.0"

export const getVersionInfo = () => ({
  version: APP_VERSION,
  levels: {
    major: "Novas features",
    minor: "Correções/Hotfixes",
    patch: "Tentativas"
  },
  current: {
    level: "minor",
    description: "Fundamentos de Ações (LPA/VPA/Valor Justo) via CVM, questionário de avaliação por categoria de FII, aviso de Data COM de proventos, Proteção do Poder de Compra em FIIs e sessão mais segura em múltiplas abas"
  }
})

export default APP_VERSION
