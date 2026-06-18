import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config for the native iOS/Android builds of JF Effect.
 *
 * `webDir` points at the built TanStack Start client bundle; the native
 * shells load that bundle locally and use Lovable Cloud for all data calls.
 * `server.url` is intentionally absent — native builds must not point at
 * a remote URL or Apple/Google review will reject the binary as a web wrapper.
 */
const config: CapacitorConfig = {
  appId: "com.jaredjamesfit.jfeffect",
  appName: "JF Effect",
  webDir: "dist",
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
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
  },
};

export default config;