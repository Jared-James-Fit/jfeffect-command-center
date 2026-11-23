/**
 * The AI health tick (pg_cron `ai-health-tick`, every 5 minutes; Nov 23 2026).
 *
 * 1. Probe: while a provider is down and its probe is due, one tiny call says whether it's back.
 * 2. Alerts (support_alerts, Communication → Alerts, and one push to the owner per incident):
 *    `ai_unavailable` (credits ran out / the key was refused / not answering), `ai_failures`
 *    (a third of the last hour's calls failed), `ai_stuck_jobs` (work that stopped moving),
 *    `ai_unusual_usage` (today's spend three times the usual), `ai_budget` (the month's estimate
 *    past 80% / 100% of the budget set on Settings → AI & Cleo). Each closes itself when it's over.
 * 3. Recovery, once a provider answers again: failed check-in recaps are written again from the
 *    client's own answers, then `ai_recovery_requeue` puts every background job that failed for
 *    the provider's fault back in its own queue, where it's written again from the records as
 *    they are now, with every safeguard (approval, dedupe, the coach's mode) running again.
 *    Nothing is sent from here; what a coach asked for himself is only counted for him.
 * 4. Self-healing: a check-in recap that never ran is written; nothing else is touched.
 * Server only.
 */
import { aiFailureWords, type AiFailureKind } from "./ai-errors";
import { clearHealthCache, probeOpenAi, readHealth, type Health } from "./ai-health.server";
import { unusualUsage } from "./ai-usage";

type Db = any;
const TZ = "America/Winnipeg";

/** Recaps redone per tick (each one is a model call of 10-30 s; the tick has ~100 s). */
const RECAPS_PER_TICK = 3;

export type TickReport = {
  probed: boolean;
  openai: Health["status"];
  alerts: Record<string, "opened" | "updated" | "resolved" | "quiet">;
  recovery: Record<string, unknown> | null;
  stuck: Record<string, number>;
  healed: Record<string, number>;
};

async function owners(db: Db): Promise<string[]> {
  const { data } = await db.from("business_owners").select("user_id");
  return ((data ?? []) as any[]).map((r) => r.user_id).filter(Boolean);
}

/** One push to each owner (deduped per event key, so an incident never pushes twice). */
async function pushOwners(
  db: Db,
  payload: { title: string; body: string; url: string; tag: string },
  eventKey: string,
): Promise<void> {
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    for (const uid of await owners(db)) {
      await sendWebPushToUser(db, uid, payload, {
        category: "billing",
        eventKey: `${eventKey}:${uid}`,
      } as any);
    }
  } catch (e: any) {
    console.error("[ai-health] push failed", e?.message);
  }
}

/** Opens, updates or resolves one support alert of a type; returns what it did. */
async function alert(
  db: Db,
  type: string,
  on: boolean,
  message: string,
  details: Record<string, unknown>,
): Promise<"opened" | "updated" | "resolved" | "quiet"> {
  const { data: open } = await db
    .from("support_alerts")
    .select("id, details")
    .eq("error_type", type)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (open ?? [])[0];
  const now = new Date().toISOString();
  if (on) {
    if (row) {
      await db
        .from("support_alerts")
        .update({
          error_message: message,
          details: { ...(row.details ?? {}), ...details, last_checked: now },
          updated_at: now,
        })
        .eq("id", row.id);
      return "updated";
    }
    await db
      .from("support_alerts")
      .insert({
        error_type: type,
        error_message: message,
        page_route: "/admin/settings/ai",
        details: { ...details, last_checked: now },
        status: "open",
      });
    return "opened";
  }
  if (!row) return "quiet";
  const notes = Array.isArray(row.details?.notes) ? row.details.notes : [];
  await db
    .from("support_alerts")
    .update({
      status: "resolved",
      resolved_at: now,
      details: {
        ...(row.details ?? {}),
        notes: [...notes, { note: `Resolved on its own: ${message}`, at: now }],
      },
      updated_at: now,
    })
    .eq("id", row.id);
  return "resolved";
}

