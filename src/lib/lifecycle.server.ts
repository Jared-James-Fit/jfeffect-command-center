/**
 * Server side of the account lifecycle (lifecycle.functions.ts calls these):
 * who may act on an account, the review read from the database, stopping
 * Stripe subscriptions, and telling the coach. Load inside handlers only.
 *
 * Order of every action: decide → Stripe → database → tell. If Stripe
 * refuses, nothing in the app changes, so an account is never deactivated
 * or binned while its subscription keeps charging.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountReview, lifecycleNote, type AccountReview, type LifecycleKind, type SubscriptionAction } from "@/lib/account-review";
import { buildClientPayments, type ScheduleSale } from "@/lib/payment-schedule";
import { formatMoney } from "@/lib/payment-display";
import { readClientBilling } from "@/lib/my-billing.functions";

type Db = SupabaseClient<any, any, any>;

export type LifecycleClient = {
  id: string;
  user_id: string | null;
  full_name: string | null;
  first_name: string | null;
  preferred_name: string | null;
  status: string | null;
  service_tier: string | null;
  assigned_coach_id: string | null;
  deactivation_source: string | null;
  deactivate_at: string | null;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  deactivation_note: string | null;
  created_at: string | null;
};

export type LifecycleActor = {
  who: "self" | "staff";
  role: "self" | "coach" | "admin";
  userId: string;
  name: string | null;
};

const CLIENT_COLUMNS =
  "id, user_id, full_name, first_name, preferred_name, status, service_tier, assigned_coach_id, deactivation_source, deactivate_at, deactivated_at, deactivation_reason, deactivation_note, created_at";

/** The coach's today, Manitoba (fixed UTC-5 from Nov 1, 2026). */
export const coachToday = (now = Date.now()) => new Date(now - 5 * 3_600_000).toISOString().slice(0, 10);

export const firstNameOf = (c: Pick<LifecycleClient, "preferred_name" | "first_name" | "full_name">) =>
  (c.preferred_name || c.first_name || (c.full_name ?? "").split(" ")[0] || "They").trim();

/** Staff logins (any role but client) and a coach's linked athlete login are managed from Team. */
async function isStaffLogin(admin: Db, userId: string): Promise<boolean> {
  const [{ data: roles }, { data: linked }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("community_profiles").select("same_person_as").eq("user_id", userId).not("same_person_as", "is", null).maybeSingle(),
  ]);
  return (roles ?? []).some((r: any) => r.role !== "client") || !!linked;
}

/**
 * Whose account, and may this login act on it: the person themselves (never a
 * team login), an admin, or the client's own coach. Everything else is refused.
 */
