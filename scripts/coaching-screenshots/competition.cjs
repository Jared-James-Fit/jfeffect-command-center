// Competition Intelligence screenshots: the coach's Competition tab, an
// assessment with Cleo's checked calls, the athlete's game plan and the
// meet-day command centre, run locally against fixtures for a made-up athlete
// and a made-up field (competition-fixture.ts). No client's data.
//
//   npx tsx scripts/coaching-screenshots/competition-fixture.ts /tmp/comp.json
//   npx vite dev --port 5173 --host 127.0.0.1           (in one terminal)
//   FIXTURE=/tmp/comp.json node scripts/coaching-screenshots/competition.cjs [names…]
//
// RAW=<dir> also keeps each screen's raw PNG; OUT=<dir> overrides where the
// framed WebPs go (default src/assets/coaching).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { run } = require("./harness.cjs");
const F = require("./fixtures.cjs");
const { composeWebp } = require("./frame.cjs");

const FIX = JSON.parse(fs.readFileSync(process.env.FIXTURE || "/tmp/comp.json", "utf8"));
const OUT = process.env.OUT || path.join(process.cwd(), "src/assets/coaching");
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "competition-shots-"));
process.env.WAIT = process.env.WAIT || "9000";

const CLIENT_ID = "c1111111-2222-4333-8444-555555555555";
const COMP_ID = "d1111111-2222-4333-8444-555555555555";
const ASSESSMENT_ID = FIX.assessment.id;

// the fixtures' day: Monday Jan 25 2027, 9:40 AM in Winnipeg (two weeks before the meet)
const FIXED_CLOCK = `(() => {
  const off = Date.parse("2027-01-25T15:40:00Z") - Date.now();
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
  // the coach is looking at the athlete, so the athlete is another login
  user_id: "e1111111-2222-4333-8444-555555555555",
  full_name: "Alex Rivera",
  preferred_weight_unit: "kg",
  weight_unit_confirmed_at: "2026-01-01T00:00:00Z",
};

// The coach's view: the demo login is an admin whose session is confirmed.
const TWO_STEP_OK = {
  team: true,
  required: true,
  verified: true,
  methods: [{ id: "m1", kind: "totp", label: "Authenticator app", created_at: "2026-01-01T00:00:00Z", last_used_at: "2027-01-25T15:00:00Z" }],
  preferred: "totp",
  suggestedPhone: null,
  emailBackup: null,
};

const assessmentFull = { ...FIX.assessment };
const coachMocks = {
  getTwoStepStatus: TWO_STEP_OK,
  getCompetitionWorkspaceFn: FIX.workspace,
  getAssessmentFn: assessmentFull,
  getCompetitionOverviewFn: { items: [], counts: {} },
};

const meetDay = {
  competition: { ...FIX.workspace.selected.competition },
  brief: FIX.workspace.selected.brief,
  plan: FIX.assessment.internal?.strategy?.adjusted ?? null,
  log: [],
  competitors: FIX.workspace.selected.competitors,
};

const common = {
  initScript: FIXED_CLOCK,
  before: { "jf-theme": "dark", "jf-theme-updated-at": "2026-11-01T00:00:00Z" },
  scale: 2,
  log: !!process.env.LOG,
};

const adminFixtures = {
  ...F.fixtures,
  // the coach's login has no athlete record of its own (no View switcher)
  clients: (url) => (url.searchParams.get("user_id") === `eq.${F.USER_ID}` ? [] : [client]),
  user_roles: [{ user_id: F.USER_ID, role: "admin" }],
  // the coach's own profile (the demo login), never the athlete's
  profiles: [{ id: F.USER_ID, user_id: F.USER_ID, first_name: "Jared", last_name: "McIntyre", full_name: "Jared McIntyre", email: "coach@example.com", avatar_url: null, theme: "dark" }],
};

// scrolls whatever box holds `selector` (the page, or a sheet's own scroll area)
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

const SHOTS = [
  // The Competition tab on a phone: the meet, the forecast and the next milestone.
  {
    name: "app-competition",
    path: `/admin/clients/${CLIENT_ID}?tab=competition&competition=${COMP_ID}`,
    fixtures: adminFixtures,
    serverFnMocks: coachMocks,
  },
  // The assessment Cleo wrote, opened from the push: its calls with the evidence.
  {
    name: "app-competition-calls",
    path: `/admin/clients/${CLIENT_ID}?tab=competition&competition=${COMP_ID}&assessment=${ASSESSMENT_ID}`,
    fixtures: adminFixtures,
    serverFnMocks: coachMocks,
    afterLoad: scrollTo("[data-call]", 150),
  },
  // The same on a computer.
  {
    name: "app-competition-desktop",
    desktop: true,
    width: 1440,
    height: 900,
    path: `/admin/clients/${CLIENT_ID}?tab=competition&competition=${COMP_ID}&assessment=${ASSESSMENT_ID}`,
    fixtures: adminFixtures,
    serverFnMocks: coachMocks,
  },
  // The athlete's game plan.
  {
    name: "app-competition-athlete",
    path: "/portal/competition",
    fixtures: { ...F.fixtures, clients: [client] },
    serverFnMocks: {
      getMyCompetitionsFn: {
        coach: "Jared",
        competitions: [
          {
            id: COMP_ID,
            name: FIX.workspace.selected.competition.name,
            meet_date: FIX.workspace.selected.competition.meet_date,
            meet_end_date: null,
            location: FIX.workspace.selected.competition.location ?? null,
            federation: "CanPL",
            weight_class: "74",
            division: "Open",
            status: "upcoming",
            is_primary: true,
            results: null,
            lifting_start: null,
            weigh_in_at: null,
            flight: null,
            currentPlanId: ASSESSMENT_ID,
            updates: [
              {
                id: ASSESSMENT_ID,
                kind: FIX.assessment.kind,
                version: FIX.assessment.version,
                athlete: FIX.assessment.athlete,
                releasedAt: "2027-01-25T15:20:00Z",
                automated: false,
                openedAt: null,
                acknowledgedAt: null,
                superseded: false,
                needsAck: true,
              },
            ],
          },
        ],
      },
      markMyUpdateFn: { ok: true },
    },
  },
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
      fixtures: s.fixtures,
      serverFnMocks: s.serverFnMocks ?? {},
      afterLoad: s.afterLoad,
      ...(s.desktop ? { desktop: true, width: s.width, height: s.height } : { height: 763 }),
    });
    if (process.env.TEXT) console.log(res.text);
    if (process.env.RAW) fs.copyFileSync(raw, path.join(process.env.RAW, `${s.name}.png`));
    if (s.desktop) {
      const { composeDesktopWebp } = require("./frame.cjs");
      const out = path.join(OUT, `${s.name}.webp`);
      if (composeDesktopWebp) await composeDesktopWebp(browser, raw, out, { width: s.width, height: s.height });
      console.log(`${s.name}.webp`);
    } else {
      const out = path.join(OUT, `${s.name}.webp`);
      await composeWebp(browser, raw, out);
      console.log(`${s.name}.webp  ${Math.round(fs.statSync(out).size / 1024)} KB`);
    }
  }
  await browser.close();
})();
