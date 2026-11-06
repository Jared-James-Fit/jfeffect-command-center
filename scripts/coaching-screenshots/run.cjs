// Real app screenshots for the /coaching page (src/assets/coaching/*.webp).
//
// The screens are the app itself, run locally against fixtures for a made-up
// athlete ("Alex"), so they always match the current app and never show a
// client's data. Re-run after the app's look changes:
//
//   npx vite dev --port 5173 --host 127.0.0.1     (in one terminal)
//   node scripts/coaching-screenshots/run.cjs      (in another)
//
// Each screen is captured at 390×763 CSS px (2x), then put into a whole iPhone
// screen (status bar above, home indicator below) and saved as WebP.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { run } = require("./harness.cjs");
const F = require("./fixtures.cjs");

const OUT = path.join(process.cwd(), "src/assets/coaching");
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "coaching-shots-"));
process.env.WAIT = process.env.WAIT || "10000";

const COACH_ID = "a1111111-2222-4333-8444-555555555555";
const SUB_ID = "s1111111-2222-4333-8444-555555555555";
const common = {
  rpc: { ensure_my_member_client: F.CLIENT_ID },
  // Dark app; the coach's plan already opened (no "new" dot on Nutrition).
  before: { "jf-theme": "dark", "jf-theme-updated-at": "2026-11-01T00:00:00Z", [`jf-nav-seen:${F.USER_ID}:/portal/nutrition-targets`]: String(Date.parse("2026-11-06T00:00:00Z")) },
  scale: 2,
  height: 763,
  log: false,
  files: { "/jared.jpg": path.join(__dirname, "coach-face.jpg") },
};
F.fixtures.coaches = [{ id: COACH_ID, user_id: F.COACH_USER, full_name: "Jared McIntyre", name: "Jared McIntyre", first_name: "Jared", profile_picture_url: "https://demo.local/jared.jpg", phone: null, active: true }];
F.fixtures.conversation_state = [{ client_id: F.CLIENT_ID, client_last_read_at: "2026-11-06T00:00:00Z", admin_last_read_at: "2026-11-06T00:00:00Z" }];

// A demo check-in exchange: how a week of coaching reads in the chat.
const msg = (i, role, at, body, attachments = []) => ({
  id: `m${i}111111-2222-4333-8444-555555555555`, client_id: F.CLIENT_ID, sender_id: role === "client" ? F.USER_ID : F.COACH_USER, sender_role: role,
  body, attachments, created_at: at, sent_at: at, updated_at: at, read_by_client_at: at, read_by_admin_at: at, is_internal_note: false, is_automated: false,
  delivery_status: "sent", deleted_at: null, edited_at: null, message_type: "Message", reply_to_message_id: null, reply_preview: null,
});
const MESSAGES = [
  msg(1, "client", "2026-11-01T23:40:00Z", "Weekly check-in complete", [{ type: "file", url: "", kind: "checkin_submission", checkin_submission_id: SUB_ID, checkin_task_type: "weekly_checkin", request_title: "Weekly check-in" }]),
  msg(2, "client", "2026-11-01T23:41:00Z", "weight's down another pound. squats felt fast this week but my left hip was a bit tight on thursday"),
  msg(3, "admin", "2026-11-02T14:12:00Z", "good week. you're right on pace so calories stay the same 👊"),
  msg(4, "admin", "2026-11-02T14:13:00Z", "squat's ready to move up, 295 for all four sets on friday. swap the split squats for leg press this week and send me a video of your first set, i'll check it"),
  msg(5, "client", "2026-11-02T14:30:00Z", "sounds good 👍"),
];

const TRAIN = `Meal 1
3 whole eggs
2 slices whole wheat bread
40 g oats (dry weight)
1 scoop whey protein
Approx: 52P / 68C / 19F

Meal 2 (Pre-Workout)
170 g chicken breast (raw)
250 g white rice (cooked)
1 banana
Approx: 42P / 98C / 5F

Meal 3 (Post-Workout)
1 scoop whey protein
2 rice cakes
1 tbsp honey
Approx: 26P / 37C / 2F

Meal 4
180 g lean ground beef (raw)
300 g potatoes
100 g green beans
Approx: 40P / 55C / 22F

Meal 5
200 g Greek yogurt (0%)
20 g almonds
100 g berries
Approx: 26P / 22C / 12F`;
const REST = TRAIN.replace("250 g white rice (cooked)", "180 g white rice (cooked)").replace("Approx: 42P / 98C / 5F", "Approx: 41P / 78C / 4F").replace("2 rice cakes\n", "");
const PLAN = {
  id: "t1", client_name: "Alex Demo", coach_name: "Jared McIntyre", updated_at: "2026-11-02T14:00:00Z", phase: "Fat loss", goal: "Fat loss", structure: "training_rest",
  status: "Active", start_date: "2026-11-02", end_date: "2026-11-30", water: "3.5 L", client_notes: null, food_weighing_rules: null, pdf_name: null, pdf_signed_url: null,
  days: [
    { id: "d1", day_label: "Training Day", calories: 2550, protein: 190, carbs: 290, fats: 70, fibre: null, steps: 9000, notes: TRAIN, use_on: "training", weekdays: [] },
    { id: "d2", day_label: "Rest Day", calories: 2315, protein: 190, carbs: 220, fats: 75, fibre: null, steps: 9000, notes: REST, use_on: "rest", weekdays: [] },
  ],
};
F.fixtures.nutrition_targets = [{ id: "t1", client_id: F.CLIENT_ID, status: "Active", visible_to_client: true, phase: "Fat loss", updated_at: PLAN.updated_at, last_updated_at: PLAN.updated_at, start_date: PLAN.start_date, end_date: PLAN.end_date, nutrition_target_days: PLAN.days }];

