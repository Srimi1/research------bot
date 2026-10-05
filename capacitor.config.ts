import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.researchbot.android',
  appName: 'Research Bot',
  webDir: 'dist',
  android: {
    // The app talks to the network only through the native plugin, never through mixed content.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    // Native HTTP is done by ResearchNative (streaming, limits); keep the WebView's own fetch untouched.
    CapacitorHttp: { enabled: false },
  },
};

export default config;
