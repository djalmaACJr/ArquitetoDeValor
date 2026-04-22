import { APP_VERSION, getVersionInfo } from '../../config/version'

export default function AppVersion() {
  const versionInfo = getVersionInfo()
  
  return (
    <div 
      className="text-xs text-center text-gray-500 dark:text-gray-400 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded px-2 py-1 border border-gray-200 dark:border-gray-700 cursor-help"
      title={`${versionInfo.levels[versionInfo.current.level]}: ${versionInfo.current.description}`}
    >
      versão {APP_VERSION}
    </div>
  )
}
