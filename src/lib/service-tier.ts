import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { readServiceTierHint, writeServiceTierHint } from "@/lib/service-tier-hint";

/**
 * One athlete record, two service layers. Everyone in the portal has a
 * `clients` row; `service_tier` says whether a coach works with them.
 *  - coaching: the tools AND the service (a coach programming, reviewing, replying).
 *  - self_serve: JF Membership: the same tools, no coach.
 * Upgrading is flipping the tier and assigning a coach; history comes along.
 */
export type ServiceTier = "coaching" | "self_serve";

/** The human layer: only coaching clients get these. Everything else is shared. */
export const COACHING_ONLY = [
  "coach_chat", // Messages with a coach
  "custom_programming", // a coach writes and edits the program
  "check_ins", // check-ins, forms, weekly reviews
  "lift_review", // lift video review
  "coach_notes", // Training Intel, pain flags, coach notes
  "agreements", // coaching agreement
  "pt_sessions", // in-person sessions
  "goals_setup", // coach onboarding (Goals & Setup)
  "purchases", // coaching purchases
] as const;
export type CoachingKey = (typeof COACHING_ONLY)[number];

/** Member-only screens (a coaching client has a coach for these). */
export const MEMBER_ONLY = ["membership_billing", "plan_library", "support_inbox"] as const;
export type MemberKey = (typeof MEMBER_ONLY)[number];

export type EntitlementKey = CoachingKey | MemberKey;

/** Pure: does this tier get this? (tested) */
export function tierAllows(tier: ServiceTier, key: EntitlementKey): boolean {
  if ((COACHING_ONLY as readonly string[]).includes(key)) return tier === "coaching";
  if ((MEMBER_ONLY as readonly string[]).includes(key)) return tier === "self_serve";
  return true;
}

/** Portal paths that belong to the coaching service; a member is sent home from them. */
export const COACHING_ONLY_PATHS = [
  "/portal/messages",
  "/portal/check-ins",
  "/portal/check-in",
  "/portal/agreements",
  "/portal/agreements-native",
  "/portal/goals-setup",
  "/portal/purchases",
  "/portal/lift-videos",
  "/portal/appointments",
];
/** Paths a member whose membership lapsed can still open (to fix billing or get help). */
export const LAPSED_MEMBER_PATHS = ["/portal/membership", "/portal/account", "/portal/support", "/portal/upgrade"];

export function isCoachingOnlyPath(pathname: string): boolean {
  return COACHING_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}.`));
}
export function isLapsedMemberPath(pathname: string): boolean {
  return LAPSED_MEMBER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type MyServiceTier = { clientId: string; tier: ServiceTier; status: string | null; made?: boolean };

export const serviceTierKey = (userId: string | null | undefined) => ["service-tier", userId ?? null] as const;

/**
 * The portal user's tier (the viewed client's in "View as client"). A member
 * whose client row is missing (signup raced, or joined before Phase 1) gets
 * it created on the spot, never for someone else's view.
 *
 * `loading` is true until the tier is actually known (not merely "no query
 * yet"), so a screen that differs by tier can wait instead of guessing.
 */
export function useServiceTier() {
  const userId = usePortalUserId();
  const { isImpersonating } = useClientImpersonation();
  const { loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: serviceTierKey(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    placeholderData: () => (userId ? readServiceTierHint(userId) ?? undefined : undefined),
    queryFn: async (): Promise<MyServiceTier | null> => {
      // A failed read throws (the last known tier stays), never reads as "no row".
      const read = async () => {
        const { data, error } = await supabase.from("clients").select("id, service_tier, status").eq("user_id", userId!).maybeSingle();
        if (error) throw error;
        return data as any;
      };
      let row = await read();
      let made = false;
      if (!row && !isImpersonating) {
        const { data: id } = await (supabase as any).rpc("ensure_my_member_client");
        if (id) {
          row = await read();
          made = !!row;
        }
      }
      if (!row) {
        writeServiceTierHint(userId!, null);
        return null;
      }
      const result: MyServiceTier = { clientId: row.id, tier: row.service_tier === "self_serve" ? "self_serve" : "coaching", status: row.status ?? null, made };
      writeServiceTierHint(userId!, result);
      return result;
    },
  });
  // a freshly made row: everything keyed on "my client" refetches (once)
  const madeId = q.data?.made ? q.data.clientId : null;
  useEffect(() => {
    if (madeId) void qc.invalidateQueries({ queryKey: ["my-client"] });
  }, [madeId, qc]);
  const known = resolveTierState({
    userId,
    isImpersonating,
    authLoading,
    data: q.data,
    isError: q.isError,
    hint: () => (userId ? readServiceTierHint(userId) : null),
  });
  const tier: ServiceTier | null = known.data?.tier ?? null;
  return {
    loading: known.loading,
    clientId: known.data?.clientId ?? null,
    tier,
    isSelfServe: tier === "self_serve",
    isCoaching: tier === "coaching",
  };
}

/**
 * Pure: what the portal knows about the tier right now (tested). `null` data
 * is an answer ("no client row"); only `undefined` means not known yet. Not
 * known: auth still resolving (no user id yet), or the first read hasn't
 * answered. A read that failed falls back to the last tier seen on this
 * device, else coaching screens, as before.
 */
export function resolveTierState(i: {
  userId: string | undefined;
  isImpersonating: boolean;
  authLoading: boolean;
  data: MyServiceTier | null | undefined;
  isError: boolean;
  hint: () => MyServiceTier | null;
}): { loading: boolean; data: MyServiceTier | null | undefined } {
  const data = i.data !== undefined ? i.data : i.isError ? i.hint() ?? undefined : undefined;
  const waitingForUser = !i.userId && !i.isImpersonating && i.authLoading;
  const waitingForRead = !!i.userId && data === undefined && !i.isError;
  return { loading: waitingForUser || waitingForRead, data };
}

/** Gate a screen or a card: `useEntitlement("coach_chat")`. True while unknown for coaching keys (no flash for clients). */
export function useEntitlement(key: EntitlementKey): boolean {
  const { tier } = useServiceTier();
  if (!tier) return !(MEMBER_ONLY as readonly string[]).includes(key);
  return tierAllows(tier, key);
}
