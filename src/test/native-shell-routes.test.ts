import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// App Review rejected build 35 (guideline 3.1.1: "subscription purchase link-out to Safari via
// account registration"). These walk every route and every client-facing link so no path in the
// iPhone app reaches a sales, pricing, checkout or billing page, and the app's chat cards, menus
// and sign-up never sell. The rules are native-purchases.ts.
const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@/platform", () => ({ isNative: () => platform.native }));

const {
  NATIVE_SHELL_BOOT_SCRIPT,
  installShellPurchaseGuard,
  isPurchaseUrl,
  isShellBlockedPath,
  joinStepsForShell,
  navForShell,
  promosForShell,
  setShellStaff,
  shellAllowsUrl,
  shellHidesPayment,
  shellRedirectFor,
} = await import("@/lib/native-purchases");
const { launchMode, LAUNCH_BOOT_SCRIPT } = await import("@/lib/landing-launch");
const { MEMBER_STEPS } = await import("@/lib/membership-apply");
const { clientNav, selfServeNav } = await import("@/lib/admin-nav");
const { PaymentRequestCard } = await import("@/components/payment-request-card");
const { AutoPaySetupCard } = await import("@/components/billing/auto-pay-setup-card");

const read = (p: string) => readFileSync(p, "utf8");

/** Every page the router knows (routeTree.gen.ts), as full paths. */
const ROUTES = [...new Set([...read("src/routeTree.gen.ts").matchAll(/fullPath: '([^']*)'/g)].map((m) => (m[1]!.length > 1 ? m[1]!.replace(/\/$/, "") : m[1]!)))];
const staffOrServer = (p: string) => /^\/(admin|coach|api|finance|lovable|email|staff-setup)(\/|$)/.test(p);

describe("every route: the iPhone app opens no sales, pricing, checkout or billing page", () => {
  it("the route list is the real one", () => {
    expect(ROUTES.length).toBeGreaterThan(100);
    expect(ROUTES).toContain("/join");
    expect(ROUTES).toContain("/coaching");
  });

  it("each sales, checkout and billing page is blocked", () => {
    const mustBlock = [
      "/coaching", "/coaching/apply", "/about", "/membership", "/apply", "/selkirk",
      "/personal-trainer-selkirk", "/personal-trainer-selkirk/apply", "/pay/$token", "/autopay/$token",
      "/m/welcome", "/portal/plan", "/portal/upgrade", "/portal/membership", "/portal/purchases",
      "/portal/purchases/$id",
    ];
    for (const p of mustBlock) {
      expect(ROUTES, `${p} is a real route`).toContain(p);
      expect(isShellBlockedPath(p), p).toBe(true);
    }
  });

  it("any client-facing route that sounds like selling is blocked, or is on the reviewed list of ones that don't sell", () => {
    const sounds = /(^|\/)(coaching|pricing|premium|checkout|pay|autopay|purchases?|membership|upgrade|plan|credits|buy|apply|selkirk|about)(\/|$)/;
    // reviewed: none of these sells, prices or links to a purchase in the app (none today)
    const reviewed = new Set<string>([]);
    const missed = ROUTES.filter((p) => !staffOrServer(p) && sounds.test(p) && !isShellBlockedPath(p) && !reviewed.has(p));
    expect(missed).toEqual([]);
  });

  it("the free sign-up, sign-in and everything a member or client uses stay open", () => {
    const mustOpen = [
      "/", "/auth", "/join", "/signup/jf", "/activate", "/recover", "/reset-password", "/welcome",
      "/member-setup", "/setup", "/privacy", "/terms", "/legal/$slug", "/delete-account",
      "/coaching-agreement", "/book/$slug", "/b/$token", "/challenges", "/portal", "/portal/account",
      "/portal/community", "/portal/workouts", "/portal/messages", "/portal/programs", "/portal/plans",
      "/portal/nutrition-targets", "/portal/support",
    ];
    for (const p of mustOpen) {
      if (!ROUTES.includes(p)) continue; // a route that was removed is fine
      expect(isShellBlockedPath(p), p).toBe(false);
      expect(shellRedirectFor(p, true), p).toBeNull();
    }
    expect(shellRedirectFor("/coaching", true)).toBe("/");
    expect(shellRedirectFor("/coaching", false)).toBeNull();
  });

  it("the old /membership and /signup/jf addresses land on the free application, never a checkout", () => {
    expect(read("src/routes/membership.tsx")).toMatch(/redirect\(\{ to: "\/join"/);
    expect(read("src/routes/signup.jf.tsx")).toMatch(/redirect\(\{ to: "\/join"/);
  });

  it("the root route sends a blocked page to the start, before load and after a cold open", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).toMatch(/beforeLoad: \(\{ location \}\) => \{\s*const to = shellRedirect\(location\.pathname\)/);
    expect(root).toContain("<ShellPurchaseGuard />");
    expect(root).toContain("__html: NATIVE_SHELL_BOOT_SCRIPT");
    expect(read("src/platform/native-init.ts")).toContain("installShellPurchaseGuard(window");
  });
});

describe("every link in client-facing code to a blocked page is hidden or guarded in the app", () => {
  const files: string[] = [];
  (function walk(d: string) {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  })("src");

  // Files whose links to blocked pages are only ever on screen on a blocked page (or nowhere).
  const onlyOnBlockedPages: Record<string, string> = {
    "src/routes/about.tsx": "/about",
    "src/routes/coaching.index.tsx": "/coaching",
    "src/routes/m.welcome.tsx": "/m/welcome",
    "src/routes/_authenticated/portal/purchases.$id.tsx": "/portal/purchases/$id",
    "src/components/sales/offer-comparison.tsx": "(not used by any page)",
  };

  it("finds the links", () => {
    const linking = files.filter((f) => /\bto="\/(coaching|about|portal\/(plan|purchases))/.test(read(f)));
    expect(linking.length).toBeGreaterThan(3);
  });

  it("each file that links to one checks the platform, marks it data-web-only, or only renders on a blocked page", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (/src\/test|components\/admin|routes\/_authenticated\/(admin|coach)\//.test(f)) continue;
      const s = read(f);
      const hits = [...s.matchAll(/\b(?:to|href|backTo|ctaHref)=\{?["'`](\/[^"'`]*)["'`]/g)].map((m) => m[1]!).filter(isShellBlockedPath);
      if (!hits.length) continue;
      const rel = f.split(path.sep).join("/");
      if (onlyOnBlockedPages[rel]) {
        const where = onlyOnBlockedPages[rel]!;
        if (where.startsWith("/")) expect(isShellBlockedPath(where), rel).toBe(true);
        else expect(files.filter((g) => g !== f && read(g).includes(path.basename(f, ".tsx"))), rel).toEqual([]);
        continue;
      }
      if (!/isNative\(|useNativeShell\(|data-web-only|native-purchases/.test(s)) bad.push(`${rel}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("the public header and footer hide every sales link in the app and keep Sign in", () => {
    const header = read("src/components/sales/public-header.tsx");
    expect(header).toMatch(/data-public-nav data-web-only/);
    expect(header).toMatch(/data-web-only>\s*<PhoneMenu/);
    expect(header).toContain("data-web-only=\"\"");
    expect(header).toContain("data-public-signin");
    const footer = read("src/components/sales/sales-page-shell.tsx");
    for (const to of ["/coaching", "/about"]) expect(footer).toMatch(new RegExp(`to="${to}"[^>]*data-web-only`));
    expect(footer).toMatch(/hash="app"[^>]*data-web-only/);
    const css = read("src/styles.css");
    expect(css).toContain("html[data-native-shell] [data-web-only] { display: none !important; }");
    expect(css).toContain("html[data-native-shell] [data-public-signin] { display: inline-flex !important; }");
  });

  it("the account screens show no Your plan, billing or purchases rows in the app", () => {
    const account = read("src/routes/_authenticated/portal/account.tsx");
    expect(account).toMatch(/\{!tierLoading && tier && !native && \(\s*<SettingsLink\s+to="\/portal\/plan"/);
    expect(account).toMatch(/\{!native && tier === "coaching" && \(/);
    expect(read("src/components/account/account-lifecycle.tsx")).toMatch(/deact!\.tier === "coaching" && !isNative\(\)/);
  });

  it("the portal menus drop My Purchases and Membership in the app", () => {
    const clientRows = navForShell(clientNav, true).map((i) => i.to);
    const memberRows = navForShell(selfServeNav, true).map((i) => i.to);
    expect(clientRows).not.toContain("/portal/purchases");
    expect(memberRows).not.toContain("/portal/membership");
    expect(memberRows).toContain("/portal/account");
    expect(navForShell(selfServeNav, false).map((i) => i.to)).toContain("/portal/membership");
    expect(read("src/routes/_authenticated/portal/route.tsx")).toContain("navForShell(isSelfServe ? selfServeNav : clientNav, native)");
  });

  it("a lapsed member lands on Account in the app, never the billing page", () => {
    expect(read("src/routes/_authenticated/portal/route.tsx")).toMatch(/isNative\(\) \? "\/portal\/account" : "\/portal\/membership"/);
  });

  it("every checkout redirect goes through goToPayment", () => {
    for (const f of [
      "src/components/plans/plan-manager.tsx",
      "src/components/sales/ready-to-start.tsx",
      "src/components/billing/my-purchase-detail.tsx",
      "src/components/billing/my-purchases-view.tsx",
      "src/components/ai-credits/ai-credits.tsx",
      "src/routes/_authenticated/portal/membership.tsx",
      "src/route-pages/membership.tsx",
    ]) {
      const s = read(f);
      expect(s, f).toContain("goToPayment(");
      expect(s, f).not.toMatch(/window\.location\.(assign|href\s*=)\s*\(?\s*(r\.url|url)\b/);
    }
  });
});

describe("links, window.open and payment pages", () => {
  it("knows a purchase link wherever it points", () => {
    for (const u of [
      "https://checkout.stripe.com/c/pay/cs_live_x",
      "https://buy.stripe.com/abc",
      "https://billing.stripe.com/p/session/x",
      "https://invoice.stripe.com/i/acct/x",
      "https://jfeffect.com/coaching",
      "https://www.jfeffect.com/coaching/apply?package=complete",
      "/pay/abc123",
      "/autopay/xyz",
      "/portal/plan",
      "/about",
    ]) {
      expect(isPurchaseUrl(u), u).toBe(true);
    }
    for (const u of [
      "https://www.instagram.com/",
      "https://jfeffect.com/join",
      "/portal/workouts",
      "/coaching-agreement",
      "https://dashboard.stripe.com/",
      "mailto:support@jfeffect.com",
      "",
      null,
    ]) {
      expect(isPurchaseUrl(u as any), String(u)).toBe(false);
    }
  });

  function fakeWindow(href = "https://jfeffect.com/portal/messages") {
    let onClick: ((e: any) => void) | null = null;
    const opened: unknown[] = [];
    const win: any = {
      location: { href },
      open: (url: unknown) => {
        opened.push(url);
        return {};
      },
      addEventListener: (_t: string, fn: (e: any) => void, capture: boolean) => {
        expect(capture).toBe(true);
        onClick = fn;
      },
    };
    const tap = (hrefAttr: string) => {
      const e = { target: { closest: () => ({ getAttribute: () => hrefAttr }) }, preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() };
      onClick!(e);
      return e.preventDefault.mock.calls.length > 0;
    };
    return { win, opened, tap };
  }

  it("in the app a tap on a purchase link does nothing; other links work", () => {
    setShellStaff(null);
    const { win, tap } = fakeWindow();
    installShellPurchaseGuard(win);
    expect(tap("https://jfeffect.com/pay/abc")).toBe(true);
    expect(tap("/coaching")).toBe(true);
    expect(tap("https://checkout.stripe.com/c/pay/x")).toBe(true);
    expect(tap("/portal/workouts")).toBe(false);
    expect(tap("/join")).toBe(false);
    expect(tap("https://www.instagram.com/jf")).toBe(false);
  });

  it("window.open refuses a purchase link (a Cleo answer, a chat attachment), opens the rest", () => {
    setShellStaff(null);
    const { win, opened } = fakeWindow();
    installShellPurchaseGuard(win);
    expect(win.open("https://buy.stripe.com/abc", "_blank")).toBeNull();
    expect(win.open("/portal/recipes/1", "_blank")).not.toBeNull();
    expect(opened).toEqual(["/portal/recipes/1"]);
  });

  it("staff keep their payment tools (sending a client a link, taking a payment at the gym)", () => {
    setShellStaff("coach");
    expect(shellAllowsUrl("https://buy.stripe.com/abc", true)).toBe(true);
    setShellStaff("member");
    expect(shellAllowsUrl("https://buy.stripe.com/abc", true)).toBe(false);
    setShellStaff("client");
    expect(shellAllowsUrl("https://buy.stripe.com/abc", true)).toBe(false);
    expect(shellAllowsUrl("https://buy.stripe.com/abc", false)).toBe(true);
    setShellStaff(null);
  });

  it("the boot script marks the app and sends a blocked page opened cold to the start", () => {
    const run = (pathname: string, cap: any, ua = "Mozilla/5.0") => {
      const attrs: Record<string, string> = {};
      const replaced: string[] = [];
      const doc = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
      const loc = { pathname, replace: (u: string) => replaced.push(u) };
      new Function("window", "document", "location", "navigator", NATIVE_SHELL_BOOT_SCRIPT)({ Capacitor: cap }, doc, loc, { userAgent: ua });
      return { marked: "data-native-shell" in attrs, replaced };
    };
    const native = { isNativePlatform: () => true };
    expect(run("/portal/community", native)).toEqual({ marked: true, replaced: [] });
    expect(run("/coaching", native)).toEqual({ marked: true, replaced: ["/"] });
    expect(run("/portal/plan", undefined, "Mozilla/5.0 JFEffectApp/1900")).toEqual({ marked: true, replaced: ["/"] });
    expect(run("/coaching", undefined)).toEqual({ marked: false, replaced: [] });
  });

  it("the app never shows the marketing page with its plans and prices, ?landing included", () => {
    const base = { hasSession: false, standalone: false, native: false, forceLanding: false };
    expect(launchMode({ ...base, native: true, forceLanding: true })).toBe("app");
    expect(launchMode({ ...base, forceLanding: true })).toBe("landing");
    const attrs: Record<string, string> = {};
    const doc = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v), removeAttribute: (k: string) => delete attrs[k] } };
    new Function("window", "document", "location", LAUNCH_BOOT_SCRIPT)(
      { Capacitor: { isNativePlatform: () => true }, localStorage: { length: 0 }, navigator: {} },
      doc,
      { pathname: "/", search: "?landing" },
    );
    expect(attrs["data-launch"]).toBe("app");
  });
});

describe("sign-up in the app is the free account only", () => {
  it("the application asks nothing about paid coaching in the app", () => {
    expect(joinStepsForShell(MEMBER_STEPS, true)).not.toContain("coaching_interest");
    expect(joinStepsForShell(MEMBER_STEPS, false)).toEqual([...MEMBER_STEPS]);
    const join = read("src/components/join/membership-application.tsx");
    expect(join).toContain("joinStepsForShell(MEMBER_STEPS, native)");
    expect(join).toMatch(/coaching && result\.bookingUrl && !isNative\(\)/);
    expect(join).toMatch(/data-web-only>\s*<TextLink to="\/about">/);
  });

  it("the free application never takes a payment or links to one", () => {
    const join = read("src/components/join/membership-application.tsx");
    expect(join).not.toMatch(/checkout|stripe|priceCents|\$\d/i);
    expect(read("src/routes/auth.tsx")).not.toMatch(/to="\/(coaching|membership|premium|pricing)/);
  });

  it("a booking page offers no coaching sign-up in the app", () => {
    const b = read("src/components/booking/booking-page.tsx");
    expect(b).toMatch(/!\(who && page\.includedCall\) && !native && \(/);
  });

  it("Crew promos pointing at any blocked page are dropped in the app", () => {
    const promos = [{ id: "a", cta_path: "/about" }, { id: "b", cta_path: "/portal/programs" }, { id: "c", cta_path: "/coaching/apply" }];
    expect(promosForShell(promos, true).map((p) => p.id)).toEqual(["b"]);
  });
});

describe("chat payment cards (rendered)", () => {
  const qc = () => new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  const render = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: qc() }, el));
  const pay = { kind: "payment_request", title: "Coaching, December", amount_cents: 13000, currency: "CAD", payment_url: "https://jfeffect.com/pay/abc" } as any;
  const auto = { kind: "auto_pay_setup", url: "https://jfeffect.com/autopay/x", each_cents: 13000, every: "month", currency: "CAD" } as any;

  it("the client in the app sees what it's for, no amount and no Pay button", () => {
    platform.native = true;
    const html = render(createElement(PaymentRequestCard, { att: pay, mine: false, staff: false }));
    expect(html).toContain("Coaching, December");
    expect(html).not.toMatch(/\$130|Pay now|<a |Stripe/);
    const a = render(createElement(AutoPaySetupCard, { att: auto, staff: false }));
    expect(a).not.toMatch(/\$130|Set up auto-pay|<a /);
  });

  it("on the web (and for the coach in the app) the card is unchanged", () => {
    platform.native = false;
    const html = render(createElement(PaymentRequestCard, { att: pay, mine: false, staff: false }));
    expect(html).toContain("Pay now");
    expect(html).toContain("$130");
    platform.native = true;
    expect(shellHidesPayment(true, true)).toBe(false);
    expect(render(createElement(PaymentRequestCard, { att: pay, mine: true, staff: true }))).toContain("Open payment page");
    platform.native = false;
  });
});

describe("the iOS build ships JF Effect's own icon and launch image, iPhone only by default", () => {
  const wf = read(".github/workflows/ios-build.yml");

  it("regenerates both sets from AppIcon-1024.png after `cap add ios` and fails on a placeholder", () => {
    expect(wf.indexOf("npx cap add ios")).toBeLessThan(wf.indexOf("app_art.py generate AppIcon-1024.png"));
    expect(wf).toContain("app_art.py check AppIcon-1024.png");
    expect(wf).toContain("node_modules/@capacitor/cli/assets/ios-pods-template.tar.gz");
    expect(wf).toContain("app_art.py check-app AppIcon-1024.png");
    expect(wf).not.toContain("- name: Set AppIcon");
  });

  it("the generator covers every iPhone and iPad size and the 1024 App Store icon, with no alpha", () => {
    const art = read("native/ios-app/app_art.py");
    for (const slot of ['("60x60", 2, "iphone")', '("60x60", 3, "iphone")', '("83.5x83.5", 2, "ipad")', '("1024x1024", 1, "ios-marketing")']) {
      expect(art).toContain(slot);
    }
    expect(art).toContain("shutil.rmtree(d, ignore_errors=True)");
    expect(art).toContain("has an alpha channel");
  });

  it("the device family is iPhone only unless IOS_SUPPORT_IPAD is true, and the built app is checked", () => {
    expect(wf).toContain("IOS_SUPPORT_IPAD: ${{ vars.IOS_SUPPORT_IPAD || 'false' }}");
    expect(wf).toMatch(/TARGETED_DEVICE_FAMILY = \{family\}/);
    expect(wf).toContain("Print :UIDeviceFamily");
  });
});