function wordsFor(status: Health["status"]): string {
  const kind: AiFailureKind =
    status === "credits" ? "credits" : status === "auth" ? "auth" : "outage";
  return aiFailureWords(kind);
}

function localTime(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Waiting AI work, as the owner would count it (for the down alert). */
async function waitingCounts(db: Db): Promise<Record<string, number>> {
  const count = async (q: any) => (await q).count ?? 0;
  const [replies, recaps, insights, decks] = await Promise.all([
    count(
      db
        .from("coach_automation_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued")
        .like("error", "Waiting for AI%"),
    ),
    count(
      db
        .from("messenger_checkins")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .eq("ai_status", "failed")
        .is("reviewed_at", null),
    ),
    count(
      db
        .from("community_daily_visuals")
        .select("id", { count: "exact", head: true })
        .like("error", "Waiting for AI%"),
    ),
    count(
      db
        .from("community_post_decks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ),
  ]);
  return {
    coaching_replies: replies,
    checkin_recaps: recaps,
    athlete_insights: insights,
    post_decks: decks,
  };
}

function listWords(
  counts: Record<string, number>,
  names: Record<string, [string, string]>,
): string {
  return Object.entries(counts)
    .filter(([k, n]) => n > 0 && names[k])
    .map(([k, n]) => `${n} ${n === 1 ? names[k][0] : names[k][1]}`)
    .join(", ");
}

const WORK_NAMES: Record<string, [string, string]> = {
  coaching_replies: ["coaching reply", "coaching replies"],
  checkin_recaps: ["check-in recap", "check-in recaps"],
  athlete_insights: ["Athlete Insight", "Athlete Insights"],
  post_decks: ["Crew post deck", "Crew post decks"],
  lead_texts: ["lead text", "lead texts"],
  nutrition_plans: ["nutrition plan", "nutrition plans"],
};
const LEFT_NAMES: Record<string, [string, string]> = {
  program_generations: ["program generation", "program generations"],
  program_edits: ["program adjustment", "program adjustments"],
  plan_edits: ["nutrition plan change", "nutrition plan changes"],
  plan_changes: ["nutrition plan change", "nutrition plan changes"],
  program_imports: ["program import", "program imports"],
  meal_imports: ["meal plan import", "meal plan imports"],
  form_reply_drafts: ["form reply draft", "form reply drafts"],
};

/**
 * Check-in recaps that are missing (failed, never run, or a stand-in from before Nov 23) for
 * check-ins the coach hasn't reviewed yet, written again from the client's own answers.
 */
async function redoRecaps(
  db: Db,
  limit: number,
): Promise<{ done: number; failed: number; left: number }> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await db
    .from("messenger_checkins")
    .select("*")
    .eq("status", "completed")
    .is("reviewed_at", null)
    .is("superseded_at", null)
    .gte("submitted_at", since)
    .lte("submitted_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .order("submitted_at", { ascending: true })
    .limit(50);
  const { isStandInRecap, recapCheckin } = await import("@/lib/messenger-checkins.functions");
  const { isProviderFailureWords } = await import("./ai-errors");
  // never ran, failed for the provider's fault, or a stand-in from before Nov 23: never one whose
  // answer couldn't be used (the coach's Try again), so nothing here is retried forever
  const todo = ((data ?? []) as any[]).filter(
    (r) =>
      r.ai_status === "pending" ||
      (r.ai_status === "failed" && isProviderFailureWords(r.ai_error)) ||
      (r.ai_status === "ready" && isStandInRecap(r.ai_analysis)),
  );
  let done = 0;
  let failed = 0;
  for (const row of todo.slice(0, limit)) {
    try {
      const out = await recapCheckin(db, row);
      if (out.failure) {
        failed += 1;
        // the provider is down again: stop here, the rest waits for the next recovery
        if (["credits", "auth", "outage", "paused"].includes(out.failure.kind)) break;
      } else done += 1;
    } catch (e: any) {
      failed += 1;
      console.error("[ai-health] recap redo failed", row.id, e?.message);
      // something other than the model broke: marked so it isn't picked up again every tick
      await db
        .from("messenger_checkins")
        .update({
          ai_status: "failed",
          ai_error: `Couldn't write the recap: ${String(e?.message ?? e).slice(0, 200)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }
  return { done, failed, left: Math.max(0, todo.length - done - failed) };
}

async function recover(db: Db, h: Health): Promise<Record<string, unknown> | null> {
  const nowIso = new Date().toISOString();
  // claim: one tick at a time (a run cut off is taken over after 15 minutes)
  const { data: claimed } = await db
    .from("ai_provider_health")
    .update({ recovery_started_at: nowIso })
    .eq("provider", "openai")
    .or(
      `recovery_started_at.is.null,recovery_started_at.lt.${new Date(Date.now() - 15 * 60_000).toISOString()}`,
    )
    .select("recovery_report");
  if (!claimed?.length) return null;
  const report: Record<string, any> = { ...(claimed[0].recovery_report ?? {}) };
  if (report.for !== h.recovered_at) {
    // a new recovery: the queues are put back once
    const { data, error } = await db.rpc("ai_recovery_requeue", { _days: 7 });
    if (error) throw new Error(error.message);
    report.for = h.recovered_at;
    report.requeued = data;
    report.recaps = { done: 0, failed: 0 };
  }
  const r = await redoRecaps(db, RECAPS_PER_TICK);
  report.recaps = {
    done: (report.recaps?.done ?? 0) + r.done,
    failed: (report.recaps?.failed ?? 0) + r.failed,
  };
  const finished = r.left === 0;
  await db
    .from("ai_provider_health")
    .update({
      recovery_report: report,
      recovery_started_at: null,
      ...(finished ? { recovery_done_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "openai");
  if (finished) {
    const q = (report.requeued ?? {}) as Record<string, any>;
    const redone = listWords(
      {
        checkin_recaps: report.recaps.done,
        coaching_replies: Number(q.coaching_replies ?? 0) + Number(q.coaching_replies_woken ?? 0),
        athlete_insights: Number(q.athlete_insights ?? 0),
        post_decks: Number(q.post_decks ?? 0),
        lead_texts: Number(q.lead_texts ?? 0),
        nutrition_plans: Number(q.nutrition_plans ?? 0),
      },
      WORK_NAMES,
    );
    const left = listWords((q.left_for_you ?? {}) as Record<string, number>, LEFT_NAMES);
    report.summary = [
      redone ? `Redone or back in line: ${redone}.` : "Nothing was waiting.",
      left ? `Yours to run again: ${left}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    await db
      .from("ai_provider_health")
      .update({ recovery_report: report })
      .eq("provider", "openai");
    if (redone || left) {
      await pushOwners(
        db,
        {
          title: "AI is back",
          body: `${report.summary} Replies still wait for your OK.`.slice(0, 220),
          url: "/admin/settings/ai",
          tag: "ai-health",
        },
        `ai_back:${h.recovered_at}`,
      );
    }
  }
  return report;
}

/** Work that stopped moving (each queue reclaims its own; this only counts what's stuck past that). */
async function stuckJobs(db: Db): Promise<Record<string, number>> {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const count = async (q: any) => (await q).count ?? 0;
  const head = { count: "exact" as const, head: true };
  const [replies, recaps, plans, planEdits, generations, edits, decks, leads, pImports, mImports] =
    await Promise.all([
      count(
        db
          .from("coach_automation_items")
          .select("id", head)
          .in("status", ["working", "sending"])
          .lt("locked_at", ago(30)),
      ),
      count(
        db
          .from("messenger_checkins")
          .select("id", head)
          .eq("status", "completed")
          .eq("ai_status", "pending")
          .lt("submitted_at", ago(30))
          .gte("submitted_at", ago(3 * 1440)),
      ),
      count(
        db
          .from("nutrition_ai_plans")
          .select("id", head)
          .in("status", ["pending", "generating"])
          .lt("updated_at", ago(60)),
      ),
      count(
        db
          .from("nutrition_plan_edits")
          .select("id", head)
          .in("status", ["pending", "generating"])
          .lt("updated_at", ago(60)),
      ),
      count(
        db
          .from("program_intel_jobs")
          .select("id", head)
          .in("status", ["pending", "running"])
          .lt("updated_at", ago(120)),
      ),
      count(
        db
          .from("program_ai_edits")
          .select("id", head)
          .in("status", ["pending", "running"])
          .lt("updated_at", ago(60)),
      ),
      count(
        db
          .from("community_post_decks")
          .select("id", head)
          .eq("status", "running")
          .lt("claimed_at", ago(45)),
      ),
      count(
        db
          .from("coaching_lead_replies")
          .select("application_id", head)
          .in("status", ["pending", "generating"])
          .lt("updated_at", ago(60)),
      ),
      count(
        db
          .from("program_imports")
          .select("id", head)
          .in("status", ["pending", "reading"])
          .lt("updated_at", ago(60)),
      ),
      count(
        db
          .from("nutrition_imports")
          .select("id", head)
          .in("status", ["pending", "reading"])
          .lt("updated_at", ago(60)),
      ),
    ]);
  return {
    coaching_replies: replies,
    checkin_recaps: recaps,
    nutrition_plans: plans,
    nutrition_plan_changes: planEdits,
    program_generations: generations,
    program_adjustments: edits,
    post_decks: decks,
    lead_texts: leads,
    program_imports: pImports,
    meal_imports: mImports,
  };
}

const STUCK_NAMES: Record<string, string> = {
  coaching_replies: "coaching replies",
  checkin_recaps: "check-in recaps",
  nutrition_plans: "nutrition plans",
  nutrition_plan_changes: "nutrition plan changes",
  program_generations: "program generations",
  program_adjustments: "program adjustments",
  post_decks: "Crew post decks",
  lead_texts: "lead texts",
  program_imports: "program imports",
  meal_imports: "meal plan imports",
};

/** Winnipeg calendar day of an instant (YYYY-MM-DD). */
function dayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

async function usageAlerts(db: Db, report: TickReport): Promise<void> {
  const since = new Date(Date.now() - 16 * 86_400_000).toISOString();
  const rows: { at: string; cost_usd: number | null; task: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("ai_call_log")
      .select("at, cost_usd, task")
      .gte("at", since)
      .neq("task", "probe")
      .order("at", { ascending: true })
      .range(from, from + 999);
    rows.push(...((data ?? []) as any[]));
    if (!data || data.length < 1000) break;
  }
  const today = dayOf(new Date().toISOString());
  const byDay = new Map<string, { cost: number; calls: number }>();
  for (const r of rows) {
    const d = dayOf(r.at);
    const v = byDay.get(d) ?? { cost: 0, calls: 0 };
    v.cost += Number(r.cost_usd ?? 0);
    v.calls += 1;
    byDay.set(d, v);
  }
  const history: { cost: number; calls: number }[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = dayOf(new Date(Date.now() - i * 86_400_000).toISOString());
    history.push(byDay.get(d) ?? { cost: 0, calls: 0 });
  }
  const u = unusualUsage(byDay.get(today) ?? { cost: 0, calls: 0 }, history);
  report.alerts.ai_unusual_usage = await alert(
    db,
    "ai_unusual_usage",
    u.unusual,
    u.why
      ? `AI use is unusual today: ${u.why}. Check Settings → AI & Cleo for what's using it.`
      : "AI use is back to usual",
    { usual_cost: u.usualCost, usual_calls: u.usualCalls },
  );
  if (u.unusual)
    await pushOwners(
      db,
      {
        title: "AI use is unusual today",
        body: `${u.why}. Tap to see what's using it.`,
        url: "/admin/settings/ai",
        tag: "ai-usage",
      },
      `ai_usage:${today}`,
    );

  // the month's budget, when one is set
  const { data: b } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "ai_budget")
    .maybeSingle();
  let budget = 0;
  try {
    budget = Number(JSON.parse(b?.value ?? "{}")?.monthly_usd ?? 0);
  } catch {
    budget = 0;
  }
  if (budget > 0) {
    const month = today.slice(0, 7);
    const monthRows: { cost_usd: number | null }[] = [];
    const start = new Date(Date.now() - 32 * 86_400_000).toISOString();
    for (let from = 0; ; from += 1000) {
      const { data } = await db
        .from("ai_call_log")
        .select("at, cost_usd")
        .gte("at", start)
        .order("at", { ascending: true })
        .range(from, from + 999);
      monthRows.push(...((data ?? []) as any[]).filter((r) => dayOf(r.at).startsWith(month)));
      if (!data || data.length < 1000) break;
    }
    const spent = monthRows.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0);
    const share = spent / budget;
    const level = share >= 1 ? 100 : share >= 0.8 ? 80 : 0;
    report.alerts.ai_budget = await alert(
      db,
      "ai_budget",
      level > 0,
      level
        ? `AI spend this month is about $${spent.toFixed(2)} of your $${budget.toFixed(0)} budget (${Math.round(share * 100)}%).`
        : "Under 80% of the month's AI budget",
      { spent: Math.round(spent * 100) / 100, budget },
    );
    if (level)
      await pushOwners(
        db,
        {
          title:
            level === 100
              ? "AI budget reached this month"
              : "AI spend at 80% of this month's budget",
          body: `About $${spent.toFixed(2)} of $${budget.toFixed(0)} so far. Tap to see what's using it.`,
          url: "/admin/settings/ai",
          tag: "ai-budget",
        },
        `ai_budget:${month}:${level}`,
      );
  }
}

export async function runAiHealthTick(
  db: Db,
  opts: { forceProbe?: boolean } = {},
): Promise<TickReport> {
  const report: TickReport = {
    probed: false,
    openai: "ok",
    alerts: {},
    recovery: null,
    stuck: {},
    healed: {},
  };
  let health = await readHealth({ fresh: true });
  let h = health.get("openai")!;

  // 1. probe a down provider when it's due (or when the owner taps Check now)
  if (
    h.status !== "ok" &&
    (opts.forceProbe || !h.next_probe_at || new Date(h.next_probe_at).getTime() <= Date.now()) &&
    process.env.OPENAI_API_KEY
  ) {
    report.probed = true;
    await probeOpenAi();
    clearHealthCache();
    health = await readHealth({ fresh: true });
    h = health.get("openai")!;
  } else if (opts.forceProbe && process.env.OPENAI_API_KEY) {
    report.probed = true;
    await probeOpenAi();
    clearHealthCache();
    health = await readHealth({ fresh: true });
    h = health.get("openai")!;
  }
  report.openai = h.status;

  // 2. down / back alerts
  if (h.status !== "ok") {
    const waiting = await waitingCounts(db);
    const what = listWords(waiting, WORK_NAMES);
    const how =
      h.status === "credits"
        ? "Add credits at platform.openai.com → Settings → Billing (turning on auto-recharge stops this happening again)."
        : h.status === "auth"
          ? "Check the OPENAI_API_KEY secret in Lovable's project settings."
          : "It usually comes back by itself; nothing to do yet.";
    const message = `AI is paused since ${localTime(h.since)}: ${wordsFor(h.status)}. ${what ? `Waiting: ${what}. ` : ""}${how} Everything waiting is redone automatically once it answers, and replies still wait for your OK.`;
    report.alerts.ai_unavailable = await alert(db, "ai_unavailable", true, message, {
      status: h.status,
      since: h.since,
      waiting,
    });
    if (!h.alerted_at) {
      await pushOwners(
        db,
        {
          title:
            h.status === "credits"
              ? "OpenAI credits ran out"
              : h.status === "auth"
                ? "The OpenAI key was refused"
                : "OpenAI isn't answering",
          body: `AI drafts are paused. ${how}`.slice(0, 220),
          url: "/admin/settings/ai",
          tag: "ai-health",
        },
        `ai_down:${h.since}`,
      );
      await db
        .from("ai_provider_health")
        .update({ alerted_at: new Date().toISOString() })
        .eq("provider", "openai");
    }
  } else {
    report.alerts.ai_unavailable = await alert(
      db,
      "ai_unavailable",
      false,
      "OpenAI answers again",
      {},
    );
  }

  // 3. recovery after an incident (and the recaps it couldn't finish last tick)
  if (
    h.status === "ok" &&
    h.recovered_at &&
    (!h.recovery_done_at || new Date(h.recovered_at) > new Date(h.recovery_done_at))
  ) {
    try {
      report.recovery = await recover(db, h);
    } catch (e: any) {
      console.error("[ai-health] recovery failed", e?.message);
      await db
        .from("ai_provider_health")
        .update({ recovery_started_at: null })
        .eq("provider", "openai");
    }
  } else if (h.status === "ok") {
    // 4. self-healing: a recap that never ran (the client closed the app before it was asked for)
    const r = await redoRecaps(db, 2);
    if (r.done || r.failed) report.healed.checkin_recaps = r.done;
  }

  // 5. stuck jobs
  report.stuck = await stuckJobs(db);
  const stuck = Object.entries(report.stuck).filter(([, n]) => n > 0);
  report.alerts.ai_stuck_jobs = await alert(
    db,
    "ai_stuck_jobs",
    stuck.length > 0,
    stuck.length
      ? `Stuck and not moving: ${stuck.map(([k, n]) => `${n} ${STUCK_NAMES[k] ?? k}`).join(", ")}. Each queue retries its own; these are past that.`
      : "Nothing stuck",
    { stuck: report.stuck },
  );

  // 6. failures while the provider answers (a third of the last hour's calls, at least 5)
  if (h.status === "ok") {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { data } = await db
      .from("ai_call_log")
      .select("ok, failure, task")
      .gte("at", hourAgo)
      .neq("task", "probe")
      .limit(2000);
    const calls = ((data ?? []) as any[]).filter((r) => r.failure !== "paused");
    const failed = calls.filter((r) => !r.ok);
    const bad = failed.length >= 5 && failed.length / Math.max(1, calls.length) >= 0.3;
    const byTask = [...new Set(failed.map((r) => r.task))].slice(0, 4).join(", ");
    report.alerts.ai_failures = await alert(
      db,
      "ai_failures",
      bad,
      bad
        ? `${failed.length} of ${calls.length} AI calls failed in the last hour (${byTask}).`
        : "AI calls are succeeding",
      { failed: failed.length, calls: calls.length },
    );
    if (bad)
      await pushOwners(
        db,
        {
          title: "AI calls are failing",
          body: `${failed.length} of ${calls.length} in the last hour. Tap to see which.`,
          url: "/admin/settings/ai",
          tag: "ai-failures",
        },
        `ai_failures:${dayOf(new Date().toISOString())}:${new Date().getUTCHours() >> 2}`,
      );
  }

  // 7. usage and budget (hourly is plenty)
  if (new Date().getUTCMinutes() < 5 || opts.forceProbe) await usageAlerts(db, report);

  // 8. keep about 13 months of calls (the monthly trend)
  if (new Date().getUTCHours() === 9 && new Date().getUTCMinutes() < 5) {
    await db
      .from("ai_call_log")
      .delete()
      .lt("at", new Date(Date.now() - 400 * 86_400_000).toISOString());
  }
  return report;
}
