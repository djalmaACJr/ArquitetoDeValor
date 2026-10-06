// src/components/ui/GuardaModuloAgregado.tsx
//
// Rede de segurança: o menu já oculta os módulos não liberados (Sidebar), mas
// quem digita a URL direto cai aqui, com um aviso em vez de página vazia/403.
// É só UX — quem barra de verdade é o backend/RLS (fn_agregado_tem_acesso).
//

import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Lock, Info } from 'lucide-react'
import { useEspacoAtivo } from '../../hooks/useEspacoAtivo'
import { useContas } from '../../hooks/useContas'
import { useModulosLiberados } from '../../hooks/useModulosLiberados'
import type { ModuloAgregado } from '../../hooks/useAgregados'

const NOME_MODULO: Record<ModuloAgregado, string> = {
  EXTRATO: 'Extrato (contas e lançamentos)',
  OBJETIVOS: 'Objetivos',
  INVESTIMENTOS: 'Investimentos',
}

function moduloDaRota(pathname: string): ModuloAgregado | null {
  if (pathname === '/' || /^\/(lancamentos|relatorios|comparativo|assinaturas|projecao)(\/|$)/.test(pathname)) return 'EXTRATO'
  if (/^\/objetivos(\/|$)/.test(pathname)) return 'OBJETIVOS'
  if (/^\/investimentos(\/|$)/.test(pathname)) return 'INVESTIMENTOS'
  return null
}

export default function GuardaModuloAgregado({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { vinculo } = useEspacoAtivo()
  const liberados = useModulosLiberados()
  const { contas, loading: carregandoContas } = useContas()

  const modulo = moduloDaRota(pathname)
  if (!vinculo || !modulo) return <>{children}</>

  if (liberados?.has(modulo)) {
    return (
      <>
        <div className="flex items-start gap-2 px-4 py-2.5 text-[13px] border-b border-white/10"
          style={{ background: 'rgba(240,180,41,0.08)', color: '#e8c76a' }}>
          <Info size={15} className="shrink-0 mt-0.5" />
          <span>
            Você está vendo a conta de <strong>{vinculo.dono_nome || 'outro usuário'}</strong>.
            {' '}Só aparecem {carregandoContas ? 'as contas compartilhadas' : `as ${contas.length} conta(s) compartilhada(s) com você`}
            {' '}— as demais contas dele <strong>não foram compartilhadas</strong> e não entram em saldos, extratos ou relatórios.
          </span>
        </div>
        {children}
      </>
    )
  }

  return (
    <div className="p-6 max-w-xl mx-auto mt-10 text-center">
      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
        <Lock size={20} className="text-white/50" />
      </div>
      <h1 className="text-[18px] font-semibold text-white mb-2">Acesso não liberado</h1>
      <p className="text-[14px]" style={{ color: '#8b92a8' }}>
        {vinculo.dono_nome ? `${vinculo.dono_nome} ` : 'O dono desta conta '}
        não liberou o módulo <strong className="text-white/80">{NOME_MODULO[modulo]}</strong> para você.
        Peça a liberação em Compartilhamento, ou volte para "Meus dados" no seletor de espaço.
      </p>
    </div>
  )
}
