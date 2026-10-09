/**
 * Clients directory server function — wraps `admin_clients_directory`
 * RPC. Scoping (admin vs assigned-coach) is enforced inside the RPC.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DIRECTORY_FILTER_KEYS,
  emptyCounts,
  type DirectoryCounts,
} from "@/lib/clients-directory-filters";
import type { ExemptKind, RosterStatus } from "@/lib/coaching-agreement/rules";
import { readClientFor, rpcRead } from "@/lib/permissions.server";

export type { DirectoryCounts };

export type DirectoryNextAction = {
  kind:
    | "payment"
    | "setup"
    | "review"
    | "assign"
    | "next_phase"
    | "nutrition"
    | "cardio"
    | "open";
  label: string;
};

export type DirectoryRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  profile_picture_url: string | null;
  coaching_type: string | null;
  assigned_coach_id: string | null;
  coach_name: string | null;
  client_status: string | null;
  account_status: string | null;
  payment_status: string | null;
  needs_admin_help: boolean | null;
  created_at: string;
  updated_at: string;
  next_program_update: string | null;
  block_id: string | null;
  block_name: string | null;
  block_start: string | null;
  block_end: string | null;
  block_status: string | null;
  next_block_id: string | null;
  next_block_name: string | null;
  next_block_start: string | null;
  next_block_end: string | null;
  next_block_status: string | null;
  nut_end: string | null;
  card_end: string | null;
  pending_reviews: number;
  f_needs_setup: boolean;
  f_needs_review: boolean;
  f_program_ending: boolean;
  f_missing_program: boolean;
  f_payment_issue: boolean;
  /** Derived from the client's purchases: ok | pending | not_set_up | past_due | exempt. */
  payment_state: "ok" | "pending" | "not_set_up" | "past_due" | "exempt";
  f_no_payment: boolean;
  f_payment_pending: boolean;
  f_new_client: boolean;
  f_missing_nutrition: boolean;
  f_missing_cardio: boolean;
  priority: number;
  next_action: DirectoryNextAction;
  last_active_at: string | null;
  last_login_at: string | null;
  missed_workouts_count: number;
  days_inactive: number | null;
  f_missed_workouts: boolean;
  f_inactive: boolean;
  /**
   * Coaching Agreement status, decided in the database exactly as the admin Agreements roster
   * decides it. Optional so a row from a database that predates it simply shows no chip.
   */
  coaching_agreement_status?: RosterStatus | null;
  coaching_agreement_signed_at?: string | null;
  coaching_agreement_version?: string | null;
  coaching_agreement_requested_at?: string | null;
  coaching_agreement_exempt_kind?: ExemptKind | null;
  coaching_agreement_reminded_at?: string | null;
  /** Hasn't signed (or must sign again) and isn't exempt. */
  f_no_contract?: boolean;
};

export type DirectoryResult = {
  rows: DirectoryRow[];
  total: number;
  counts: DirectoryCounts;
};

const InputSchema = z.object({
  search: z.string().optional().default(""),
  // Every filter a client must match (all of them, not any).
  flags: z
    .array(z.enum(DIRECTORY_FILTER_KEYS))
    .max(DIRECTORY_FILTER_KEYS.length)
    .optional()
    .default([]),
  coachingType: z.string().optional().default("all"),
  coachId: z.string().uuid().optional().nullable(),
  sort: z
    .enum(["attention", "recent", "name", "ending", "activity"])
    .optional()
    .default("attention"),
  page: z.number().int().min(1).optional().default(1),
  size: z.number().int().min(5).max(100).optional().default(15),
  lifecycle: z
    .enum(["active", "archived", "deactivated"])
    .optional()
    .default("active"),
});

export const listClientsDirectoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<DirectoryResult> => {
    const offset = (data.page - 1) * data.size;
    // A view-only login (finance) reads the admin's list: a read-only call, so
    // the admin view applies (admin_clients_directory is STABLE).
    const { db, viewOnly } = await readClientFor(context as any);
    const call = (fn: string, args: Record<string, unknown>) =>
      viewOnly ? rpcRead(db, fn, args) : context.supabase.rpc(fn as any, args as any);
    const { data: rpc, error } = await call(
      "admin_clients_directory",
      {
        p_search: data.search || null,
        p_coaching_type: data.coachingType,
        p_coach_id: data.coachId ?? null,
        p_sort: data.sort,
        p_limit: data.size,
        p_offset: offset,
        p_lifecycle: data.lifecycle,
        p_flags: data.flags,
      } as any,
    );
    if (error) throw new Error(error.message);
    const payload = (rpc ?? {}) as any;
    return {
      rows: (payload.rows ?? []) as DirectoryRow[],
      total: Number(payload.total ?? 0),
      // Fill every key, so a database that predates a filter shows 0 rather than blank.
      counts: { ...emptyCounts(), ...((payload.counts ?? {}) as Partial<DirectoryCounts>) },
    };
  });