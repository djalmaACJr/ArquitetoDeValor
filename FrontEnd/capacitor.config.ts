import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.arquitetodevalor.app',
  appName: 'Arquiteto de Valor',
  webDir: 'dist',
  // 'https' evita problemas de cookie/mixed-content do WebView no Android
  // (padrão recomendado pelo Capacitor em vez do 'capacitor://' default).
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorUpdater: {
      // Edge function self-hosted (supabase/functions/app_updates) — não a
      // nuvem da Capgo, que é o default (https://plugin.capgo.app/updates).
      updateUrl: 'https://ftpelncgrakpphytfrfo.supabase.co/functions/v1/app_updates',
      // Sem telemetria pra Capgo: self-hosted é só o que já temos no Supabase.
      statsUrl: '',
      // Baixa em segundo plano a cada retomada do app e aplica na próxima vez
      // que o app for pro background — não interrompe a sessão em uso.
      autoUpdate: 'atBackground',
    },
  },
};

export default config;
