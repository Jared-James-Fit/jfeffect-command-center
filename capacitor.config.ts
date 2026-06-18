import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config for the native iOS/Android builds of JF Effect.
 *
 * The native shell loads the production website via server.url.
 * This is the correct approach for TanStack Start (SSR) projects.
 */
const config: CapacitorConfig = {
  appId: "com.jfeffect.app",
  appName: "JF Effect",
  webDir: "dist",
  server: {
    url: "https://jfeffect.com",
    cleartext: false,
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
    allowsLinkPreview: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0B0B0F",
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#0B0B0F",
      showSpinner: false,
    },
  },
};

export default config;
