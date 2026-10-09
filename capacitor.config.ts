import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.aizeek.newsnook',
  appName: 'News Nook',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      // NewsNook already owns safe-area propagation through MainActivity.
      // Disable Capacitor's second inset/padding layer, especially on Android
      // 15+ with WebView < 140, where it pads the WebView parent itself.
      insetsHandling: 'disable',
    },
  },
}

export default config