export async function resolveLifecycle(
  admin: Db,
  userId: string,
  clientId: string | undefined,
): Promise<{ client: LifecycleClient; actor: LifecycleActor }> {
  let client: LifecycleClient | null = null;
  if (clientId) {
    const { data } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle();
    client = (data as LifecycleClient | null) ?? null;
  } else {
    const { data } = await admin.from("clients").select(CLIENT_COLUMNS).eq("user_id", userId).order("created_at").limit(1).maybeSingle();
    client = (data as LifecycleClient | null) ?? null;
  }
  if (!client) throw new Error("Account not found");

  const [{ data: isAdmin }, { data: coach }, { data: prof }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    admin.from("coaches").select("id, full_name").eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  const name = ((coach as any)?.full_name || (prof as any)?.full_name || null) as string | null;

  if (client.user_id && client.user_id === userId) {
    if (await isStaffLogin(admin, userId)) {
      throw new Error("Team accounts are managed by the owner from Team, not here.");
    }
    return { client, actor: { who: "self", role: "self", userId, name } };
  }
  if (isAdmin) return { client, actor: { who: "staff", role: "admin", userId, name } };
  if (coach && client.assigned_coach_id && (coach as any).id === client.assigned_coach_id) {
    return { client, actor: { who: "staff", role: "coach", userId, name } };
  }
  throw new Error("You can't change this account.");
}

/** The review, from the database: the client's billing read with the caller's own login, sessions as the server sees them. */
export async function reviewFor(
  userDb: Db,
  admin: Db,
  client: LifecycleClient,
  kind: LifecycleKind,
  who: "self" | "staff",
  opts: { when?: "now" | "paid_through"; stopAutoPay?: boolean } = {},
): Promise<{ review: AccountReview; sales: any[] }> {
  const billing = await readClientBilling(userDb, client.id);
  const today = coachToday();
  const now = new Date().toISOString();
  const sales = billing.sales as unknown as ScheduleSale[];
  const payments = buildClientPayments({
    sales,
    ledger: billing.ledger as any[],
    balance: billing.session_balance as any[],
    events: billing.session_events as any[],
    today,
  });
  // Every booked session from now on, hidden ones too: they're the ones that get cancelled.
  const { data: sessions } = await admin
    .from("pt_sessions")
    .select("id, status, starts_at, session_date")
    .eq("client_id", client.id)
    .eq("status", "Scheduled")
    .gte("starts_at", now)
    .order("starts_at");
  const money = (cents: number) => formatMoney(cents / 100, payments.currency);
  const review = accountReview({
    kind,
    who,
    firstName: firstNameOf(client),
    payments,
    sales: billing.sales as any[],
    sessions: (sessions ?? []) as any[],
    today,
    now,
    when: opts.when,
    stopAutoPay: opts.stopAutoPay,
    money,
  });
  return { review, sales: billing.sales as any[] };
}

/**
 * Set each subscription to stop at the end of its period. Nothing is
 * charged or refunded. Idempotent (Stripe's idempotency key per
 * subscription and action). Throws on the first refusal, before the account
 * itself changes.
 */
export async function stopSubscriptions(
  admin: Db,
  clientId: string,
  userId: string | null,
  role: "self" | "coach" | "admin" | "system",
  stop: SubscriptionAction[],
  why: "account_deactivated" | "account_deleted",
): Promise<void> {
  if (stop.length === 0) return;
  const { stripeFetch, getStripeKeyForMode } = await import("@/lib/stripe.server");
  const ids = stop.map((s) => s.saleId);
  const { data: rows } = await admin.from("purchase_records").select("id, stripe_mode, stripe_subscription_id, cancel_at_period_end").in("id", ids);
  for (const s of stop) {
    const row = (rows ?? []).find((r: any) => r.id === s.saleId) as any;
    if (!row || row.stripe_subscription_id !== s.subscriptionId || row.cancel_at_period_end) continue;
    const apiKey = (row.stripe_mode === "test" ? getStripeKeyForMode("test") : getStripeKeyForMode("live")) ?? undefined;
    try {
      await stripeFetch(`/subscriptions/${encodeURIComponent(s.subscriptionId)}`, {
        apiKey,
        method: "POST",
        body: "cancel_at_period_end=true",
        idempotencyKey: `${why}_${s.subscriptionId}`,
      });
    } catch (e: any) {
      throw new Error(
        `Stripe couldn't stop "${s.name}" right now, so nothing was changed. Try again in a minute. (${e?.message ?? "Stripe refused"})`,
      );
    }
    await admin
      .from("purchase_records")
      .update({ cancel_at_period_end: true, last_payment_update_source: why, last_payment_update_at: new Date().toISOString() } as any)
      .eq("id", s.saleId);
    await (admin as any).rpc("_account_lifecycle_log", {
      _client: clientId,
      _user: null,
      _event: s.kind === "plan" ? "auto_pay_stopped" : "subscription_cancelled",
      _actor: userId,
      _role: role,
      _details: { sale_id: s.saleId, name: s.name, why },
    });
  }
}

/**
 * Tell the coach: a staff-only note in the client's coach chat (a coaching
 * client; members have no coach chat) and one push to the coach and admins,
 * never to whoever did it. Never throws.
 */
export async function tellCoach(
  admin: Db,
  input: {
    client: LifecycleClient;
    actor: LifecycleActor;
    event: "deactivated" | "deactivation_scheduled" | "reactivated" | "deletion_requested" | "deletion_withdrawn";
    review: AccountReview | null;
    reason?: string | null;
    day?: string | null;
    currency?: string;
    sourceId: string;
  },
): Promise<void> {
  const { client, actor } = input;
  try {
    if (client.service_tier === "coaching") {
      const body = lifecycleNote({
        event: input.event,
        name: client.full_name || firstNameOf(client),
        by: actor.role,
        byName: actor.name,
        reason: input.reason ?? null,
        review: input.review,
        money: (c) => formatMoney(c / 100, input.currency ?? "CAD"),
        day: input.day ?? null,
      });
      await admin.from("messages").insert({
        client_id: client.id,
        sender_id: actor.userId,
        sender_role: actor.who === "self" ? "client" : "admin",
        body,
        attachments: [],
        message_type: "General",
        is_internal_note: true,
        is_automated: true,
      } as any);
    }
  } catch (e) {
    console.warn("[lifecycle] note failed", e);
  }
  try {
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    const event = {
      deactivated: "account_deactivated",
      deactivation_scheduled: "account_deactivation_scheduled",
      reactivated: "account_reactivated",
      deletion_requested: "account_deletion_requested",
      deletion_withdrawn: "account_deletion_withdrawn",
    }[input.event] as any;
    await notifyAppEvent(admin, event, { clientId: client.id, sourceId: input.sourceId, actorUserId: actor.userId });
  } catch (e) {
    console.warn("[lifecycle] push failed", e);
  }
}

/**
 * An admin deleting an account (Delete client / Delete member): every
 * recurring charge stops first (Stripe refusing stops the delete), then the
 * caller bins it, then `after` tells the coach. Accounts with no client
 * record (a member with none) have nothing to stop.
 */
export async function staffDeletion(userDb: Db, admin: Db, userId: string, clientId: string | null) {
  if (!clientId) return { after: async (_res: any) => {} };
  const { client, actor } = await resolveLifecycle(admin, userId, clientId);
  const { review } = await reviewFor(userDb, admin, client, "delete", "staff");
  await stopSubscriptions(admin, client.id, userId, actor.role, review.stop, "account_deleted");
  return {
    after: async (res: any) => {
      if (res?.already) return;
      await tellCoach(admin, {
        client,
        actor,
        event: "deletion_requested",
        review,
        day: String(res?.purge_after ?? "").slice(0, 10) || null,
        sourceId: `del:${res?.id ?? client.id}`,
      });
    },
  };
}
