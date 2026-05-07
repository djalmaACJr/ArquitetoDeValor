import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from './Sidebar'
import { prefetchLancamentosVizinhos } from '../../hooks/useLancamentos'

export default function AppLayout() {
  const qc = useQueryClient()

  // Pré-aquece o cache dos meses vizinhos ao mês atual logo após o login,
  // antes mesmo do usuário navegar para a tela de Lançamentos.
  useEffect(() => {
    const mes = new Date().toISOString().slice(0, 7)
    prefetchLancamentosVizinhos(qc, mes)
  }, [qc])

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
