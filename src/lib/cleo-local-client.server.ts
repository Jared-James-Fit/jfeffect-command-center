import { localClientIntent, type LocalIntent, type LocalTopic } from "@/lib/cleo-local-intent";
import { assertRequesterReaches } from "@/lib/cleo-actions.server";
import { localAttemptAnswer } from "@/lib/cleo-local-attempts.server";
import { cleoReadTools } from "@/lib/cleo-tools.server";

type Db = any;
type Context = { db: Db; admin: Db; requester: string; clientId: string; coach: boolean; question: string; attachments?: boolean; intent?: LocalIntent };
type Reply = { text: string; choices?: string[] };

const LABEL: Record<LocalTopic, string> = {
  setup: "Account setup", attempts: "Attempt selection", competition: "Competition records",
  profile: "Client file", strength: "Strength", training: "Training history", program: "Training program",
  records: "Personal records", weight: "Bodyweight", nutrition: "Nutrition", cardio: "Cardio",
  checkins: "Check-ins", goals: "Goals", meetings: "Meetings", messages: "Coach-client messages", purchases: "Billing",
};

const SOURCE: Record<LocalTopic, string> = {
  setup: "Account setup → client profile, service enrollments, membership setup, goals and handling intake",
  attempts: "Competition → gameplan versions, recorded attempt sources, and competition forecast for an unsaved draft",
  competition: "Competition → recorded meets and results",
  profile: "Client file → profile, maxes on file and coach notes",
  strength: "Strength intelligence → logged performance and maxes on file",
  training: "Training log → completed set entries and session feedback",
  program: "Training program → dated workouts and blocks (prescribed, not necessarily performed)",
  records: "Personal records → finished workout records",
  weight: "Progress → portal weigh-ins and coach-entered bodyweight metrics",
  nutrition: "Nutrition → saved nutrition targets, day types and weight-management records",
  cardio: "Cardio → active prescribed targets; weekly total is duration × frequency",
  checkins: "Check-ins → submissions, form answers and workout feedback",
  goals: "Goals → saved goal ledger, versions and statuses",
  meetings: "Meetings → completed session analysis, recorded decisions and follow-ups",
  messages: "Messages → coach-client thread and authorized staff notes",
  purchases: "Billing → purchase records and session credits",
};

const MENU = ["Client overview", "Explain attempt selection", "Review account setup", "Training progress", "Current nutrition", "Goals and check-ins"];
const MENU_TEXT = "I can review this client's existing records in JF Effect: setup, competitions, training, nutrition, cardio, goals, check-ins, meetings and coach-client messages.";

async function setupAnswer(db: Db, admin: Db, clientId: string): Promise<string> {
  const { isBasicInfoComplete } = await import("@/lib/basic-info");
  const { isGoalsSetupComplete } = await import("@/lib/client-goals/schema");
  const { accountSetupRequirements } = await import("@/lib/account-setup-scope");
  const { memberSetupSummary } = await import("@/lib/member-setup-steps");
  const [client, goals, enrollments] = await Promise.all([
    db.from("clients").select("id, user_id, last_signed_in_at, portal_access_disabled, profile_picture_url, service_tier, first_name, last_name, phone, date_of_birth, height_cm, address, city, country, timezone, emergency_contact_name, emergency_contact_phone, training_schedule_completed").eq("id", clientId).maybeSingle(),
    db.from("client_goals_setup").select("*").eq("client_id", clientId).maybeSingle(),
    (admin as any).from("coaching_package_enrollments").select("coaching_packages!inner(slug)").eq("client_id", clientId).eq("status", "active").lte("starts_on", new Date().toISOString().slice(0, 10)),
  ]);
  if (client.error || !client.data) throw new Error("Couldn't read the client's setup.");
  const c = client.data;
  const status = (done: boolean, label: string) => done ? "✓ " + label + " — complete" : "○ " + label + " — outstanding";
  const lines = [
    "Client setup (checked internally):",
    c.portal_access_disabled ? "○ Account access — disabled" : status(!!c.last_signed_in_at, "Account sign-in"),
  ];
  const { loadHandlingSetup } = await import("@/lib/competition/handling-setup.server");
  const handlingMeets = await loadHandlingSetup(admin, clientId);
  if (enrollments.error) throw new Error("Could not read service scope");
  const req = accountSetupRequirements(c.service_tier, (enrollments.data ?? []).map((e: any) => e.coaching_packages?.slug ?? ""), handlingMeets.length > 0);
  if (req.basicInfo) lines.push(status(isBasicInfoComplete(c), "Basic information"));
  if (req.headshot) lines.push(status(!!c.profile_picture_url, "Account photo"));
  if (req.memberSetup && c.user_id) {
    const member = await admin.from("app_members").select("account_type, is_admin_sandbox, subscription_status, stripe_subscription_id, avatar_url, phone, sms_opt_out, sms_consent_at, date_of_birth, address_line1, emergency_contact_name, emergency_contact_phone, goals, goals_tags, experience_level, training_background, committed_training_days").eq("user_id", c.user_id).maybeSingle();
    if (member.error) lines.push("Membership setup — couldn’t verify");
    else {
      const summary = memberSetupSummary(member.data);
      if (summary.applicable) {
        lines.push(status(summary.complete, summary.free ? "Training setup" : "Membership setup"));
        if (summary.missing.length) lines.push("Remaining: " + summary.missing.map(s => s.replace(/_/g, " ")).join(", "));
      }
    }
  }
  for (const meet of handlingMeets) {
    lines.push(status(meet.intakeDone, `Competition intake: ${meet.name}`), status(meet.termsDone, "Handling terms"));
    if (meet.remaining.length) lines.push("Remaining: " + meet.remaining.join(", "));
  }
  if (req.generalGoals) {
    const nutritionOnly = req.nutritionOnly;
    if (req.trainingSchedule) lines.push(status(!!c.training_schedule_completed, "Training schedule"));
    const label = nutritionOnly ? "Nutrition setup" : "Goals & setup";
    lines.push(goals.error ? label + " — couldn't verify" : status(isGoalsSetupComplete(goals.data, nutritionOnly), label));
  }
  lines.push("Check the Client setup card for agreement status and to request outstanding details.");

  return lines.join("\n");
}

