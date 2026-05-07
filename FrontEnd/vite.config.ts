import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Nota: em Vite 8 (Rolldown), a opção `esbuild.drop` só afeta o dev server.
// Para strip de logs em produção, usamos `lib/logger.ts` com check de
// `import.meta.env.DEV` que é tree-shaken pelo bundler.
export default defineConfig({
  plugins: [react()],
})