const blur = async (p) => { await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await p.waitForTimeout(500); };

/** Training Analytics over the last 12 weeks, scrolled so `heading` sits at the top of the screen. */
const analyticsAt = (heading, lift) => async (p) => {
  await p.getByRole("button", { name: "Last 12W", exact: true }).click();
  await p.waitForTimeout(2500);
  if (lift) { await p.getByRole("button", { name: lift, exact: true }).first().click(); await p.waitForTimeout(2000); }
  const y = await p.evaluate((h) => {
    const el = [...document.querySelectorAll("h2,h3,div,span")].find((e) => e.textContent.trim() === h);
    return el ? el.getBoundingClientRect().top + window.scrollY : 0;
  }, heading);
  await p.evaluate((yy) => window.scrollTo(0, yy), Math.max(0, y - 16));
  await p.waitForTimeout(1500);
  await blur(p);
};

const SHOTS = [
  // The squat's estimated max climbing week by week, from what was logged.
  { name: "app-analytics-progress", path: "/portal/workouts/analytics", afterLoad: analyticsAt("Lift Progress", "Back Squat") },
  { name: "app-analytics-prs", path: "/portal/workouts/analytics", afterLoad: analyticsAt("Recent ATPRs") },
  { name: "app-coach-chat", path: "/portal/messages", fixtures: { messages: MESSAGES }, serverFnMocks: { getMessengerCheckin: { id: SUB_ID, status: "completed", answers: {}, ai_analysis: null, reviewed_at: "2026-11-02T14:12:00Z" }, ensureDueMessengerCheckins: { ok: true } }, afterLoad: blur },
  { name: "app-nutrition", path: "/portal/nutrition-targets", serverFnMocks: { getCoachAssignedMealPlan: PLAN, getMyRecentAdherenceFn: null } },
];

const STATUS_BAR = `<div class="bar"><span>9:41</span><span class="icons">
  <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="#fff"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="#fff"/><rect x="10" y="3" width="3" height="9" rx="1" fill="#fff"/><rect x="15" y="0" width="3" height="12" rx="1" fill="#fff"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.6c2.2 0 4.2.9 5.7 2.3l1.1-1.1A9.6 9.6 0 0 0 8 1 9.6 9.6 0 0 0 1.2 3.8l1.1 1.1A8 8 0 0 1 8 2.6Zm0 3.2c1.3 0 2.5.5 3.4 1.4l1.1-1.1A6.4 6.4 0 0 0 8 4.2c-1.8 0-3.4.7-4.5 1.9l1.1 1.1c.9-.9 2.1-1.4 3.4-1.4Zm0 3.2c-.5 0-1 .2-1.3.6L8 11l1.3-1.4c-.3-.4-.8-.6-1.3-.6Z" fill="#fff"/></svg>
  <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="#fff" stroke-opacity=".4" fill="none"/><rect x="2" y="2" width="20" height="9" rx="2" fill="#fff"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="#fff" fill-opacity=".45"/></svg>
</span></div>`;

/** The app screenshot inside a whole iPhone screen, encoded as WebP by the browser's canvas. */
async function composeWebp(browser, pngPath, outPath) {
  const data = "data:image/png;base64," + fs.readFileSync(pngPath).toString("base64");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;background:#0d0d0f}
    .s{width:390px;height:844px;background:#0d0d0f;display:flex;flex-direction:column;overflow:hidden}
    .bar{height:47px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:6px 30px 0 50px;color:#fff;font-family:Inter,sans-serif;font-weight:600;font-size:17px;letter-spacing:-0.2px;box-sizing:border-box}
    .icons{display:flex;gap:6px;align-items:center}
    img{display:block;width:390px;height:763px;flex:none}
    .home{height:34px;flex:none;display:flex;align-items:flex-end;justify-content:center;padding-bottom:8px;box-sizing:border-box}
    .home i{display:block;width:134px;height:5px;border-radius:3px;background:#fff}
  </style></head><body><div class="s">${STATUS_BAR}<img src="${data}"><div class="home"><i></i></div></div></body></html>`);
  await page.waitForTimeout(300);
  const png = await page.screenshot();
  const webp = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.82).split(",")[1];
  }, png.toString("base64"));
  fs.writeFileSync(outPath, Buffer.from(webp, "base64"));
  await page.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const s of SHOTS) {
    const raw = path.join(TMP, `${s.name}.png`);
    await run({ ...common, path: s.path, out: raw, fixtures: { ...F.fixtures, ...(s.fixtures ?? {}) }, serverFnMocks: s.serverFnMocks ?? {}, afterLoad: s.afterLoad });
    const out = path.join(OUT, `${s.name}.webp`);
    await composeWebp(browser, raw, out);
    console.log(`${s.name}.webp  ${Math.round(fs.statSync(out).size / 1024)} KB`);
  }
  await browser.close();
})();