async function competitionAnswer(db: Db, clientId: string): Promise<string> {
  const { data, error } = await db.from("competitions")
    .select("name, meet_date, meet_end_date, status, federation, weight_class, division, registration, session_label, flight, weigh_in_at, lifting_start, location, target_total_kg, results")
    .eq("client_id", clientId)
    .or("internal_test.eq.false,name.not.ilike.Validation rehearsal:*")
    .order("meet_date", { ascending: false }).limit(12);
  if (error) throw new Error("Competition records unavailable");
  if (!data?.length) return "No competitions are recorded for this client.";
  return data.map((c: any) => [
    "**" + c.name + " · " + c.meet_date + "**",
    [c.status, c.registration, c.federation, c.division, c.weight_class].filter(Boolean).join(" · "),
    c.location ? "Venue: " + c.location : null,
    c.weigh_in_at ? "Weigh-in: " + c.weigh_in_at : null,
    c.lifting_start ? "Lifting starts: " + c.lifting_start : null,
    [c.session_label, c.flight ? "Flight " + c.flight : null].filter(Boolean).join(" · "),
    c.target_total_kg != null ? "Target total: " + c.target_total_kg + " kg" : null,
    c.results ? "Recorded results: " + JSON.stringify(c.results).slice(0, 800) : null,
  ].filter(Boolean).join("\n")).join("\n\n");
}

async function cardioAnswer(db: Db, clientId: string, today: string): Promise<string> {
  const { data, error } = await db.from("cardio_targets")
    .select("duration_minutes, frequency_per_week, scheduled_weekdays, enabled, status, start_date, end_date")
    .eq("client_id", clientId).order("start_date", { ascending: false }).limit(40);
  if (error) throw new Error("Cardio targets unavailable");
  const active = (data ?? []).filter((c: any) => c.enabled !== false
    && !/archived|ended|inactive/i.test(String(c.status ?? ""))
    && String(c.start_date ?? "") <= today && (!c.end_date || String(c.end_date) >= today));
  if (!active.length) return "No active cardio targets on file.";
  let weekly = 0;
  const lines = active.map((c: any) => {
    const frequency = Number(c.frequency_per_week) || (Array.isArray(c.scheduled_weekdays) ? c.scheduled_weekdays.length : 0);
    weekly += (Number(c.duration_minutes) || 0) * frequency;
    return "- " + (c.duration_minutes ?? "—") + " min × " + frequency + " sessions/week" + (c.scheduled_weekdays?.length ? " · " + c.scheduled_weekdays.join(", ") : "") + " · " + (c.start_date ?? "no start date");
  });
  return ["Current prescribed cardio: " + weekly + " minutes/week (not actual completed cardio).", ...lines].join("\n");
}

/** Reuse the same existing, role-filtered, internal read implementations as Cleo.
 * No model, prompt, external file extraction, external search, tool selection by a
 * model, arbitrary table access, cross-client reads or write proposals.
 */
