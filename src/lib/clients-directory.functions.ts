/**
 * Clients directory server function — wraps `admin_clients_directory`
 * RPC. Scoping (admin vs assigned-coach) is enforced inside the RPC.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  nut_end: string | null;
  card_end: string | null;
  pending_reviews: number;
  f_needs_setup: boolean;
  f_needs_review: boolean;
  f_program_ending: boolean;
  f_missing_program: boolean;
  f_payment_issue: boolean;
  f_new_client: boolean;
  f_missing_nutrition: boolean;
  f_missing_cardio: boolean;
  priority: number;
  next_action: DirectoryNextAction;
};

export type DirectoryCounts = {
  all: number;
  needs_setup: number;
  needs_review: number;
  program_ending: number;
  payment_issues: number;
  new_clients: number;
};

export type DirectoryResult = {
  rows: DirectoryRow[];
  total: number;
  counts: DirectoryCounts;
};

const InputSchema = z.object({
  search: z.string().optional().default(""),
  status: z
    .enum([
      "all",
      "needs_setup",
      "needs_review",
      "program_ending",
      "payment_issues",
      "new_clients",
    ])
    .optional()
    .default("all"),
  coachingType: z.string().optional().default("all"),
  coachId: z.string().uuid().optional().nullable(),
  sort: z
    .enum(["attention", "recent", "name", "ending", "activity"])
    .optional()
    .default("attention"),
  page: z.number().int().min(1).optional().default(1),
  size: z.number().int().min(5).max(100).optional().default(15),
});

export const listClientsDirectoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<DirectoryResult> => {
    const offset = (data.page - 1) * data.size;
    const { data: rpc, error } = await context.supabase.rpc(
      "admin_clients_directory",
      {
        p_search: data.search || null,
        p_status: data.status,
        p_coaching_type: data.coachingType,
        p_coach_id: data.coachId ?? null,
        p_sort: data.sort,
        p_limit: data.size,
        p_offset: offset,
      } as any,
    );
    if (error) throw new Error(error.message);
    const payload = (rpc ?? {}) as any;
    return {
      rows: (payload.rows ?? []) as DirectoryRow[],
      total: Number(payload.total ?? 0),
      counts: (payload.counts ?? {
        all: 0,
        needs_setup: 0,
        needs_review: 0,
        program_ending: 0,
        payment_issues: 0,
        new_clients: 0,
      }) as DirectoryCounts,
    };
  });