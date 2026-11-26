/**
 * Account headshots on the server (service role, after the caller's own checks
 * in headshots.functions.ts). Server-only: never import from client code or the
 * top level of a `.functions.ts` file.
 *
 *   - a capture is a single-use session: issued here with its challenge and a
 *     short expiry, uploaded into the private bucket under the session's id
 *     (storage policy account_headshot_upload_ok), then read back and checked
 *     here: timing, files, the evidence frames (evidence.ts), the photo's
 *     header, the same photo sent twice or from another account
 *   - a guided submission that passes saves automatically; exceptions wait for review; accepting copies the photo
 *     into the avatars bucket as the account photo, closes the request and its
 *     reminders; declining keeps the old photo and asks again, in the same
 *     standard words as any request
 *   - the hourly tick sends reminder pushes on the admin's schedule and deletes
 *     evidence frames once they're past their retention
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DAY_MS,
  HEADSHOT_CONSENT_VERSION,
  SESSION_TTL_MS,
  SESSIONS_PER_HOUR,
  clientCopyFor,
  goodReminderHour,
  headshotPointsDue,
  headshotStatus,
  headshotOutstanding,
  pickChallenge,
  sanitizePhotoReminders,
  shouldSendHeadshotReminder,
  snoozeUntil,
  storedPhotoReminders,
  crewReminderDue,
  headshotCardDue,
  type ChallengeStep,
  type HeadshotStatus,
  type PhotoReminderSettings,
  type RequestKind,
} from "./rules";
import { FAIL_WORDS, PHOTO_PX, TILE, deviceCheckProblems, hamming, readEvidence, stripTiles, type DeviceChecks, type TileMeta } from "./evidence";
import { decodePng, jpegInfo } from "./png";

type Admin = SupabaseClient;
const BUCKET = "account-headshots";
const AVATARS = "avatars";
const SETTINGS_KEY = "photo_reminders";
/** A coaching client the headshot applies to: a login, not deactivated, deleted or archived. */
const GONE = new Set(["Deactivated", "Deleted", "Archived"]);

export type CaptureMethod = "guided" | "live" | "coach_assisted";

/* ---- settings -------------------------------------------------------- */

export async function loadPhotoSettings(db: Admin): Promise<PhotoReminderSettings> {
  const { data } = await (db as any).from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  return sanitizePhotoReminders(data?.value ?? null);
}

