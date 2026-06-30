// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load all env vars (no prefix) into process.env so server routes can read
// non-VITE_ secrets like SUPABASE_SERVICE_ROLE_KEY and LOVABLE_API_KEY during dev/build.
// VITE_-prefixed vars are still injected separately by the base config.
const serverEnv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    build: {
      sourcemap: false,
      // Raise the warning threshold — large admin pages are expected.
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
          warn(warning);
        },
        onLog(level, log, handler) {
          if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
          handler(level, log);
        },
      },
    },
    resolve: {
      alias: {
        // React Email pulls in htmlparser2 → entities. Force the hoisted v4.5.0
        // copy so nested v5+ copies (which removed ./lib/decode.js) don't break SSR.
        "entities/lib/decode.js": path.resolve(__dirname, "node_modules/entities/lib/decode.js"),
        "entities/lib/encode.js": path.resolve(__dirname, "node_modules/entities/lib/encode.js"),
        entities: path.resolve(__dirname, "node_modules/entities"),
      },
    },
    plugins: [
      VitePWA({
        // Manifest is hand-managed in public/manifest.json; only generate the SW here.
        registerType: "autoUpdate",
        injectRegister: null, // the guarded wrapper is the only registrar
        filename: "sw.js",
        strategies: "generateSW",
        manifest: false,
        devOptions: { enabled: false },
        workbox: {
          navigateFallback: "/",
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Pull in our Web Push handlers (push, notificationclick,
          // pushsubscriptionchange) inside the same SW Workbox generates.
          // This keeps us at ONE service worker for offline + push.
          importScripts: ["/push-sw.js"],
          navigateFallbackDenylist: [
            /^\/~oauth/,         // Supabase OAuth callback — must hit network
            /^\/api\//,
            /^\/_serverFn\//,
            /^\/_server\//,
          ],
          cleanupOutdatedCaches: true,
          // skipWaiting:true activates new SW versions immediately on next navigate
          // instead of waiting for all tabs to close. This prevents the "blank screen
          // after deploy" scenario where the old SW serves stale HTML that references
          // chunks that no longer exist on the CDN.
          skipWaiting: true,
          clientsClaim: true,
          // Precache only the app shell: index.html, manifest, and the icon set
          // shipped from /public. JS/CSS chunks and other assets are cached
          // lazily on first use by the runtimeCaching rules below. This keeps
          // the SW install fast (was ~395 files; now <10) and prevents stale
          // chunks from pinning users to old builds.
          globPatterns: [
            "index.html",
            "manifest.json",
            "favicon.ico",
            "favicon-32.png",
            "apple-touch-icon.png",
            "icon-192.png",
            "icon-512.png",
            "icon-1024.png",
            "icon-maskable-192.png",
            "icon-maskable-512.png",
          ],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
              cacheName: "jf-html-v2",
                // 3s timeout: on slow mobile connections, fall back to the cached
                // HTML faster so the app shell appears immediately.
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            {
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && /\/assets\/.+\.[0-9a-f]{6,}\..+$/i.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "jf-assets-v2",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && /\.(?:png|jpg|jpeg|webp|svg|gif|ico)$/i.test(url.pathname),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "jf-images-v2",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
