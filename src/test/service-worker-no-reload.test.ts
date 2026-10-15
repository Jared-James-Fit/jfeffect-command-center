import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// After a run of publishes the app opened to a blank white screen: each new
// worker navigated every open window on activation, the page reloaded itself on
// the same switch, and the worker answered page loads (navigateFallback). With
// the worker blocked the same page loaded fine.
describe("the service worker never holds a page load or reloads the app", () => {
  it("never answers a page load: every page comes from the site", () => {
    const config = read("vite.config.ts");
    // null, not left out: the plugin's default is "index.html", which isn't precached (Workbox threw on every start)
    expect(config).toMatch(/^\s*navigateFallback: null,$/m);
    expect(config).not.toMatch(/navigateFallback: ["']/);
    expect(config).not.toContain("navigateFallbackDenylist");
    // HTML, JS and CSS stay out of the worker's caches
    expect(config).toContain("handler: \"StaleWhileRevalidate\"");
    expect(config).toContain('options: { cacheName: "jf-app-icons" }');
  });

  it("taking over open pages doesn't navigate or reload them", () => {
    const push = read("public/push-sw.js");
    const activate = push.slice(push.indexOf("self.addEventListener('activate'"), push.indexOf("self.addEventListener('push'"));
    expect(activate).toContain("self.clients.claim()");
    expect(activate).not.toContain("navigate(");
    expect(activate).not.toContain("reload");
    // push still works the same way
    expect(push).toContain("self.addEventListener('push'");
    expect(push).toContain("self.addEventListener('notificationclick'");
  });

  it("the page doesn't reload itself when a new worker takes over; new builds are app-freshness's job", () => {
    const reg = read("src/lib/pwa/register-sw.ts");
    expect(reg).not.toContain("controllerchange");
    // the plugin's autoUpdate reloads on its own unless it's handed onNeedReload
    expect(reg).toContain("onNeedReload() {},");
    expect(reg).toContain("app-freshness.ts");
  });

  it("every installed worker updates to this one (the imported handlers' version changed)", () => {
    expect(read("vite.config.ts")).toContain('importScripts: ["/push-sw.js?v=20261015-no-reload"]');
  });
});
