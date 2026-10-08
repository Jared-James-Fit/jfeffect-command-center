/**
 * Unique per production build (vite `define`). The client and server bundles
 * of one build carry the same value, so comparing them tells a running app
 * whether a newer version has been published since it loaded.
 */
declare const __APP_BUILD_ID__: string;
