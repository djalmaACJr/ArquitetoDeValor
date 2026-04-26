// SISTEMA DE VERSÃO - Backend
// Mantido sincronizado com o frontend (mesma versão do arquivo raiz)

export const BACKEND_VERSION = "1.0.3"

export const getVersionInfo = () => ({
  version: BACKEND_VERSION,
  levels: {
    major: "Novas features",
    minor: "Correções/Hotfixes",
    patch: "Tentativas"
  },
  current: {
    level: "minor",
    description: "Correções em edição de recorrências e rolagem automática"
  }
})

export default BACKEND_VERSION
