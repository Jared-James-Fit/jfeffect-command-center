import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DARK_DEFAULT_SINCE, THEMED_PATH_RE, THEME_BOOT_SCRIPT, THEME_DEFAULT_KEY, THEME_STORAGE_KEY,
  defaultPreferenceFor, isPreference, resolveTheme,
} from "@/lib/theme";

/** Runs the real inline boot script against a fake page, the way a browser would before first paint. */
function boot(opts: { stored?: string; def?: string; session?: { created_at?: string }; path?: string; systemDark?: boolean }) {
  const store = new Map<string, string>();
  if (opts.stored) store.set(THEME_STORAGE_KEY, opts.stored);
  if (opts.def) store.set(THEME_DEFAULT_KEY, opts.def);
  if (opts.session) store.set("sb-abc-auth-token", JSON.stringify({ user: opts.session }));
  const classes = new Set<string>();
  const meta = { v: "", setAttribute: (_: string, v: string) => { meta.v = v; } };
  const root = { classList: { add: (c: string) => classes.add(c) }, style: {} as Record<string, string> };
  const ls = {
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  new Function("localStorage", "document", "location", "window", THEME_BOOT_SCRIPT)(
    ls,
    { documentElement: root, querySelectorAll: () => [meta] },
    { pathname: opts.path ?? "/portal" },
    { matchMedia: () => ({ matches: !!opts.systemDark }) },
  );
  return { dark: classes.has("dark"), scheme: root.style.colorScheme, color: meta.v, store };
}

describe("appearance: Light, Dark, System", () => {
  it("themes the signed-in app and its sign-in flows; marketing pages stay light", () => {
    for (const p of ["/portal", "/portal/progress", "/admin/clients", "/m", "/coach/x", "/notifications", "/finance", "/finance/revenue", "/challenges", "/challenges/winnipeg-225", "/athletes/jared", "/auth", "/recover", "/reset-password", "/setup", "/staff-setup", "/member-setup", "/activate", "/welcome"]) expect(THEMED_PATH_RE.test(p)).toBe(true);
    for (const p of ["/", "/membership", "/selkirk", "/media-kit", "/my", "/financial-literacy", "/challenge", "/coaching", "/about", "/join", "/authority", "/setups"]) expect(THEMED_PATH_RE.test(p)).toBe(false);
  });

  it("knows the three preferences", () => {
    for (const v of ["light", "dark", "system"]) expect(isPreference(v)).toBe(true);
    for (const v of ["auto", "", null, undefined, 1]) expect(isPreference(v)).toBe(false);
  });

  it("System follows the device; a public page is always light", () => {
    expect(resolveTheme("system", { systemDark: true, pathname: "/portal" })).toBe("dark");
    expect(resolveTheme("system", { systemDark: false, pathname: "/portal" })).toBe("light");
    expect(resolveTheme("dark", { systemDark: false, pathname: "/portal" })).toBe("dark");
    expect(resolveTheme("light", { systemDark: true, pathname: "/portal" })).toBe("light");
    expect(resolveTheme("dark", { systemDark: true, pathname: "/coaching" })).toBe("light");
  });

  it("new accounts start in dark; accounts made before keep light; an unknown age never flips anyone", () => {
    expect(defaultPreferenceFor("2026-11-24T23:59:00Z")).toBe("light");
    expect(defaultPreferenceFor("2025-01-01T00:00:00Z")).toBe("light");
    expect(defaultPreferenceFor(DARK_DEFAULT_SINCE)).toBe("dark");
    expect(defaultPreferenceFor("2026-12-01T00:00:00Z")).toBe("dark");
    expect(defaultPreferenceFor(undefined)).toBe("light");
    expect(defaultPreferenceFor("garbage")).toBe("light");
  });

  describe("the boot script paints the right theme on the very first frame", () => {
    it("a first-time visitor in the app's pages gets dark", () => {
      const r = boot({ path: "/auth" });
      expect(r.dark).toBe(true);
      expect(r.scheme).toBe("dark");
      expect(r.color).toBe("#0d0d0f");
    });

    it("a first-time visitor on a marketing page gets light", () => {
      const r = boot({ path: "/" });
      expect(r.dark).toBe(false);
      expect(r.scheme).toBe("light");
    });

    it("an existing account that never chose keeps light (and the device remembers it)", () => {
      const r = boot({ session: { created_at: "2026-09-01T10:00:00Z" } });
      expect(r.dark).toBe(false);
      expect(r.store.get(THEME_DEFAULT_KEY)).toBe("light");
      // signed out later: the device still opens light
      expect(boot({ def: "light" }).dark).toBe(false);
    });

    it("a new account that never chose gets dark", () => {
      expect(boot({ session: { created_at: "2026-12-02T10:00:00Z" } }).dark).toBe(true);
    });

    it("a saved session with no date never flips anyone to dark", () => {
      expect(boot({ session: {} }).dark).toBe(false);
    });

    it("an explicit choice always wins over the default", () => {
      expect(boot({ stored: "dark", session: { created_at: "2025-01-01T00:00:00Z" } }).dark).toBe(true);
      expect(boot({ stored: "light", session: { created_at: "2026-12-02T10:00:00Z" } }).dark).toBe(false);
    });

    it("System follows the device's setting", () => {
      expect(boot({ stored: "system", systemDark: true }).dark).toBe(true);
      expect(boot({ stored: "system", systemDark: false }).dark).toBe(false);
    });

    it("an unreadable choice is ignored", () => {
      expect(boot({ stored: "banana" }).dark).toBe(true);
    });
  });

  it("boot script reads the same keys and path rule as the runtime", () => {
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_BOOT_SCRIPT).toContain(THEMED_PATH_RE.toString());
    expect(THEME_BOOT_SCRIPT).toContain(String(Date.parse(DARK_DEFAULT_SINCE)));
  });

  it("ships the generated dark palette and never overrides an explicit dark: class", () => {
    const css = readFileSync("src/styles/dark-palette.css", "utf8");
    expect(readFileSync("src/styles.css", "utf8")).toContain('@import "./styles/dark-palette.css"');
    expect(css).toMatch(/\.dark \.bg-amber-50:not\(\[class\*="dark:bg-"\]\)/);
    expect(css).toMatch(/\.dark \.text-emerald-700:not\(\[class\*="dark:text-"\]\)/);
  });

  it("appearance is chosen once, in Account, and nowhere else", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(shell).not.toContain("ThemeToggle");
    expect(shell).not.toContain("theme-toggle");
    expect(readFileSync("src/routes/_authenticated/portal/account.tsx", "utf8")).toContain("<AppearanceSection />");
    expect(readFileSync("src/routes/_authenticated/admin/account.tsx", "utf8")).toContain("<AppearanceSection />");
    const picker = readFileSync("src/components/appearance-section.tsx", "utf8");
    for (const v of ['"light"', '"dark"', '"system"']) expect(picker).toContain(v);
  });

  it("the toaster and the native status bar follow the painted theme", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).toContain("theme={toastTheme}");
    expect(root).not.toContain('theme="dark" richColors');
    expect(root).toContain("syncNativeChrome(paintedTheme)");
    expect(readFileSync("src/platform/native-init.ts", "utf8")).toContain("Style.Light");
  });

  it("the account copy accepts System and nothing is rewritten by the migration", () => {
    const sql = readFileSync("supabase/migrations/20270525090000_theme_system_option.sql", "utf8");
    expect(sql).toContain("check (theme in ('light', 'dark', 'system'))");
    expect(sql).not.toMatch(/\b(insert|update|delete)\b\s+(into\s+|from\s+)?public\.user_preferences/i);
  });
});
