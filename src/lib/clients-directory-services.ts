import type { DirectoryRow } from "./clients-directory.functions";
import { DIRECTORY_FILTER_KEYS, emptyCounts, type DirectoryFilterKey } from "./clients-directory-filters";

/** The seeded Nutrition Coaching package is an explicit service, not a guess
 * from a free-text client name or their workout history. Legacy/custom plans
 * retain their existing directory behavior. */
export const NUTRITION_PACKAGE_SLUG = "nutrition";

export function nutritionDirectoryRow(r: DirectoryRow): DirectoryRow {
  const activated = r.account_status === "Account Created" || r.account_status === "Active" || !!r.last_login_at;
  const needsSetup = r.f_needs_setup && !activated;
  const priority = r.f_payment_issue ? 1 : needsSetup ? 2 : r.f_needs_review ? 3 :
    r.payment_state === "not_set_up" ? 4 : r.f_no_contract ? 5 : r.f_missing_nutrition ? 8 : 10;
  const next_action: DirectoryRow["next_action"] = r.f_payment_issue ? { kind: "payment", label: "Resolve payment" } :
    needsSetup ? { kind: "setup", label: "Open setup" } : r.f_needs_review ? { kind: "review", label: "Review check-in" } :
    r.payment_state === "not_set_up" ? { kind: "payment", label: "Set up payment" } :
    r.f_missing_nutrition ? { kind: "nutrition", label: "Update nutrition" } : { kind: "open", label: "Open client" };
  return {
    ...r, service_kind: "nutrition", priority, next_action,
    f_needs_setup: needsSetup,
    f_missing_program: false, f_program_ending: false, f_missing_cardio: false,
    f_missed_workouts: false, f_inactive: false,
  };
}

/** The existing directory RPC's flags, reconstructed from its row payload
 * only when specialty enrollments require correcting training-only flags. */
export function rowDirectoryFlags(r: DirectoryRow): DirectoryFilterKey[] {
  const activated = r.account_status === "Account Created" || r.account_status === "Active" || !!r.last_login_at;
  const matches: Record<DirectoryFilterKey, boolean> = {
    needs_setup: !!r.f_needs_setup && !activated,
    needs_review: !!r.f_needs_review,
    program_ending: !!r.f_program_ending,
    payment_issues: !!r.f_payment_issue,
    no_payment: r.payment_state === "not_set_up",
    payment_pending: r.payment_state === "pending",
    new_clients: !!r.f_new_client,
    missed_workouts: !!r.f_missed_workouts,
    inactive: !!r.f_inactive,
    no_contract: !!r.f_no_contract,
    no_program: !!r.f_missing_program,
    no_nutrition: !!r.f_missing_nutrition,
    no_cardio: !!r.f_missing_cardio,
  };
  return DIRECTORY_FILTER_KEYS.filter((k) => matches[k]);
}

export function organizeDirectoryServices(
  rows: readonly DirectoryRow[],
  nutritionIds: ReadonlySet<string>,
  options: { flags: DirectoryFilterKey[]; match: "any" | "all"; sort: string; separateNutrition: boolean; page: number; size: number },
) {
  const enriched = rows.map((r) => nutritionIds.has(r.id) ? nutritionDirectoryRow(r) : r);
  const counts = emptyCounts();
  counts.all = enriched.length;
  const matching = enriched.filter((r) => {
    const flags = rowDirectoryFlags(r);
    for (const flag of flags) counts[flag]++;
    return options.flags.length === 0 ||
      (options.match === "all" ? options.flags.every((f) => flags.includes(f)) : options.flags.some((f) => flags.includes(f)));
  });
  if (options.sort === "attention") matching.sort((a,b) => a.priority - b.priority || (a.full_name ?? "").localeCompare(b.full_name ?? ""));
  const nutritionRows = options.separateNutrition ? matching.filter((r) => r.service_kind === "nutrition") : [];
  const main = options.separateNutrition ? matching.filter((r) => r.service_kind !== "nutrition") : matching;
  const offset = (options.page - 1) * options.size;
  return { rows: main.slice(offset, offset + options.size), total: main.length, counts, nutritionRows };
}
