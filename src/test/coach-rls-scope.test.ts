import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A coach may only reach their own clients' data (is_assigned_coach*). This
// replays every CREATE/DROP POLICY in migration order and fails when a policy
// lets coaches in on role alone, unless the table is a team-wide or config
// table listed below. Adding a client-data table to the list needs a reason.
const TEAM_WIDE_TABLES = new Set([
  // config / library / templates
  "app_settings", "booking_cards", "chat_gifs", "chat_sounds", "coach_faqs", "coach_task_definitions",
  "coach_voice", "form_ai_configs", "global_ai_config", "jurisdiction_profiles", "legal_module_versions",
  "legal_modules", "member_access_defaults", "na_template_versions", "na_templates",
  "nutrition_automation_settings", "nutrition_target_settings", "pl_template_shares", "warmup_protocols",
  "resources", "resource_folders", "resource_comments", "worker_runs",
  // team-wide spaces: group chats, events, staff tasks, media
  "chat_groups", "chat_group_members", "group_messages", "group_message_reactions", "mass_message_log",
  "events", "event_assignments", "event_deadlines", "event_format_prompts", "event_popup_acks",
  "event_quick_links", "event_reminders", "tasks", "task_comments", "task_subtasks",
  "media_activity_events", "media_content_comments", "media_content_records", "media_content_review_events",
  // community is one shared space any coach moderates
  "community_posts", "community_birthday_posts",
  // members have no assigned coach; support inbox is team-wide (open question in the PR)
  "member_support_threads", "member_support_messages",
  // storage: chat sounds and resource library buckets
  "storage.objects",
]);

const DIRS = [join(process.cwd(), "drizzle/migrations"), join(process.cwd(), "supabase/migrations")];
const IDENT = String.raw`(?:"[^"]+"|[\w.]+)`;
const unq = (s: string) => s.replace(/^"|"$/g, "").replace(/^public\./, "");

function statements(sql: string): string[] {
  const clean = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
  const out: string[] = [];
  let buf = "";
  let tag: string | null = null;
  for (const part of clean.split(/(\$[A-Za-z_]*\$)/)) {
    if (/^\$[A-Za-z_]*\$$/.test(part)) {
      if (tag === null) tag = part;
      else if (part === tag) tag = null;
      buf += part;
      continue;
    }
    if (tag !== null) { buf += part; continue; }
    const segs = part.split(";");
    segs.forEach((seg, i) => {
      buf += seg;
      if (i < segs.length - 1) { out.push(buf.replace(/\s+/g, " ").trim()); buf = ""; }
    });
  }
  out.push(buf.replace(/\s+/g, " ").trim());
  return out;
}

function livePolicies(): Map<string, { file: string; sql: string }> {
  const live = new Map<string, { file: string; sql: string }>();
  const files = DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".sql")).sort().map((f) => join(d, f)));
  for (const path of files) {
    const file = path.slice(process.cwd().length + 1);
    for (const st of statements(readFileSync(path, "utf8"))) {
      let m = new RegExp(`^create policy (${IDENT}) on (${IDENT})`, "i").exec(st);
      if (m) { live.set(`${unq(m[2])}|${unq(m[1])}`, { file, sql: st }); continue; }
      m = new RegExp(`^drop policy (?:if exists )?(${IDENT}) on (${IDENT})`, "i").exec(st);
      if (m) { live.delete(`${unq(m[2])}|${unq(m[1])}`); continue; }
      m = new RegExp(`^drop table (?:if exists )?(${IDENT})`, "i").exec(st);
      if (m) for (const k of [...live.keys()]) if (k.startsWith(`${unq(m[1])}|`)) live.delete(k);
    }
  }
  return live;
}

const ROLE_ONLY_COACH = /'coach'|is_coach_or_admin|is_community_staff|can_manage_group/i;
const ASSIGNED = /is_assigned_coach|assigned_coach_id/i;

describe("coach RLS scope", () => {
  const live = livePolicies();

  it("finds the policy set", () => {
    expect(live.size).toBeGreaterThan(500);
  });

  it("no client-data table lets coaches in on role alone", () => {
    const leaks = [...live.entries()]
      .filter(([k, v]) => !TEAM_WIDE_TABLES.has(k.split("|")[0]) && ROLE_ONLY_COACH.test(v.sql) && !ASSIGNED.test(v.sql))
      .map(([k, v]) => `${k} (${v.file})`);
    expect(leaks).toEqual([]);
  });

  it("support_alerts no longer ORs in every coach", () => {
    const sel = live.get("support_alerts|Coaches view alerts for their clients")!.sql;
    expect(sel).toMatch(/is_assigned_coach/);
    expect(sel).not.toMatch(/is_coach_or_admin/);
  });

  it("progress policies use the coaches.id mapping, not auth.uid()", () => {
    const bad = [...live.entries()]
      .filter(([, v]) => /assigned_coach_id\s*=\s*auth\.uid\(\)/i.test(v.sql))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("coaches have no access to the member payment ledger", () => {
    const coachLedger = [...live.entries()]
      .filter(([k, v]) => k.startsWith("member_payment_ledger|") && /'coach'|is_assigned_coach/i.test(v.sql))
      .map(([k]) => k);
    expect(coachLedger).toEqual([]);
  });
});
