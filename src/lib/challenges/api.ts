// Live challenges: reads, writes and live updates. Every call is a database
// function that checks who's asking (20270205090000_live_challenges.sql);
// nothing here decides permissions.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AthleteProfile, BoardData, ChallengePageData, ConsoleData, HubCard, ResultData } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const MEDIA_BUCKET = "challenge-media";

/** Public URL of a cover, sponsor logo or (consented) athlete photo. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** A database error as a sentence a person can act on. */
export function errorText(e: unknown, fallback = "Something went wrong. Try again."): string {
  const msg = (e as { message?: string } | null)?.message ?? "";
  if (!msg) return fallback;
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(msg)) return "No connection. Check your signal and try again.";
  if (/JWT|permission denied/i.test(msg)) return "You don't have access to that.";
  return msg.replace(/^ERROR:\s*/, "");
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) throw error;
  return data as T;
}

export const challengeKeys = {
  hub: ["challenges", "hub"] as const,
  page: (slug: string) => ["challenges", "page", slug] as const,
  board: (slug: string) => ["challenges", "board", slug] as const,
  result: (slug: string, handle: string) => ["challenges", "result", slug, handle] as const,
  athlete: (handle: string) => ["challenges", "athlete", handle] as const,
  console: (id: string) => ["challenges", "console", id] as const,
  me: ["challenges", "me"] as const,
};

export const fetchHub = () => rpc<HubCard[]>("challenge_hub");
export const fetchPage = (slug: string) => rpc<ChallengePageData | null>("challenge_page", { p_slug: slug });
export const fetchBoard = (slug: string) => rpc<BoardData | null>("challenge_board", { p_slug: slug });
export const fetchResult = (slug: string, handle: string) => rpc<ResultData | null>("challenge_result", { p_slug: slug, p_handle: handle });
export const fetchAthlete = (handle: string) => rpc<AthleteProfile | null>("challenge_athlete", { p_handle: handle });
export const fetchConsole = (id: string) => rpc<ConsoleData>("challenge_console", { p_challenge: id });

export function useHub(initial?: HubCard[]) {
  return useQuery({ queryKey: challengeKeys.hub, queryFn: fetchHub, initialData: initial, staleTime: 15_000 });
}

/** Live while the challenge can still change: refetch on bump, poll as a fallback. */
function liveInterval(status: string | undefined) {
  return status === "live" || status === "paused" || status === "verifying" ? 20_000 : false;
}

export function usePage(slug: string, initial?: ChallengePageData | null) {
  return useQuery({
    queryKey: challengeKeys.page(slug),
    queryFn: () => fetchPage(slug),
    initialData: initial ?? undefined,
    // the server render was anonymous: fetch again for the signed-in viewer
    initialDataUpdatedAt: 0,
    staleTime: 10_000,
    refetchInterval: (q) => liveInterval(q.state.data?.challenge.status),
  });
}

export function useBoard(slug: string, enabled = true, initial?: BoardData | null) {
  return useQuery({
    queryKey: challengeKeys.board(slug),
    queryFn: () => fetchBoard(slug),
    enabled,
    initialData: initial ?? undefined,
    staleTime: 5_000,
    refetchInterval: (q) => liveInterval(q.state.data?.status),
  });
}

/**
 * Subscribes to the challenge's public version number and refetches whatever
 * reads that challenge when it moves. `onBump` also gets the new version.
 */
