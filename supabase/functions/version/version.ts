// SISTEMA DE VERSÃO - Backend
// Mantido sincronizado com o frontend (mesma versão do arquivo raiz)

export const BACKEND_VERSION = "1.6"

export const getVersionInfo = () => ({
  version: BACKEND_VERSION,
  levels: {
    major: "Novas features",
    minor: "Correções/Hotfixes",
    patch: "Tentativas"
  },
  current: {
    level: "minor",
    description: "Usuários agregados (convites, permissões, saída), saldo sem timeout para agregados, paginação do extrato com saldo e fechamento de vazamento da tabela usuarios"
  }
})

export default BACKEND_VERSION
