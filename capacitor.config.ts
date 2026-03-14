import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.animebbg.app',
  appName: 'AnimeBBG',
  webDir: 'out',
  server: {
    url: 'https://www.sistema-gestorbbg.linkpc.net',
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
