/**
 * Writes a lead's brief and texts (coaching-leads.ts) in the background,
 * never inside the applicant's or the coach's request: a new application is
 * queued by the database (`coaching_lead_replies_queue`), the coach's Write
 * again re-queues it, and the lead-replies-tick hook runs one at a time
 * (`coaching_lead_replies_run`, called at once through pg_net and every
 * 5 minutes by pg_cron while one waits). The first reply pushes the coach
 * (`lead_ready`, opens the lead).
 */
import { casualize } from "@/lib/coach-voice";
import {
  LEAD_MAX_ATTEMPTS,
  LEAD_REPLY_PROMPT,
  LEAD_STALE_MS,
  bookingUrl,
  keepOnlyBookingLink,
  leadUserPrompt,
  parseLeadReply,
  type LeadApplication,
} from "@/lib/coaching-leads";

export const LEAD_APP_COLUMNS =
  "id, created_at, full_name, first_name, email, phone, instagram, main_goal, target_outcome, timeline, lead_score, lead_temperature, qualification_label, recommended_offer, status, call_status, follow_up_at, client_id, is_test, source_label, booking_link_slug";

/** The discovery-call link, only while that booking type is live online. */
export async function leadBookingUrl(sb: any, slug: string | null | undefined): Promise<string | null> {
  const want = slug || "coaching-discovery";
  const { data } = await sb
    .from("booking_cards")
    .select("slug, is_active, online_enabled")
    .eq("slug", want)
    .maybeSingle();
  return data?.is_active && data?.online_enabled ? bookingUrl(data.slug) : null;
}

type Claimable = { application_id: string; status: string; updated_at: string; attempts: number | null; instructions: string | null; generated_at: string | null };

function claimable(r: Claimable, now: number): boolean {
  const age = now - Date.parse(r.updated_at);
  if (r.status === "pending") return true;
  if (r.status === "generating") return age > LEAD_STALE_MS;
  // A failed try is retried after a pause, a few times.
  return r.status === "error" && (r.attempts ?? 0) < LEAD_MAX_ATTEMPTS && age > LEAD_STALE_MS;
}

/** One lead per call: the one asked for, else the oldest waiting. */
export async function runQueuedLead(sb: any, applicationId: string | null, now = Date.now()) {
  const cols = "application_id, status, updated_at, attempts, instructions, generated_at";
  let row: Claimable | null = null;
  if (applicationId) {
    const { data } = await sb.from("coaching_lead_replies").select(cols).eq("application_id", applicationId).maybeSingle();
    row = data && claimable(data, now) ? data : null;
  } else {
    const { data } = await sb
      .from("coaching_lead_replies")
      .select(cols)
      .in("status", ["pending", "generating", "error"])
      .gte("updated_at", new Date(now - 2 * 86_400_000).toISOString())
      .order("updated_at", { ascending: true })
      .limit(20);
    row = ((data ?? []) as Claimable[]).find((r) => claimable(r, now)) ?? null;
  }
  if (!row) return { status: "idle" as const };

  // Claim it with one conditional update: whoever changes this exact version first runs it.
  const claimedAt = new Date(now).toISOString();
  const attempts = row.status === "pending" ? 1 : (row.attempts ?? 0) + 1;
  const { data: claimed } = await sb
    .from("coaching_lead_replies")
    .update({ status: "generating", attempts, updated_at: claimedAt })
    .eq("application_id", row.application_id)
    .eq("status", row.status)
    .eq("updated_at", row.updated_at)
    .select("application_id")
    .maybeSingle();
  if (!claimed) return { status: "taken" as const };
  return writeLead(sb, row, claimedAt, attempts);
}

async function writeLead(sb: any, row: Claimable, claimedAt: string, attempts: number) {
  const id = row.application_id;
  // A newer request (the coach's Write again) wins: only finish the version we claimed.
  const finish = (patch: Record<string, unknown>) =>
    sb
      .from("coaching_lead_replies")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("application_id", id)
      .eq("updated_at", claimedAt)
      .select("application_id")
      .maybeSingle();
  try {
    const { data: app } = await sb.from("coaching_applications").select(LEAD_APP_COLUMNS).eq("id", id).maybeSingle();
    if (!app) throw new Error("Application not found");
    const lead = app as LeadApplication;
    const booking = await leadBookingUrl(sb, lead.booking_link_slug);

    const { voicePromptForClient } = await import("@/lib/coach-voice.functions");
    const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
    const { generateText } = await import("ai");
    const [voice, { data: g }] = await Promise.all([
      voicePromptForClient(sb, lead.client_id),
      sb.from("global_ai_config").select("default_model").limit(1).maybeSingle(),
    ]);
    const modelId = g?.default_model || DEFAULT_AI_MODEL;
    const t = await generateText({
      model: createLovableAiGateway()(modelId),
      system: `${LEAD_REPLY_PROMPT}\n\nYOUR VOICE FOR THE TWO TEXTS (the read stays plain and clear):\n${voice}`,
      prompt: leadUserPrompt(lead, { bookingUrl: booking, instructions: row.instructions }),
    });
    const parsed = parseLeadReply(t.text);
    if (!parsed) throw new Error("The AI's answer didn't read as a reply");

    const { data: done } = await finish({
      status: "ready",
      brief: parsed.brief,
      reply: keepOnlyBookingLink(casualize(parsed.text), booking),
      follow_up: parsed.followUp ? keepOnlyBookingLink(casualize(parsed.followUp), booking) : null,
      model: modelId,
      error: null,
      generated_at: new Date().toISOString(),
    });
    // The first reply for a lead tells the coach (once: deduped per application).
    if (done && !row.generated_at && lead.client_id && !lead.is_test) {
      const { notifyAppEvent } = await import("@/lib/push/app-events.server");
      await notifyAppEvent(sb, "lead_ready", { clientId: lead.client_id, sourceId: id });
    }
    return { status: done ? ("ready" as const) : ("superseded" as const) };
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 500);
    await finish({ status: "error", error, attempts });
    return { status: "error" as const, error };
  }
}
