/**
 * The coach's client profile (admin/clients.$id) edits a copy of the client row.
 * Save sends only what the coach changed on that copy, never the whole row:
 *
 * - the row holds columns the database computes (`normalized_email`,
 *   `normalized_phone` are GENERATED), and writing those back fails every save
 *   ("column "normalized_email" can only be updated to DEFAULT");
 * - the row moves under the page while it's open (a setup link links the login,
 *   stamps when it was sent), and writing the page's older copy back would undo
 *   that, e.g. unlink a client's login.
 *
 * So the page keeps the server row its copy came from (`base`); when the server
 * row changes, fields the coach hasn't touched follow it (`rebaseProfileForm`)
 * and the Save bar shows only for real edits (`profileChanges`).
 */
import { SCHEDULE_OWNED_CLIENT_FIELDS } from "@/lib/committed-schedule-realign";

/** Columns the profile's Save never writes: computed by the database or owned by another flow. */
export const PROFILE_READ_ONLY_FIELDS: ReadonlySet<string> = new Set<string>([
  "id",
  "created_at",
  "updated_at",
  // GENERATED ALWAYS columns (20260612215547): the database refuses any value.
  "normalized_email",
  "normalized_phone",
  // The client answers sex themselves (Home prompt, nutrition form); the
  // Personal Details card writes it on its own.
  "sex",
  "sex_updated_at",
  // The Training Schedule card owns these and realigns workouts when they change.
  ...SCHEDULE_OWNED_CLIENT_FIELDS,
]);

type Row = Record<string, unknown>;

/** A cleared box ("") and an empty column (null / missing) are the same value. */
function norm(v: unknown): unknown {
  return v === undefined || v === "" ? null : v;
}

export function sameProfileValue(a: unknown, b: unknown): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  if (x === null || y === null) return false;
  if (typeof x !== "object" || typeof y !== "object") return false;
  try {
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return false;
  }
}

/** What the coach changed on the copy, as an update patch (read-only columns never included). */
export function profileChanges(form: Row | null | undefined, base: Row | null | undefined): Row {
  const out: Row = {};
  if (!form || !base) return out;
  for (const k of Object.keys(form)) {
    if (PROFILE_READ_ONLY_FIELDS.has(k)) continue;
    if (!sameProfileValue(form[k], base[k])) out[k] = form[k];
  }
  return out;
}

/**
 * The copy after the server row moved from `prevBase` to `nextBase`: every field
 * the coach hasn't touched (still equal to `prevBase`) takes the server's new
 * value; the coach's edits stay.
 */
export function rebaseProfileForm(form: Row | null | undefined, prevBase: Row | null | undefined, nextBase: Row): Row {
  if (!form || !prevBase) return { ...nextBase };
  const out: Row = { ...form };
  const keys = new Set([...Object.keys(prevBase), ...Object.keys(nextBase)]);
  for (const k of keys) {
    if (sameProfileValue(form[k], prevBase[k])) out[k] = nextBase[k];
  }
  return out;
}