export function useChallengeLive(challengeId: string | null | undefined, onBump?: (version: number) => void) {
  const qc = useQueryClient();
  const cb = useRef(onBump);
  cb.current = onBump;
  useEffect(() => {
    if (!challengeId || typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = db
      .channel(`challenge-live:${challengeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "challenge_live", filter: `challenge_id=eq.${challengeId}` },
        (payload: { new?: { version?: number } }) => {
          // a burst of writes (a correction touches several rows) refetches once
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            qc.invalidateQueries({ queryKey: ["challenges"] });
            if (payload.new?.version != null) cb.current?.(payload.new.version);
          }, 250);
        },
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") qc.invalidateQueries({ queryKey: ["challenges"] });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      db.removeChannel(channel);
    };
  }, [challengeId, qc]);
}

// ── Analytics: a random id per browser, never a name or an IP ─────────

const VISITOR_KEY = "jf_challenge_visitor";
export function visitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, "");
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return `s-${Math.random().toString(36).slice(2, 14)}`;
  }
}

export type TrackKind =
  | "page_view"
  | "result_view"
  | "profile_view"
  | "display_open"
  | "join_view"
  | "card_download"
  | "share_sheet"
  | "copy_link"
  | "copy_caption"
  | "invite_link"
  | "join_click"
  | "coaching_click"
  | "calendar_add";

export function track(slug: string | null, kind: TrackKind, opts: { handle?: string | null; ref?: string | null; source?: string | null } = {}) {
  if (typeof window === "undefined") return;
  void db
    .rpc("challenge_track", {
      p_slug: slug,
      p_kind: kind,
      p_visitor: visitorId(),
      p_handle: opts.handle ?? null,
      p_ref: opts.ref ?? null,
      p_source: opts.source ?? null,
    })
    .then(() => undefined, () => undefined);
}

/** ?ref= and ?src= from a shared link, remembered for this visit so the sign-up gets credit. */
export function arrival(search: { ref?: string; src?: string }): { ref: string | null; source: string | null } {
  const key = "jf_challenge_arrival";
  const clean = (s?: string) => (s && /^[a-z0-9-]{1,40}$/i.test(s) ? s.toLowerCase() : null);
  const ref = clean(search.ref);
  const source = clean(search.src);
  try {
    if (ref || source) {
      sessionStorage.setItem(key, JSON.stringify({ ref, source }));
      return { ref, source };
    }
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return { ref: saved?.ref ?? null, source: saved?.source ?? null };
  } catch {
    return { ref, source };
  }
}

// ── Writes ─────────────────────────────────────────────────────────────

export interface RegistrationInput {
  display_name: string;
  full_name?: string;
  email?: string;
  phone?: string;
  instagram?: string;
  division_id?: string | null;
  acks: string[];
  show_name: boolean;
  photo_consent: boolean;
  marketing: boolean;
  ref?: string | null;
  via?: string | null;
  bodyweight_kg?: number | null;
  check_in?: boolean;
}

export interface RegistrationResult {
  entry_id?: string;
  athlete_id?: string;
  bib: number;
  handle: string;
  status: string;
  already?: boolean;
  created?: boolean;
  photo_nonce?: string | null;
  claimed?: boolean;
}

export const selfRegister = (slug: string, input: RegistrationInput) =>
  rpc<RegistrationResult>("challenge_self_register", { p_slug: slug, p: input });

export const staffRegister = (challengeId: string, input: RegistrationInput) =>
  rpc<RegistrationResult>("challenge_staff_register", { p_challenge: challengeId, p: input });

/** Upload a consented photo (already cropped and compressed) and attach it. */
export async function uploadAthletePhoto(athleteId: string, blob: Blob, nonce?: string | null): Promise<string> {
  const name = nonce ?? (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  const path = `athletes/${athleteId}/${name}.jpg`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
  if (error) throw error;
  const res = await rpc<{ photo: string; old: string | null }>("challenge_set_athlete_photo", { p_athlete: athleteId, p_path: path });
  if (res.old && res.old !== path) {
    // best effort: the old file goes (a public form can't delete, which is fine)
    void supabase.storage.from(MEDIA_BUCKET).remove([res.old]).then(() => undefined, () => undefined);
  }
  return path;
}

export async function removeAthletePhoto(athleteId: string) {
  const res = await rpc<{ old: string | null }>("challenge_remove_athlete_photo", { p_athlete: athleteId });
  if (res.old) await supabase.storage.from(MEDIA_BUCKET).remove([res.old]);
}

/** A cover or sponsor logo for a challenge (owner / manager). */
export async function uploadChallengeImage(challengeId: string, blob: Blob): Promise<string> {
  const id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  const path = `challenges/${challengeId}/${id}.jpg`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
  if (error) throw error;
  return path;
}

export function newClientKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // RFC4122-ish fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const recordAttempt = (args: {
  entryId: string;
  value: number;
  result: "valid" | "no_lift";
  clientKey: string;
  note?: string | null;
  video?: string | null;
  bodyweightKg?: number | null;
}) =>
  rpc<{ attempt_id: string; attempt_no: number; duplicate: boolean; rank: number | null; division_rank: number | null; score: number | null; tied: boolean | null; ranked: number }>(
    "challenge_record_attempt",
    {
      p_entry: args.entryId,
      p_value: args.value,
      p_result: args.result,
      p_client_key: args.clientKey,
      p_note: args.note ?? null,
      p_video_url: args.video ?? null,
      p_bodyweight_kg: args.bodyweightKg ?? null,
    },
  );

export const correctAttempt = (attemptId: string, value: number, result: "valid" | "no_lift", reason: string) =>
  rpc("challenge_correct_attempt", { p_attempt: attemptId, p_value: value, p_result: result, p_reason: reason });
export const voidAttempt = (attemptId: string, reason: string) => rpc("challenge_void_attempt", { p_attempt: attemptId, p_reason: reason });
export const updateEntry = (entryId: string, patch: Record<string, unknown>) => rpc("challenge_update_entry", { p_entry: entryId, p: patch });
export const setNowUp = (challengeId: string, entryId: string | null) => rpc("challenge_set_now_up", { p_challenge: challengeId, p_entry: entryId });
export const setStatus = (challengeId: string, status: string, reason?: string) =>
  rpc<{ status: string }>("challenge_set_status", { p_challenge: challengeId, p_status: status, p_reason: reason ?? null });
export const finalizeResults = (challengeId: string, version: number) => rpc("challenge_finalize", { p_challenge: challengeId, p_version: version });
export const reopenResults = (challengeId: string, reason: string) => rpc("challenge_reopen", { p_challenge: challengeId, p_reason: reason });
export const duplicateChallenge = (fromId: string, title: string, slug: string, template = false) =>
  rpc<string>("challenge_duplicate", { p_from: fromId, p_title: title, p_slug: slug, p_template: template });
export const claimMine = () => rpc<number>("challenge_claim_mine");

export function useChallengeMe(enabled: boolean) {
  return useQuery({
    queryKey: challengeKeys.me,
    enabled,
    queryFn: async () => {
      await claimMine().catch(() => 0);
      return rpc<{
        athlete_id: string;
        handle: string;
        name: string;
        photo: string | null;
        instagram: string | null;
        discoverable: boolean;
        email: string | null;
        phone: string | null;
        full_name: string | null;
        marketing: boolean;
        entries: { entry_id: string; slug: string; title: string; status: string; entry_status: string; show_name: boolean; bib: number; competed: boolean }[];
      } | null>("challenge_me");
    },
    staleTime: 30_000,
  });
}

export { rpc as challengeRpc };
