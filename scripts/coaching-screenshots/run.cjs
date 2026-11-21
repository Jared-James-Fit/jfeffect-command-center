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

const { composeWebp } = require("./frame.cjs");

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
