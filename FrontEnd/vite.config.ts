import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Nota: em Vite 8 (Rolldown), a opção `esbuild.drop` só afeta o dev server.
// Para strip de logs em produção, usamos `lib/logger.ts` com check de
// `import.meta.env.DEV` que é tree-shaken pelo bundler.
export default defineConfig({
  plugins: [react()],
  // Força bind em IPv4 — em algumas máquinas Windows, 'localhost' resolve
  // só pra `::1` (Vite default), e um client (ex. Firefox do Playwright)
  // que tente `127.0.0.1` primeiro fica preso num SYN_SENT indefinido em
  // vez de cair pro IPv6 (falha de "happy eyeballs"). Achado ago/2026 ao
  // depurar hangs intermitentes no E2E (04_extrato EX10-12).
  server: {
    host: '127.0.0.1',
    // Ignora os diretórios de artefato do Playwright (screenshots, traces,
    // relatório HTML) — sem isso, qualquer teste E2E escrevendo em
    // `test-results/`/`e2e/report/` enquanto o dev server do e2e roda
    // dispara HMR/full-reload no meio do teste, derrubando silenciosamente
    // (sem erro de JS) o estado da página — achado real depurando um
    // fechamento espúrio do drawer de edição em E2E-EX10/11/12 (ago/2026).
    watch: { ignored: ['**/test-results/**', '**/e2e/report/**', '**/playwright-report/**'] },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('exceljs')) return 'exceljs';
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('chart.js')) return 'charts';
            return 'vendor';
          }
        },
      },
    },
  },
})
