import { HelpCircle } from 'lucide-react'
import { APP_VERSION, getVersionInfo } from '../../config/version'

/**
 * Botão de versão na sidebar — clicar abre o tutorial da página atual.
 * Acumula duas funções: mostrar versão + atalho pro tour. Hover mostra
 * a descrição da versão e dica de F1.
 */
export default function AppVersion() {
  const versionInfo = getVersionInfo()
  const desc = versionInfo.levels[versionInfo.current.level as keyof typeof versionInfo.levels]

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('av-abrir-tutorial'))}
      title={`${desc}: ${versionInfo.current.description}\n\nClique pra abrir o tutorial desta página (atalho: F1)`}
      aria-label="Abrir tutorial da página"
      className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded px-2 py-1 border border-gray-200 dark:border-gray-700 transition-colors hover:text-av-blue hover:border-av-blue/40"
    >
      <HelpCircle size={11}/>
      <span>versão {APP_VERSION}</span>
    </button>
  )
}
