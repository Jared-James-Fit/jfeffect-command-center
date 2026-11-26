// Coaching Sessions (Meetings) screenshots: the client's Meetings tab, a
// meeting before the call (prep, agenda, Cleo's brief, their answers), after
// the call (Cleo's reading, decisions, memory) and the athlete-safe shared
// screen, run locally against fixtures for a made-up athlete built by the real
// engines (meetings-fixture.ts). No client's data.
//
//   npx tsx scripts/coaching-screenshots/meetings-fixture.ts /tmp/meetings.json
//   npx vite dev --port 5173 --host 127.0.0.1           (in one terminal)
//   FIXTURE=/tmp/meetings.json OUT=<dir> node scripts/coaching-screenshots/meetings.cjs [names…]
//
// RAW=<dir> also keeps each screen's raw PNG.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
process.env.SHOT_EMAIL = process.env.SHOT_EMAIL || "coach@example.com";
const { run } = require("./harness.cjs");
const F = require("./fixtures.cjs");
const { composeWebp } = require("./frame.cjs");

const FIX = JSON.parse(fs.readFileSync(process.env.FIXTURE || "/tmp/meetings.json", "utf8"));
const OUT = process.env.OUT || path.join(process.cwd(), "src/assets/coaching");
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "meetings-shots-"));
process.env.WAIT = process.env.WAIT || "9000";

const { CLIENT_ID, SESSION_ID } = FIX;

// the fixtures' day: Wednesday Nov 25 2026, 1 PM in Winnipeg
const FIXED_CLOCK = `(() => {
  const off = Date.parse("2026-11-25T19:00:00Z") - Date.now();
  const D = Date;
  class FakeDate extends D {
    constructor(...a) { if (a.length === 0) super(D.now() + off); else super(...a); }
    static now() { return D.now() + off; }
  }
  FakeDate.parse = D.parse;
  FakeDate.UTC = D.UTC;
  globalThis.Date = FakeDate;
})();`;

const client = {
  ...F.fixtures.clients?.[0],
  id: CLIENT_ID,
  first_name: "Alex",
  last_name: "Rivera",
  preferred_name: null,
  email: "demo.athlete@example.com",
  status: "Active",
  service_tier: "coaching",
  archived: false,
  user_id: "e1111111-2222-4333-8444-555555555555",
  full_name: "Alex Rivera",
  preferred_weight_unit: "kg",
  weight_unit_confirmed_at: "2026-01-01T00:00:00Z",
};

const TWO_STEP_OK = {
  team: true,
  required: true,
  verified: true,
  methods: [{ id: "m1", kind: "totp", label: "Authenticator app", created_at: "2026-01-01T00:00:00Z", last_used_at: "2026-11-25T15:00:00Z" }],
  preferred: "totp",
  suggestedPhone: null,
  emailBackup: null,
};

const mocks = (session) => ({
  getTwoStepStatus: TWO_STEP_OK,
  getSessionsHomeFn: FIX.home,
  getSessionFn: session,
  getPresentationFn: FIX.presentation,
  updateSessionFn: { ok: true },
});

const common = {
  initScript: FIXED_CLOCK,
  before: { "jf-theme": "dark", "jf-theme-updated-at": "2026-11-01T00:00:00Z" },
  scale: 2,
  log: !!process.env.LOG,
};

const adminFixtures = {
  ...F.fixtures,
  clients: (url) => (url.searchParams.get("user_id") === `eq.${F.USER_ID}` ? [] : [client]),
  user_roles: [{ user_id: F.USER_ID, role: "admin" }],
  profiles: [{ id: F.USER_ID, user_id: F.USER_ID, first_name: "Jared", last_name: "McIntyre", full_name: "Jared McIntyre", email: "coach@example.com", avatar_url: null, theme: "dark" }],
};

const scrollTo = (selector, offset = 12) => async (p) => {
  await p.evaluate(
    ([s, off]) => {
      const el = document.querySelector(s);
      if (!el) return;
      let box = el.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      if (box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - off;
      else window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off);
    },
    [selector, offset],
  );
  await p.waitForTimeout(1200);
};
const openMeeting = (after) => async (p) => {
  await p.click("[data-meeting-row]");
  await p.waitForTimeout(2500);
  if (after) {
    await p.click('[data-step="after"]').catch(() => {});
    await p.waitForTimeout(1500);
  }
};
const then = (...steps) => async (p) => {
  for (const s of steps) await s(p);
};

const TAB = `/admin/clients/${CLIENT_ID}?tab=meetings`;
const SHOTS = [
  // The Meetings tab: the next event, what Cleo recommends, earlier meetings and what's carried over.
  { name: "app-meetings", path: TAB, session: FIX.before },
  // A meeting before the call: the event, Cleo's brief, the agenda with the athlete's corner.
  { name: "app-meeting-before", path: TAB, session: FIX.before, afterLoad: openMeeting(false) },
  { name: "app-meeting-agenda", path: TAB, session: FIX.before, afterLoad: then(openMeeting(false), scrollTo("[data-session-agenda]", 80)) },
  // After the call: Cleo's reading, kept apart by what was agreed and what was only floated.
  { name: "app-meeting-after", path: TAB, session: FIX.after, afterLoad: openMeeting(true) },
  { name: "app-meeting-decisions", path: TAB, session: FIX.after, afterLoad: then(openMeeting(true), scrollTo("[data-recommendation]", 60)) },
  // The shared screen: only what the athlete may see.
  { name: "app-meeting-present", path: `/admin/meetings/${SESSION_ID}/present`, session: FIX.before, desktop: true, width: 1440, height: 900 },
  // The shared screen's first section: the athlete's own wins.
  {
    name: "app-meeting-present-wins",
    path: `/admin/meetings/${SESSION_ID}/present`,
    session: FIX.before,
    desktop: true,
    width: 1440,
    height: 900,
    afterLoad: async (p) => {
      await p.keyboard.press("ArrowRight");
      await p.waitForTimeout(1200);
    },
  },
  // The meeting sheet on a computer.
  { name: "app-meeting-desktop", path: TAB, session: FIX.before, afterLoad: openMeeting(false), desktop: true, width: 1440, height: 900 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ONLY = process.argv.slice(2);
  for (const s of SHOTS) {
    if (ONLY.length && !ONLY.includes(s.name)) continue;
    const raw = path.join(TMP, `${s.name}.png`);
    const res = await run({
      ...common,
      path: s.path,
      out: raw,
      fixtures: adminFixtures,
      serverFnMocks: mocks(s.session),
      afterLoad: s.afterLoad,
      ...(s.desktop ? { desktop: true, width: s.width, height: s.height } : { height: 763 }),
    });
    if (process.env.TEXT) console.log(res.text);
    if (process.env.RAW) fs.copyFileSync(raw, path.join(process.env.RAW, `${s.name}.png`));
    const out = path.join(OUT, `${s.name}.webp`);
    if (s.desktop) {
      const { composeDesktopWebp } = require("./frame.cjs");
      if (composeDesktopWebp) await composeDesktopWebp(browser, raw, out, { width: s.width, height: s.height });
      console.log(`${s.name}.webp`);
    } else {
      await composeWebp(browser, raw, out);
      console.log(`${s.name}.webp  ${Math.round(fs.statSync(out).size / 1024)} KB`);
    }
  }
  await browser.close();
})();