export async function localClientReply(ctx: Context): Promise<Reply> {
  const { db, admin, requester, clientId, coach } = ctx;
  await assertRequesterReaches(admin, requester, clientId);
  const intent = ctx.intent ?? localClientIntent(ctx.question);
  if (ctx.attachments) return { text: "I can review saved records internally, but I can't analyze a new attachment in internal mode. " + MENU_TEXT, choices: MENU.slice(0, 4) };
  if (intent.action) return { text: "I haven't made any changes. This conversation is in internal read-only mode; I can show the relevant existing records, but can't generate or execute that change here. " + MENU_TEXT, choices: MENU.slice(0, 4) };
  const topics = intent.topics.filter(t => !(coach && t === "purchases"));
  if (!topics.length) {
    if (!coach && !intent.topics.length) {
      const { readAdminEvidence } = await import("@/lib/cleo-admin-evidence.server");
      try {
        const evidence = await readAdminEvidence(db, requester, clientId, ctx.question);
        if (evidence) return { text: "Here are the matching records for this client. These are stored values, not a new AI recommendation.\n\n" + evidence };
      } catch { /* catalog unavailable; don't invent records */ }
      return { text: "I couldn't identify a reliable client record for that question. Which detail are you looking for? I'll check the relevant records without guessing." };
    }
    return { text: intent.topics.includes("purchases") ? "Billing is available to authorized admins, not coaches." : "I can work with the existing records here, but I can't provide unrestricted free-form analysis in internal mode. " + MENU_TEXT, choices: MENU.slice(0, 4) };
  }
  const tz = "America/Winnipeg";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const tools = cleoReadTools({ db, tz, today, caller: requester, money: !coach, clientActions: true, scopeClientId: clientId }) as unknown as Record<string, { execute?: (args: any, options: any) => Promise<string> }>;
  const run = async (tool: string, args: Record<string, unknown> = {}) => {
    const execute = tools[tool]?.execute;
    if (!execute) throw new Error("Reader unavailable");
    return (await execute({ ...args, client_id: clientId }, { toolCallId: "internal-read", messages: [] }))
      .replace(/ Tell the person you couldn't load it; don't guess\.$/, "");
  };
  const read = async (topic: LocalTopic): Promise<string> => {
    switch (topic) {
      case "setup": return setupAnswer(db, admin, clientId);
      case "attempts": return localAttemptAnswer(admin, requester, clientId);
      case "competition": return competitionAnswer(db, clientId);
      case "profile": return run("client_file");
      case "strength": return run("strength");
      case "training": return run("training_log", { days: intent.days ?? (intent.exercise ? 60 : 21), exercise: intent.exercise });
      case "program": return run("training_program", { date: intent.date });
      case "records": return run("personal_records", { days: Math.max(7, intent.days ?? 60) });
      case "weight": return run("body_weight", { days: Math.max(7, intent.days ?? 90) });
      case "nutrition": return run("nutrition");
      case "cardio": return cardioAnswer(db, clientId, today);
      case "checkins": return run("check_ins", { limit: 3 });
      case "goals": return run("goals", { details: true });
      case "meetings": return run("meetings", { limit: 5 });
      case "messages": return run("message_thread", { limit: 20 });
      case "purchases": return run("purchases");
    }
  };
  // Keep the response focused. A broad request can continue with another topic.
  const selected = topics.slice(0, coach ? 3 : 6);
  const results = await Promise.all(selected.map(async t => {
    try {
      const answer = await read(t);
      const clipped = answer.length > 8000 ? answer.slice(0, 8000) + "\n… (additional records omitted; ask for a narrower range)" : answer;
      return "**" + LABEL[t] + "**\n\n" + clipped + "\n\nSource checked: " + SOURCE[t] + ".";
    }
    catch { return "**" + LABEL[t] + "**\n\nCouldn't verify this section from the current records. Try again or open the corresponding client tab."; }
  }));
  const tail = topics.length > selected.length ? "\n\nAlso available: " + topics.slice(selected.length).map(t => LABEL[t]).join(", ") + "." : "";
  const followup = intent.followup
    ? "Here is the recorded basis for the " + selected.map(t => LABEL[t].toLowerCase()).join(" and ") + " we were discussing. This is a fresh read of the records; if they have changed, it may not reproduce the exact earlier figures.\n\n"
    : "";
  return { text: followup + results.join("\n\n") + tail + "\n\n_Read from this client's existing JF Effect records. No external AI processing or changes made._" };
}
