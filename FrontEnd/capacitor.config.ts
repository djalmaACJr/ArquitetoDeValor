import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.arquitetodevalor.app',
  appName: 'Arquiteto de Valor',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    CapacitorUpdater: {
      updateUrl: 'https://ftpelncgrakpphytfrfo.supabase.co/functions/v1/app_updates',
      statsUrl: '',
      autoUpdate: 'atBackground',
      publicKey: '-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEA04yksziEcyD3mBSyXnvxLUY8pauD3ZvPil3PxcDQEQ01uT+qXmjg\n1kyebhDWZcT6+JuQmAzH7ComfaXoFZ2Fx78RwxQW3NMVk76bZVASbTqIEjNzPrOq\nFNK4uG9IcvT3ObLZjZZq4sklkarrzGKZamnfhIQFI72aWNPK0bZ1QiayheXfmFNv\nWUGNMTBeQ8cRlKfvnYHexMmNY7i6D2OWZ/LLzawZ8Lgz1Z8dukzniaGDDDpN/sb7\n2rXkW6AB/cAjRriA75xxIZ2rAucYju5xA6R4JnEbtyXHFt0WNI4PPA+PJ4rFPbyx\nBaFEBREJqRZlSRjvIFWX+jiZIFAWJYiBBwIDAQAB\n-----END RSA PUBLIC KEY-----\n'
    }
  }
};

export default config;
