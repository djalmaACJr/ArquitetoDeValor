import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Domínio financeiro raramente muda fora da ação do usuário —
      // refetch em foco/reconexão é desnecessário e custoso (loga ruído na rede).
      // Mutations invalidam explicitamente o que precisa.
      refetchOnWindowFocus: false,
      refetchOnReconnect:   false,
      retry:                1,
      staleTime:            30_000, // 30s — dedup de fetch entre telas próximas
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App/>
    </QueryClientProvider>
  </React.StrictMode>
)