export async function savePhotoSettings(db: Admin, s: PhotoReminderSettings): Promise<PhotoReminderSettings> {
  const clean = sanitizePhotoReminders(storedPhotoReminders(s));
  const value = JSON.stringify(storedPhotoReminders(clean));
  const { error } = await (db as any).from("app_settings").upsert({ key: SETTINGS_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return clean;
}

/* ---- small helpers --------------------------------------------------- */

export async function logHeadshotEvent(
  db: Admin,
  e: { clientId: string; headshotId?: string | null; actor?: string | null; kind: string; detail?: Record<string, unknown> },
) {
  await (db as any).from("account_headshot_events").insert({
    client_id: e.clientId,
    headshot_id: e.headshotId ?? null,
    actor: e.actor ?? null,
    kind: e.kind,
    detail: e.detail ?? {},
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function download(db: Admin, bucket: string, path: string): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function signed(db: Admin, bucket: string, path: string | null | undefined, seconds = 3600): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(bucket).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

type ClientRow = {
  id: string;
  user_id: string | null;
  service_tier: string | null;
  handling_active?: boolean;
  archived: boolean | null;
  status: string | null;
  created_at: string;
  timezone: string | null;
  first_name: string | null;
  preferred_name: string | null;
  full_name: string | null;
  profile_picture_url: string | null;
};
const CLIENT_COLS = "id, user_id, service_tier, archived, status, created_at, timezone, first_name, preferred_name, full_name, profile_picture_url";

export function headshotApplies(c: Pick<ClientRow, "user_id" | "service_tier" | "handling_active" | "archived" | "status"> | null | undefined): boolean {
  return !!c && !!c.user_id && (c.service_tier === "coaching" || c.handling_active === true) && !c.archived && !GONE.has(String(c.status ?? ""));
}

async function withHandlingAccess(db: Admin, c: ClientRow | null): Promise<ClientRow | null> {
  if (!c || c.service_tier === "coaching" || c.archived || !c.user_id) return c;
  const { loadHandlingSetup } = await import("@/lib/competition/handling-setup.server");
  return { ...c, handling_active: (await loadHandlingSetup(db, c.id)).length > 0 };
}
export async function clientForUser(db: Admin, userId: string): Promise<ClientRow | null> {
  const { data } = await (db as any).from("clients").select(CLIENT_COLS).eq("user_id", userId).maybeSingle();
  return withHandlingAccess(db, (data as ClientRow) ?? null);
}
export async function clientById(db: Admin, clientId: string): Promise<ClientRow | null> {
  const { data } = await (db as any).from("clients").select(CLIENT_COLS).eq("id", clientId).maybeSingle();
  return withHandlingAccess(db, (data as ClientRow) ?? null);
}

type RequestRow = {
  client_id: string;
  kind: RequestKind;
  opened_at: string;
  opened_by: string | null;
  reason: string | null;
  resolved_at: string | null;
  cancelled_at: string | null;
  reminders_sent: number;
  last_reminded_at: string | null;
  snoozed_until: string | null;
};
const isOpen = (r: RequestRow | null | undefined): r is RequestRow => !!r && !r.resolved_at && !r.cancelled_at;

async function requestFor(db: Admin, clientId: string): Promise<RequestRow | null> {
  const { data } = await (db as any).from("account_headshot_requests").select("*").eq("client_id", clientId).maybeSingle();
  return (data as RequestRow) ?? null;
}

/**
 * A client made since onboarding headshots began, with no photo and nothing
 * asked yet, gets their onboarding request (idempotent: never over a request
 * already there, open or closed, so a cancelled one stays cancelled).
 */
export async function ensureOnboardingRequest(db: Admin, c: ClientRow, s: PhotoReminderSettings): Promise<void> {
  if (!headshotApplies(c) || c.profile_picture_url || !s.headshot.requiredSince) return;
  if (new Date(c.created_at).getTime() < new Date(s.headshot.requiredSince).getTime()) return;
  // never a test login, a staff member's own athlete account, or anything automated
  const [{ data: test }, { data: linked }] = await Promise.all([
    (db as any).rpc("is_test_login", { _uid: c.user_id }),
    (db as any).from("community_profiles").select("user_id").eq("same_person_as", c.user_id).limit(1),
  ]);
  if (test === true || (linked?.length ?? 0) > 0) return;
  const { data, error } = await (db as any)
    .from("account_headshot_requests")
    .upsert({ client_id: c.id, kind: "onboarding" }, { onConflict: "client_id", ignoreDuplicates: true })
    .select("client_id");
  if (!error && data?.length) await logHeadshotEvent(db, { clientId: c.id, kind: "requested", detail: { kind: "onboarding" } });
}

/* ---- the client's own status ----------------------------------------- */

export type MyHeadshot = {
  applies: boolean;
  status: HeadshotStatus | null;
  outstanding: boolean;
  /** the Home card is due (not snoozed); the Account row shows whatever this says */
  cardDue: boolean;
  copy: { title: string; body: string; action: string } | null;
  currentUrl: string | null;
  pending: { submittedAt: string; photoUrl: string | null } | null;
};

export async function myHeadshot(db: Admin, c: ClientRow | null, now = new Date()): Promise<MyHeadshot> {
  const none: MyHeadshot = { applies: false, status: null, outstanding: false, cardDue: false, copy: null, currentUrl: null, pending: null };
  if (!c || !headshotApplies(c)) return none;
  const s = await loadPhotoSettings(db);
  await ensureOnboardingRequest(db, c, s);
  const [req, { data: pendingRow }, { data: accepted }] = await Promise.all([
    requestFor(db, c.id),
    (db as any).from("account_headshots").select("id, submitted_at, photo_path").eq("client_id", c.id).eq("status", "pending").maybeSingle(),
    (db as any).from("account_headshots").select("display_path").eq("client_id", c.id).eq("status", "accepted").order("decided_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const open = isOpen(req) ? req : null;
  const pending = !!pendingRow;
  const status = headshotStatus({ displayPath: c.profile_picture_url, acceptedDisplayPath: accepted?.display_path ?? null, pending, openRequest: open });
  const outstanding = headshotOutstanding({ pending, openRequest: open });
  return {
    applies: true,
    status,
    outstanding,
    cardDue: outstanding && headshotCardDue({ snoozedUntil: open?.snoozed_until ? new Date(open.snoozed_until) : null }, now),
    // never had one: "required"; replacing one: "update required" (whoever asked, the same words)
    copy: open && outstanding ? clientCopyFor(c.profile_picture_url ? open.kind : "onboarding") : null,
    currentUrl: await signed(db, AVATARS, c.profile_picture_url),
    pending: pendingRow ? { submittedAt: pendingRow.submitted_at, photoUrl: await signed(db, BUCKET, pendingRow.photo_path) } : null,
  };
}

/** "Remind me later": the Home card (and pushes) wait for the next reminder moment. */
export async function snoozeMyHeadshot(db: Admin, c: ClientRow, now = new Date()): Promise<{ until: string | null }> {
  const req = await requestFor(db, c.id);
  if (!isOpen(req)) return { until: null };
  const s = await loadPhotoSettings(db);
  const until = snoozeUntil(new Date(req.opened_at), now, s.headshot).toISOString();
  await (db as any).from("account_headshot_requests").update({ snoozed_until: until }).eq("client_id", c.id);
  await logHeadshotEvent(db, { clientId: c.id, actor: c.user_id, kind: "snoozed", detail: { until } });
  return { until };
}

/* ---- capture sessions ------------------------------------------------- */

export type CaptureSession = {
  id: string;
  clientId: string;
  method: CaptureMethod;
  challenge: ChallengeStep[];
  expiresAt: string;
  photoPath: string;
  evidencePath: string;
  tile: number;
  photoPx: number;
};

export async function startCapture(
  db: Admin,
  args: { client: ClientRow; actor: string; method: CaptureMethod; consent: boolean },
  now = new Date(),
): Promise<CaptureSession> {
  const { client, actor, method } = args;
  if (method !== "coach_assisted" && !args.consent) throw new Error("Please agree to continue.");
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const { count } = await (db as any)
    .from("account_headshots")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .gte("started_at", since);
  if ((count ?? 0) >= SESSIONS_PER_HOUR) throw new Error("That's a lot of tries in an hour. Please take a short break and try again.");
  // an open session for this client is closed (only the newest can be uploaded into)
  await (db as any).from("account_headshots").update({ status: "expired" }).eq("client_id", client.id).eq("status", "capturing");
  const challenge = method === "guided" ? pickChallenge() : [];
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const { data, error } = await (db as any)
    .from("account_headshots")
    .insert({
      client_id: client.id,
      user_id: actor,
      method,
      status: "capturing",
      challenge,
      consent_version: method === "coach_assisted" ? null : HEADSHOT_CONSENT_VERSION,
      consent_at: method === "coach_assisted" ? null : now.toISOString(),
      started_at: now.toISOString(),
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't start the camera check.");
  await logHeadshotEvent(db, { clientId: client.id, headshotId: data.id, actor, kind: "capture_started", detail: { method } });
  return {
    id: data.id,
    clientId: client.id,
    method,
    challenge,
    expiresAt,
    photoPath: `${client.id}/${data.id}/photo.jpg`,
    evidencePath: `${client.id}/${data.id}/evidence.png`,
    tile: TILE,
    photoPx: PHOTO_PX,
  };
}

export type SubmitResult =
  | { ok: true; status: "pending" | "accepted"; flags: string[] }
  | { ok: false; reason: string; message: string };

const MIN_CAPTURE_MS = 1500;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 1024 * 1024;

/** Only server-confirmed guided captures are eligible. EXIF alone is not evidence of spoofing. */
export function canAutoSaveHeadshot(method: string, flags: unknown, checks: any): boolean {
  return method === "guided" && Array.isArray(flags) &&
    flags.every((f) => f === "exif" || f === "same_as_before") &&
    checks?.blink?.confirmed === true && checks?.turn?.confirmed === true &&
    Array.isArray(checks?.deviceProblems) && checks.deviceProblems.length === 0;
}

/**
 * The submission, checked on the server. Hard failures end the session ("try
 * again", with what to change); passing guided captures save automatically; exceptions go for review with the
 * server's own findings and the device's report side by side.
 */
export async function submitCapture(
  db: Admin,
  args: { headshotId: string; actor: string; device: DeviceChecks | null; staffAccepts?: boolean },
  now = new Date(),
): Promise<SubmitResult> {
  const { data: h } = await (db as any).from("account_headshots").select("*").eq("id", args.headshotId).maybeSingle();
  if (!h || h.user_id !== args.actor) return { ok: false, reason: "missing", message: FAIL_WORDS.missing };
  const fail = async (reason: keyof typeof FAIL_WORDS, detail: Record<string, unknown> = {}): Promise<SubmitResult> => {
    await (db as any).from("account_headshots").update({ status: "failed", server_checks: { reason, ...detail } }).eq("id", h.id).eq("status", "capturing");
    await logHeadshotEvent(db, { clientId: h.client_id, headshotId: h.id, actor: args.actor, kind: "check_failed", detail: { reason, ...detail } });
    await removeFiles(db, h.client_id, h.id);
    return { ok: false, reason, message: FAIL_WORDS[reason] };
  };
  // A lost response or a transient approval error must not require taking a
  // new photo. Only the original actor can retry this already-checked capture.
  if (h.status === "pending") {
    const automatic = canAutoSaveHeadshot(h.method, h.flags, h.server_checks);
    if ((h.method === "coach_assisted" && args.staffAccepts) || automatic) {
      await decide(db, { headshotId: h.id, actor: args.actor, decision: "accept", note: null, automatic }, now);
      return { ok: true, status: "accepted", flags: h.flags ?? [] };
    }
    return { ok: true, status: "pending", flags: h.flags ?? [] };
  }
  if (h.status === "accepted") {
    const client = await clientById(db, h.client_id);
    if (h.display_path && client?.profile_picture_url === h.display_path) return { ok: true, status: "accepted", flags: h.flags ?? [] };
    return { ok: false, reason: "expired", message: FAIL_WORDS.expired };
  }
  if (h.status !== "capturing") return { ok: false, reason: "expired", message: FAIL_WORDS.expired };
  if (new Date(h.expires_at).getTime() < now.getTime()) return fail("expired");
  const elapsed = now.getTime() - new Date(h.started_at).getTime();
  if (h.method === "guided" && elapsed < MIN_CAPTURE_MS) return fail("still_image", { elapsed });

  const photoPath = `${h.client_id}/${h.id}/photo.jpg`;
  const evidencePath = `${h.client_id}/${h.id}/evidence.png`;
  const photo = await download(db, BUCKET, photoPath);
  if (!photo) return fail("missing");
  if (photo.length > MAX_PHOTO_BYTES) return fail("photo", { bytes: photo.length });
  const jpeg = jpegInfo(photo);
  if (!jpeg || jpeg.width < 320 || jpeg.height < 320 || Math.abs(jpeg.width - jpeg.height) > 2) return fail("photo", { jpeg });
  const photoSha = await sha256Hex(photo);

  const challenge = (Array.isArray(h.challenge) ? h.challenge : []) as ChallengeStep[];
  const flags: string[] = [];
  if (jpeg.exif) flags.push("exif");
  let verdict: ReturnType<typeof readEvidence> | null = null;
  let evidenceSha: string | null = null;
  const evidence = await download(db, BUCKET, evidencePath);
  if (h.method !== "coach_assisted") {
    if (!evidence) return fail("missing");
    if (evidence.length > MAX_EVIDENCE_BYTES) return fail("unreadable", { bytes: evidence.length });
    evidenceSha = await sha256Hex(evidence);
    try {
      verdict = readEvidence(decodePng(evidence), challenge, args.device?.tiles ?? []);
    } catch (e) {
      return fail("unreadable", { error: String((e as Error)?.message ?? e) });
    }
    if (!verdict.ok) return fail(verdict.fail ?? "unreadable", { stats: verdict.stats });
    flags.push(...verdict.flags);
  }
  if (h.method === "live") flags.push("no_device_checks");
  if (h.method === "coach_assisted") flags.push("coach_assisted");
  const deviceProblems = args.device ? deviceCheckProblems(args.device, challenge, h.method) : h.method === "guided" ? ["missing"] : [];
  if (deviceProblems.length) flags.push("device_inconsistent");

  // the same frames or photo sent again (from any account) is a replay
  const [{ data: dupE }, { data: dupP }] = await Promise.all([
    evidenceSha ? (db as any).from("account_headshots").select("id").eq("evidence_sha256", evidenceSha).neq("id", h.id).limit(1) : Promise.resolve({ data: [] }),
    (db as any).from("account_headshots").select("id").eq("photo_sha256", photoSha).neq("id", h.id).limit(1),
  ]);
  if ((dupE?.length ?? 0) > 0 || (dupP?.length ?? 0) > 0) return fail("replay");

  // the same picture as another account's (or an earlier one of theirs), by fingerprint
  if (verdict?.dhash) {
    const { data: recent } = await (db as any)
      .from("account_headshots")
      .select("client_id, dhash")
      .not("dhash", "is", null)
      .in("status", ["pending", "accepted", "superseded", "declined"])
      .neq("id", h.id)
      .order("created_at", { ascending: false })
      .limit(1000);
    for (const r of (recent ?? []) as { client_id: string; dhash: string }[]) {
      if (hamming(r.dhash, verdict.dhash) > 6) continue;
      flags.push(r.client_id === h.client_id ? "same_as_before" : "similar_other_account");
    }
  }

  const uniqueFlags = [...new Set(flags)];
  const serverChecks = {
    stats: verdict?.stats ?? null,
    blink: verdict?.blink ?? null,
    turn: verdict?.turn ?? null,
    jpeg,
    elapsedMs: elapsed,
    deviceProblems,
  };
  const coachAccepts = h.method === "coach_assisted" && !!args.staffAccepts;
  const automatic = canAutoSaveHeadshot(h.method, uniqueFlags, serverChecks);
  // one waiting per client: an older pending submission gives way to this one
  await (db as any).from("account_headshots").update({ status: "superseded" }).eq("client_id", h.client_id).eq("status", "pending");
  const { data: submitted, error } = await (db as any)
    .from("account_headshots")
    .update({
      status: "pending",
      submitted_at: now.toISOString(),
      photo_path: photoPath,
      evidence_path: evidence ? evidencePath : null,
      photo_sha256: photoSha,
      evidence_sha256: evidenceSha,
      dhash: verdict?.dhash ?? null,
      device_checks: args.device ?? {},
      server_checks: serverChecks,
      flags: uniqueFlags,
    })
    .eq("id", h.id)
    .eq("status", "capturing")
    .select("id")
    .maybeSingle();
  if (error) {
    // the unique fingerprints: another submission got there first with these files
    if (/duplicate|unique/i.test(error.message)) return fail("replay");
    throw new Error(error.message);
  }
  if (!submitted) throw new Error("This capture changed while saving. Retry save to check its status.");
  await logHeadshotEvent(db, { clientId: h.client_id, headshotId: h.id, actor: args.actor, kind: "submitted", detail: { method: h.method, flags: uniqueFlags } });

  if (coachAccepts || automatic) {
    await decide(db, { headshotId: h.id, actor: args.actor, decision: "accept", note: null, automatic }, now);
    return { ok: true, status: "accepted", flags: uniqueFlags };
  }
  await notifyReviewers(db, h.client_id, h.id);
  return { ok: true, status: "pending", flags: uniqueFlags };
}

async function removeFiles(db: Admin, clientId: string, headshotId: string) {
  await db.storage.from(BUCKET).remove([`${clientId}/${headshotId}/photo.jpg`, `${clientId}/${headshotId}/evidence.png`]).catch(() => {});
}

async function notifyReviewers(db: Admin, clientId: string, headshotId: string) {
  try {
    const [{ staffUserIdsForClient }, { sendWebPushToUser }] = await Promise.all([
      import("@/lib/push/app-events.server"),
      import("@/lib/push/push.server"),
    ]);
    const ids = await staffUserIdsForClient(db, clientId);
    await Promise.all(
      ids.map((uid) =>
        sendWebPushToUser(
          db,
          uid,
          { title: "Account headshot to review", body: "A client sent a new account headshot.", url: `/admin/clients/${clientId}?tab=info`, tag: `headshot-review:${clientId}`, data: { kind: "headshot_review" } },
          { category: "check_ins", eventKey: `headshot-review:${headshotId}:${uid}`, priority: "normal", rateKey: `headshot-review:${uid}`, rateWindowMinutes: 30 },
        ),
      ),
    );
  } catch (e) {
    console.warn("[headshots] reviewer push failed", e);
  }
}

/* ---- decisions (staff) ------------------------------------------------ */

export async function decide(
  db: Admin,
  args: { headshotId: string; actor: string; decision: "accept" | "decline"; note: string | null; automatic?: boolean },
  now = new Date(),
): Promise<{ status: "accepted" | "declined" }> {
  const { data: h } = await (db as any).from("account_headshots").select("*").eq("id", args.headshotId).maybeSingle();
  if (!h) throw new Error("That headshot isn't there any more.");
  if (h.status === "accepted" && args.decision === "accept") {
    const c = await clientById(db, h.client_id);
    if (h.display_path && c?.profile_picture_url === h.display_path) return { status: "accepted" };
  }
  if (h.status !== "pending") throw new Error("That headshot was already reviewed.");
  const c = await clientById(db, h.client_id);
  if (!c) throw new Error("That client isn't there any more.");
  const note = args.note?.trim().slice(0, 500) || null;

  if (args.decision === "decline") {
    await (db as any).from("account_headshots").update({ status: "declined", decided_by: args.actor, decided_at: now.toISOString(), decision_note: note }).eq("id", h.id).eq("status", "pending");
    // ask again, the same standard words as any request (the note stays private)
    await openRequest(db, { client: c, kind: "review", actor: args.actor, reason: note }, now);
    await logHeadshotEvent(db, { clientId: c.id, headshotId: h.id, actor: args.actor, kind: "declined", detail: { note } });
    return { status: "declined" };
  }

  // the accepted photo becomes the account photo: a copy in the avatars bucket under the client's login
  const photo = await download(db, BUCKET, h.photo_path);
  if (!photo) throw new Error("The photo file is missing. Ask for a new one.");
  if (!c.user_id) throw new Error("This client has no login.");
  // A stable, session-specific key lets us safely retry the same checked photo.
  const displayPath = `${c.user_id}/headshot-${h.id}.jpg`;
  const { error: upErr } = await db.storage.from(AVATARS).upload(displayPath, new Blob([photo as BlobPart], { type: "image/jpeg" }), { contentType: "image/jpeg", upsert: true });
  if (upErr) throw new Error(upErr.message);
  // One DB transaction: no success unless the profile, decision and request
  // have all persisted. Do not delete the staged file on an uncertain response.
  const { data: committed, error: commitErr } = await (db as any).rpc("commit_account_headshot", {
    _headshot: h.id, _actor: args.actor, _display_path: displayPath, _note: note, _decided_at: now.toISOString(), ...(args.automatic === true ? { _automatic: true } : {}),
  });
  if (commitErr) throw new Error(commitErr.message);
  const saved = await clientById(db, c.id);
  if (saved?.profile_picture_url !== displayPath) throw new Error("The account photo could not be verified. Retry save.");
  await removeOldDisplay(db, typeof committed === "string" ? committed : null, displayPath);
  return { status: "accepted" };
}

/** The replaced account photo goes, unless something else still points at it (a team photo, a Crew picture). */
async function removeOldDisplay(db: Admin, previous: string | null, current: string) {
  if (!previous || previous === current || /^https?:\/\//.test(previous)) return;
  if (!/\/(avatar|headshot)-[^/]+\.(jpe?g|png|webp)$/i.test(previous)) return;
  const [{ count: a }, { count: b }, { count: c }, { count: d }] = await Promise.all([
    (db as any).from("clients").select("id", { count: "exact", head: true }).eq("profile_picture_url", previous),
    (db as any).from("coaches").select("id", { count: "exact", head: true }).eq("profile_picture_url", previous),
    (db as any).from("community_profiles").select("user_id", { count: "exact", head: true }).eq("avatar_path", previous),
    (db as any).from("profiles").select("id", { count: "exact", head: true }).eq("avatar_url", previous),
  ]);
  if ((a ?? 0) + (b ?? 0) + (c ?? 0) + (d ?? 0) > 0) return;
  await db.storage.from(AVATARS).remove([previous]).catch(() => {});
}

/* ---- requests (staff) ------------------------------------------------- */

export async function openRequest(
  db: Admin,
  args: { client: ClientRow; kind: RequestKind; actor: string | null; reason: string | null },
  now = new Date(),
): Promise<void> {
  const row = {
    client_id: args.client.id,
    kind: args.kind,
    opened_at: now.toISOString(),
    opened_by: args.actor,
    reason: args.reason?.trim().slice(0, 500) || null,
    resolved_at: null,
    resolved_headshot_id: null,
    cancelled_at: null,
    reminders_sent: 0,
    last_reminded_at: null,
    snoozed_until: null,
  };
  const { error } = await (db as any).from("account_headshot_requests").upsert(row, { onConflict: "client_id" });
  if (error) throw new Error(error.message);
  // older app builds read this flag; their words are the standard ones, never the reason
  await (db as any)
    .from("clients")
    .update({ profile_picture_needs_update: true, profile_picture_needs_update_at: now.toISOString(), profile_picture_needs_update_reason: clientCopyFor(args.kind).body })
    .eq("id", args.client.id);
  if (args.kind !== "review") {
    await logHeadshotEvent(db, { clientId: args.client.id, actor: args.actor, kind: "requested", detail: { kind: args.kind, reason: row.reason } });
  }
  // the initial request goes now when it's a sensible hour for them; else the tick sends it
  await sendDueReminder(db, args.client, now).catch(() => {});
}

export async function cancelRequest(db: Admin, clientId: string, actor: string, now = new Date()): Promise<void> {
  await (db as any)
    .from("account_headshot_requests")
    .update({ cancelled_at: now.toISOString() })
    .eq("client_id", clientId)
    .is("resolved_at", null)
    .is("cancelled_at", null);
  await (db as any)
    .from("clients")
    .update({ profile_picture_needs_update: false, profile_picture_needs_update_at: null, profile_picture_needs_update_reason: null })
    .eq("id", clientId);
  await logHeadshotEvent(db, { clientId, actor, kind: "request_cancelled" });
}

/* ---- reminders -------------------------------------------------------- */

function localHourIn(tz: string | null, at: Date): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Winnipeg", hour: "numeric", hourCycle: "h23" }).format(at)) % 24;
  } catch {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Winnipeg", hour: "numeric", hourCycle: "h23" }).format(at)) % 24;
  }
}

/** Mid-workout? (a workout touched in the last 3 hours and not finished) */
async function trainingNow(db: Admin, clientId: string, now: Date): Promise<boolean> {
  const { data } = await (db as any)
    .from("pl_day_completions")
    .select("id")
    .eq("client_id", clientId)
    .is("completed_at", null)
    .gte("last_activity_at", new Date(now.getTime() - 3 * 3_600_000).toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Send the due reminder push for one client, if one is due: never while
 * snoozed, never at night or dinner time (their own clock), never mid-workout,
 * never while a photo waits for review. One per reminder moment.
 */
export async function sendDueReminder(db: Admin, c: ClientRow, now = new Date(), settings?: PhotoReminderSettings): Promise<boolean> {
  if (!headshotApplies(c) || !c.user_id) return false;
  const s = settings ?? (await loadPhotoSettings(db));
  const req = await requestFor(db, c.id);
  if (!isOpen(req)) return false;
  const r = { openedAt: new Date(req.opened_at), remindersSent: req.reminders_sent, snoozedUntil: req.snoozed_until ? new Date(req.snoozed_until) : null };
  if (!shouldSendHeadshotReminder(r, now, s.headshot)) return false;
  const { count: pending } = await (db as any)
    .from("account_headshots")
    .select("id", { count: "exact", head: true })
    .eq("client_id", c.id)
    .eq("status", "pending");
  if ((pending ?? 0) > 0) return false;
  if (!goodReminderHour(localHourIn(c.timezone, now))) return false;
  if (await trainingNow(db, c.id, now)) return false;
  const due = headshotPointsDue(r.openedAt, now, s.headshot);
  // claimed before sending, so two ticks never send the same reminder
  const { data: claimed } = await (db as any)
    .from("account_headshot_requests")
    .update({ reminders_sent: due, last_reminded_at: now.toISOString() })
    .eq("client_id", c.id)
    .eq("reminders_sent", req.reminders_sent)
    .select("client_id");
  if (!claimed?.length) return false;
  const copy = clientCopyFor(c.profile_picture_url ? req.kind : "onboarding");
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    await sendWebPushToUser(
      db,
      c.user_id,
      { title: copy.title, body: copy.body, url: "/portal/account#account-headshot", tag: "account-headshot", data: { kind: "account_headshot" } },
      { category: "reminders", eventKey: `headshot:${c.id}:${req.opened_at}:${due}`, priority: "normal" },
    );
  } catch (e) {
    console.warn("[headshots] reminder push failed", e);
  }
  await logHeadshotEvent(db, { clientId: c.id, kind: "reminder_sent", detail: { number: due } });
  return true;
}

/** Finish a previously checked self-capture without waiting for the hourly worker.
 * Called only after real owner or staff access has been checked. Never invoked by POV.
 * The atomic RPC independently checks the current account owner and stored evidence.
 */
export async function recoverPendingHeadshot(db: Admin, c: ClientRow | null, now = new Date()): Promise<boolean> {
  if (!c || !headshotApplies(c)) return false;
  const { data: h, error } = await (db as any).from("account_headshots")
    .select("id,user_id,method,flags,server_checks")
    .eq("client_id", c.id).eq("status", "pending").eq("method", "guided")
    .order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !h || h.user_id !== c.user_id || !canAutoSaveHeadshot(h.method, h.flags, h.server_checks)) return false;
  try {
    await decide(db, { headshotId: h.id, actor: h.user_id, decision: "accept", note: null, automatic: true }, now);
    return true;
  } catch (e) {
    console.warn("[headshots] pending capture recovery failed", h.id, e);
    return false;
  }
}

/** The hourly tick: onboarding requests, due reminders, expired sessions, evidence past retention. */
export async function runHeadshotTick(db: Admin, now = new Date()): Promise<{ reminders: number; purged: number; expired: number }> {
  const s = await loadPhotoSettings(db);
  let reminders = 0;
  // Recover previously submitted, fully checked photos, including interrupted finalizations.
  // Only eligible rows are selected; the commit RPC independently checks ownership and evidence.
  const { data: ready } = await (db as any).from("account_headshots")
    .select("id, user_id, method, flags, server_checks")
    .eq("status", "pending").eq("method", "guided")
    .contains("server_checks", { blink: { confirmed: true }, turn: { confirmed: true } })
    .containedBy("flags", ["exif", "same_as_before"]).order("submitted_at").limit(100);
  for (const h of ready ?? []) {
    if (!canAutoSaveHeadshot(h.method, h.flags, h.server_checks)) continue;
    try {
      await decide(db, { headshotId: h.id, actor: h.user_id, decision: "accept", note: null, automatic: true }, now);
    } catch (e) { console.warn("[headshots] automatic finalization failed", h.id, e); }
  }
  // new coaching clients since onboarding headshots began, with no photo: their onboarding request
  if (s.headshot.requiredSince) {
    const { data: fresh } = await (db as any)
      .from("clients")
      .select(CLIENT_COLS)
      .eq("service_tier", "coaching")
      .eq("archived", false)
      .is("profile_picture_url", null)
      .not("user_id", "is", null)
      .gte("created_at", s.headshot.requiredSince)
      .limit(200);
    for (const c of (fresh ?? []) as ClientRow[]) await ensureOnboardingRequest(db, c, s);
  }
  if (s.headshot.enabled) {
    const { data: open } = await (db as any)
      .from("account_headshot_requests")
      .select("client_id")
      .is("resolved_at", null)
      .is("cancelled_at", null)
      .limit(500);
    const ids = ((open ?? []) as { client_id: string }[]).map((r) => r.client_id);
    for (let i = 0; i < ids.length; i += 100) {
      const { data: rows } = await (db as any).from("clients").select(CLIENT_COLS).in("id", ids.slice(i, i + 100));
      for (const c of (rows ?? []) as ClientRow[]) {
        const scoped = await withHandlingAccess(db, c).catch(() => null);
        if (scoped && await sendDueReminder(db, scoped, now, s).catch(() => false)) reminders++;
      }
    }
  }
  // capture sessions nobody finished
  const { data: stale } = await (db as any)
    .from("account_headshots")
    .update({ status: "expired" })
    .eq("status", "capturing")
    .lt("expires_at", new Date(now.getTime() - 3_600_000).toISOString())
    .select("id, client_id");
  for (const r of (stale ?? []) as { id: string; client_id: string }[]) await removeFiles(db, r.client_id, r.id);
  // evidence frames (and photos not in use) past their retention after a decision
  const cutoff = new Date(now.getTime() - s.evidenceRetentionDays * DAY_MS).toISOString();
  const { data: old } = await (db as any)
    .from("account_headshots")
    .select("id, client_id")
    .in("status", ["accepted", "declined", "superseded", "failed", "expired"])
    .is("files_purged_at", null)
    .lt("updated_at", cutoff)
    .limit(200);
  let purged = 0;
  for (const r of (old ?? []) as { id: string; client_id: string }[]) {
    await removeFiles(db, r.client_id, r.id);
    await (db as any).from("account_headshots").update({ files_purged_at: now.toISOString(), photo_path: null, evidence_path: null }).eq("id", r.id);
    await logHeadshotEvent(db, { clientId: r.client_id, headshotId: r.id, kind: "files_deleted", detail: { retention_days: s.evidenceRetentionDays } });
    purged++;
  }
  return { reminders, purged, expired: stale?.length ?? 0 };
}

/* ---- the Crew picture reminder --------------------------------------- */

/** Should this person see the Crew picture reminder now? Never staff, a test login, or someone owed a headshot reminder. */
export async function crewReminderFor(db: Admin, userId: string, now = new Date()): Promise<{ show: boolean }> {
  const s = await loadPhotoSettings(db);
  if (!s.crew.enabled) return { show: false };
  const [{ data: profile }, { data: staff }, { data: test }, { data: state }, { data: auth }, client] = await Promise.all([
    (db as any).from("community_profiles").select("avatar_path, same_person_as").eq("user_id", userId).maybeSingle(),
    (db as any).rpc("community_staff_people"),
    (db as any).rpc("is_test_login", { _uid: userId }),
    (db as any).from("photo_reminder_state").select("crew_dismissed_at").eq("user_id", userId).maybeSingle(),
    db.auth.admin.getUserById(userId),
    clientForUser(db, userId),
  ]);
  if (profile?.avatar_path || profile?.same_person_as) return { show: false };
  const staffIds = new Set(((staff ?? []) as any[]).map((r) => (typeof r === "string" ? r : r?.community_staff_people ?? r?.user_id)));
  if (staffIds.has(userId) || test === true) return { show: false };
  if (!client || client.archived || GONE.has(String(client.status ?? ""))) return { show: false };
  const createdAt = (auth as any)?.user?.created_at as string | undefined;
  if (!createdAt) return { show: false };
  const due = crewReminderDue({
    hasCrewPicture: false,
    accountStart: new Date(createdAt),
    dismissedAt: state?.crew_dismissed_at ? new Date(state.crew_dismissed_at) : null,
    now,
    settings: s.crew,
  });
  if (!due) return { show: false };
  // never on top of an outstanding headshot reminder: one photo ask at a time
  if (headshotApplies(client)) {
    const req = await requestFor(db, client.id);
    if (isOpen(req) && headshotCardDue({ snoozedUntil: req.snoozed_until ? new Date(req.snoozed_until) : null }, now)) return { show: false };
  }
  return { show: true };
}

export async function dismissCrewReminder(db: Admin, userId: string, now = new Date()): Promise<void> {
  const { data } = await (db as any).from("photo_reminder_state").select("crew_dismiss_count").eq("user_id", userId).maybeSingle();
  await (db as any)
    .from("photo_reminder_state")
    .upsert({ user_id: userId, crew_dismissed_at: now.toISOString(), crew_dismiss_count: (data?.crew_dismiss_count ?? 0) + 1, updated_at: now.toISOString() }, { onConflict: "user_id" });
}

/* ---- the staff view ---------------------------------------------------- */

/** What a server function may return (TanStack checks it serialises). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type StaffHeadshotView = {
  clientId: string;
  status: HeadshotStatus;
  currentUrl: string | null;
  currentSource: string | null;
  currentUpdatedAt: string | null;
  pending: null | {
    id: string;
    method: CaptureMethod;
    submittedAt: string;
    photoUrl: string | null;
    evidenceUrl: string | null;
    challenge: ChallengeStep[];
    flags: string[];
    server: { [k: string]: Json };
    device: { [k: string]: Json } | null;
    tiles: number;
  };
  request: null | {
    kind: RequestKind;
    openedAt: string;
    openedBy: string | null;
    reason: string | null;
    remindersSent: number;
    lastRemindedAt: string | null;
    snoozedUntil: string | null;
  };
  events: { at: string; kind: string; actor: string | null; detail: { [k: string]: Json } }[];
};

export async function staffView(db: Admin, clientId: string, viewer: string): Promise<StaffHeadshotView> {
  const c = await clientById(db, clientId);
  if (!c) throw new Error("That client isn't there any more.");
  const [req, { data: pendingRow }, { data: accepted }, { data: ev }, { data: client2 }] = await Promise.all([
    requestFor(db, clientId),
    (db as any).from("account_headshots").select("*").eq("client_id", clientId).eq("status", "pending").maybeSingle(),
    (db as any).from("account_headshots").select("display_path").eq("client_id", clientId).eq("status", "accepted").order("decided_at", { ascending: false }).limit(1).maybeSingle(),
    (db as any).from("account_headshot_events").select("at, kind, actor, detail").eq("client_id", clientId).order("at", { ascending: false }).limit(25),
    (db as any).from("clients").select("profile_picture_source, profile_picture_updated_at").eq("id", clientId).maybeSingle(),
  ]);
  const open = isOpen(req) ? req : null;
  const names = await staffNames(db, [open?.opened_by, ...((ev ?? []) as any[]).map((e) => e.actor)]);
  // who looked at a photo waiting for review (once per person per half hour, so the record stays readable)
  if (pendingRow) {
    const { count } = await (db as any)
      .from("account_headshot_events")
      .select("id", { count: "exact", head: true })
      .eq("headshot_id", pendingRow.id)
      .eq("actor", viewer)
      .eq("kind", "evidence_viewed")
      .gte("at", new Date(Date.now() - 30 * 60_000).toISOString());
    if (!count) await logHeadshotEvent(db, { clientId, headshotId: pendingRow.id, actor: viewer, kind: "evidence_viewed" });
  }
  return {
    clientId,
    status: headshotStatus({ displayPath: c.profile_picture_url, acceptedDisplayPath: accepted?.display_path ?? null, pending: !!pendingRow, openRequest: open }),
    currentUrl: await signed(db, AVATARS, c.profile_picture_url),
    currentSource: client2?.profile_picture_source ?? null,
    currentUpdatedAt: client2?.profile_picture_updated_at ?? null,
    pending: pendingRow
      ? {
          id: pendingRow.id,
          method: pendingRow.method,
          submittedAt: pendingRow.submitted_at,
          photoUrl: await signed(db, BUCKET, pendingRow.photo_path, 900),
          evidenceUrl: await signed(db, BUCKET, pendingRow.evidence_path, 900),
          challenge: pendingRow.challenge ?? [],
          flags: pendingRow.flags ?? [],
          server: pendingRow.server_checks ?? {},
          device: pendingRow.device_checks ?? null,
          tiles: stripTiles(pendingRow.challenge ?? []),
        }
      : null,
    request: open
      ? {
          kind: open.kind,
          openedAt: open.opened_at,
          openedBy: open.opened_by ? names.get(open.opened_by) ?? "Staff" : null,
          reason: open.reason,
          remindersSent: open.reminders_sent,
          lastRemindedAt: open.last_reminded_at,
          snoozedUntil: open.snoozed_until,
        }
      : null,
    events: ((ev ?? []) as any[])
      .filter((e) => e.kind !== "evidence_viewed")
      .map((e) => ({ at: e.at, kind: e.kind, actor: e.actor ? names.get(e.actor) ?? (e.actor === c.user_id ? "Client" : "Staff") : null, detail: e.detail ?? {} })),
  };
}

async function staffNames(db: Admin, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (!list.length) return out;
  const [{ data: co }, { data: pr }] = await Promise.all([
    (db as any).from("coaches").select("user_id, full_name").in("user_id", list),
    (db as any).from("profiles").select("id, full_name").in("id", list),
  ]);
  for (const p of (pr ?? []) as any[]) if (p.full_name) out.set(p.id, p.full_name);
  for (const c of (co ?? []) as any[]) if (c.full_name) out.set(c.user_id, c.full_name);
  return out;
}

export type HeadshotQueueItem = {
  clientId: string;
  name: string;
  status: HeadshotStatus;
  submittedAt: string | null;
  photoUrl: string | null;
  headshotId: string | null;
  flags: string[];
  requestKind: RequestKind | null;
  openedAt: string | null;
  remindersSent: number;
};

/** What waits on staff: submissions to review, then open requests. `reachable` limits it to the caller's clients. */
export async function headshotQueue(db: Admin, reachable: (ids: string[]) => Promise<Set<string>>): Promise<HeadshotQueueItem[]> {
  const [{ data: pend }, { data: reqs }] = await Promise.all([
    (db as any).from("account_headshots").select("id, client_id, submitted_at, photo_path, flags").eq("status", "pending").order("submitted_at", { ascending: true }).limit(100),
    (db as any).from("account_headshot_requests").select("client_id, kind, opened_at, reminders_sent").is("resolved_at", null).is("cancelled_at", null).limit(300),
  ]);
  const ids = [...new Set([...((pend ?? []) as any[]).map((p) => p.client_id), ...((reqs ?? []) as any[]).map((r) => r.client_id)])];
  if (!ids.length) return [];
  const ok = await reachable(ids);
  const { data: clients } = await (db as any).from("clients").select(CLIENT_COLS).in("id", ids.filter((i) => ok.has(i)));
  const scopedClients = await Promise.all(((clients ?? []) as ClientRow[]).map(c => withHandlingAccess(db, c).catch(() => null)));
  const byId = new Map(scopedClients.filter((c): c is ClientRow => !!c && headshotApplies(c)).map((c) => [c.id, c]));
  const nameOf = (c: ClientRow) => c.preferred_name || c.full_name || c.first_name || "Client";
  const out: HeadshotQueueItem[] = [];
  const seen = new Set<string>();
  for (const p of (pend ?? []) as any[]) {
    const c = byId.get(p.client_id);
    if (!c) continue;
    seen.add(c.id);
    const r = ((reqs ?? []) as any[]).find((x) => x.client_id === c.id);
    out.push({
      clientId: c.id,
      name: nameOf(c),
      status: "pending",
      submittedAt: p.submitted_at,
      photoUrl: await signed(db, BUCKET, p.photo_path, 900),
      headshotId: p.id,
      flags: p.flags ?? [],
      requestKind: r?.kind ?? null,
      openedAt: r?.opened_at ?? null,
      remindersSent: r?.reminders_sent ?? 0,
    });
  }
  for (const r of (reqs ?? []) as any[]) {
    const c = byId.get(r.client_id);
    if (!c || seen.has(c.id)) continue;
    out.push({
      clientId: c.id,
      name: nameOf(c),
      status: r.kind === "onboarding" ? "missing" : "retake_requested",
      submittedAt: null,
      photoUrl: null,
      headshotId: null,
      flags: [],
      requestKind: r.kind,
      openedAt: r.opened_at,
      remindersSent: r.reminders_sent ?? 0,
    });
  }
  return out;
}

export { HEADSHOT_CONSENT_VERSION };
