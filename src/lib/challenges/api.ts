/**
 * Live challenges: database calls and the React Query hooks every page uses.
 * Public reads go through the challenge_* functions (anon-safe fields only);
 * staff writes go through their own functions, which check the caller's role.
 */
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listenChannel } from "@/lib/realtime-channel";
import type {
  AthleteProfile,
  Board,
  ChallengePublic,
  EntryPublic,
  HubChallenge,
  StaffBoard,
} from "@/lib/challenges/model";

// The generated client types don't know these functions yet; one loose handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const MEDIA_BUCKET = "challenge-media";

/** Public URL of a photo, cover or logo in the challenge bucket. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  try {
    return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

/** A database error as the sentence the function raised. */
export function errorText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e ?? "");
  if (/not_allowed|permission denied|42501/i.test(msg)) return "You don't have access to do that.";
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg))
    return "No connection. Check your signal and try again.";
  return msg.replace(/^.*?ERROR:\s*/i, "").trim() || "Something went wrong.";
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) throw error;
  return data as T;
}

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

export const keys = {
  hub: ["challenges", "hub"] as const,
  challenge: (slug: string) => ["challenges", "public", slug] as const,
  board: (slug: string) => ["challenges", "board", slug] as const,
  entry: (code: string) => ["challenges", "entry", code] as const,
  athlete: (handle: string) => ["challenges", "athlete", handle] as const,
  staff: (id: string) => ["challenges", "staff", id] as const,
  adminList: ["challenges", "admin-list"] as const,
  insights: (id: string) => ["challenges", "insights", id] as const,
  myEvents: ["challenges", "my-events"] as const,
  myHandle: ["challenges", "my-handle"] as const,
};

export const fetchHub = () => rpc<HubChallenge[]>("challenge_hub");
export const fetchChallenge = (slug: string) =>
  rpc<ChallengePublic | null>("challenge_public", { p_slug: slug });
export const fetchBoard = (slug: string) => rpc<Board | null>("challenge_board", { p_slug: slug });
export const fetchEntry = (code: string) =>
  rpc<EntryPublic | null>("challenge_entry_public", { p_code: code });
export const fetchAthlete = (handle: string) =>
  rpc<AthleteProfile | null>("challenge_athlete", { p_handle: handle });
export const fetchStaffBoard = (id: string) =>
  rpc<StaffBoard>("challenge_staff_board", { p_challenge: id });

/** Pages that are only interesting while something can still change poll gently as a backup to realtime. */
function pollMs(status: string | undefined): number | false {
  if (status === "live" || status === "paused" || status === "verifying") return 15_000;
  if (status === "upcoming") return 60_000;
  return false;
}

export function useHub() {
  return useQuery({
    queryKey: keys.hub,
    queryFn: fetchHub,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useChallenge(slug: string, initial?: ChallengePublic | null) {
  return useQuery({
    queryKey: keys.challenge(slug),
    queryFn: () => fetchChallenge(slug),
    initialData: initial ?? undefined,
    staleTime: 10_000,
    refetchInterval: (q) =>
      pollMs((q.state.data as ChallengePublic | null | undefined)?.status) || 120_000,
  });
}

export function useBoard(slug: string, status: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.board(slug),
    queryFn: () => fetchBoard(slug),
    enabled,
    staleTime: 5_000,
    refetchInterval: pollMs(status),
  });
}

export function useEntry(code: string, initial?: EntryPublic | null) {
  return useQuery({
    queryKey: keys.entry(code),
    queryFn: () => fetchEntry(code),
    initialData: initial ?? undefined,
    staleTime: 5_000,
    refetchInterval: (q) =>
      pollMs((q.state.data as EntryPublic | null | undefined)?.challenge.status),
  });
}

export function useAthlete(handle: string, initial?: AthleteProfile | null) {
  return useQuery({
    queryKey: keys.athlete(handle),
    queryFn: () => fetchAthlete(handle),
    initialData: initial ?? undefined,
    staleTime: 30_000,
  });
}

export function useStaffBoard(id: string | undefined) {
  return useQuery({
    queryKey: keys.staff(id ?? ""),
    queryFn: () => fetchStaffBoard(id!),
    enabled: !!id,
    staleTime: 3_000,
    refetchInterval: 20_000,
  });
}

/**
 * Realtime: every open page listens to its challenge's version counter and
 * refreshes when it moves (a score, a registration, a status change). Polling
 * stays on as the backup, so a dropped socket only ever means "a bit slower".
 */
export function useLiveChallenge(challengeId: string | null | undefined, onChange?: () => void) {
  const qc = useQueryClient();
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!challengeId || typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = listenChannel(`challenge-live-${challengeId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "challenge_live",
          filter: `challenge_id=eq.${challengeId}`,
        },
        () => {
          // a burst of saves (a correction is two writes) refreshes once
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            invalidateChallenge(qc);
            cb.current?.();
          }, 250);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [challengeId, qc]);
}

export function invalidateChallenge(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["challenges"] });
}

/* ------------------------------------------------------------------ */
/*  Writes                                                             */
/* ------------------------------------------------------------------ */

export type RegisterInput = {
  public_name: string;
  full_name: string;
  email: string;
  phone?: string;
  instagram?: string;
  division_id?: string | null;
  show_photo: boolean;
  marketing_opt_in: boolean;
  acknowledged: string[];
  bodyweight_kg?: number | null;
  ref?: string | null;
  ref_source?: "qr" | "link" | "friend" | "display" | null;
};
export type RegisterResult = {
  entry_id: string;
  code: string;
  bib: number;
  existing: boolean;
  photo_ticket?: string | null;
  handle?: string;
};

export const registerEntry = (challengeId: string, p: RegisterInput) =>
  rpc<RegisterResult>("challenge_register", { p_challenge: challengeId, p });

export type AttemptResult = {
  id: string;
  entry_id: string;
  attempt_no: number;
  value: number | null;
  valid: boolean;
  score: number | null;
  rank: number | null;
  rank_div: number | null;
  tied: boolean | null;
  of: number;
  replayed?: boolean;
};

export const recordAttempt = (a: {
  entryId: string;
  value: number | null;
  valid: boolean;
  clientKey: string;
  note?: string | null;
  videoUrl?: string | null;
  tiebreak?: boolean;
}) =>
  rpc<AttemptResult>("challenge_record_attempt", {
    p_entry: a.entryId,
    p_value: a.value,
    p_valid: a.valid,
    p_client_key: a.clientKey,
    p_note: a.note ?? null,
    p_video_url: a.videoUrl ?? null,
    p_tiebreak: !!a.tiebreak,
  });

export const correctAttempt = (a: {
  attemptId: string;
  value: number | null;
  valid: boolean;
  reason: string;
  clientKey: string;
}) =>
  rpc<AttemptResult>("challenge_correct_attempt", {
    p_attempt: a.attemptId,
    p_value: a.value,
    p_valid: a.valid,
    p_reason: a.reason,
    p_client_key: a.clientKey,
  });

export const voidAttempt = (attemptId: string, reason: string) =>
  rpc<{ ok: boolean }>("challenge_void_attempt", { p_attempt: attemptId, p_reason: reason });

export const updateEntry = (entryId: string, p: Record<string, unknown>) =>
  rpc<{ ok: boolean }>("challenge_update_entry", { p_entry: entryId, p });
export const deleteEntry = (entryId: string) =>
  rpc<void>("challenge_delete_entry", { p_entry: entryId });
export const setStatus = (id: string, status: string) =>
  rpc<{ status: string }>("challenge_set_status", { p_challenge: id, p_status: status });
export const finalizeResults = (id: string) =>
  rpc<{
    assigned: number;
    ties: { prize_id: string; place: number; title: string; names: string[] }[];
  }>("challenge_finalize", { p_challenge: id });
export const duplicateChallenge = (id: string, asTemplate: boolean, title?: string) =>
  rpc<string>("challenge_duplicate", {
    p_challenge: id,
    p_as_template: asTemplate,
    p_title: title ?? null,
  });
export const resetPractice = (id: string) =>
  rpc<{ cleared: number }>("challenge_reset_practice", { p_challenge: id });
export const photoTicket = (entryId: string) =>
  rpc<string>("challenge_photo_ticket", { p_entry: entryId });
export const myPhotoTicket = () => rpc<string>("challenge_my_photo_ticket");
export const claimProfile = () =>
  rpc<{ handle: string | null; claimed: number }>("challenge_claim");
export const myHandle = () => rpc<string | null>("challenge_my_handle");
export const updateMyProfile = (name: string, discoverable: boolean) =>
  rpc<{ handle: string }>("challenge_update_my_profile", {
    p_display_name: name,
    p_discoverable: discoverable,
  });
export const mergePeople = (keep: string, drop: string) =>
  rpc<{ moved: number; left_behind: number }>("challenge_merge_people", {
    p_keep: keep,
    p_drop: drop,
  });
export const fetchAdminList = () =>
  rpc<
    (HubChallenge & {
      is_template: boolean;
      created_at: string;
      updated_at: string;
      visitors: number;
      shares: number;
    })[]
  >("challenge_admin_list");
export const fetchInsights = (id: string) =>
  rpc<ChallengeInsights>("challenge_insights", { p_challenge: id });
export const fetchStaffList = (id: string) =>
  rpc<{ user_id: string; role: string; email: string; name: string }[]>("challenge_staff_list", {
    p_challenge: id,
  });
export const addStaff = (id: string, email: string, role: string) =>
  rpc<{ user_id: string }>("challenge_add_staff", {
    p_challenge: id,
    p_email: email,
    p_role: role,
  });
export const removeStaff = (id: string, user: string) =>
  rpc<void>("challenge_remove_staff", { p_challenge: id, p_user: user });
export const fetchMyEvents = () =>
  rpc<(HubChallenge & { my_role: string })[]>("challenge_my_events");

export type ChallengeInsights = {
  registered: number;
  checked_in: number;
  competed: number;
  withdrawn: number;
  disqualified: number;
  by_source: { staff: number; self: number; qr: number; friend: number; display: number };
  returning: number;
  photo_consent: number;
  marketing_opt_in: number;
  claimed: number;
  coaching_inquiries: number;
  metrics: Partial<Record<TrackKind, { events: number; visitors: number }>>;
  profile_views: number;
  prize_value_cents: number;
  sponsor_cents: number;
  by_day: { day: string; views: number; registrations: number }[];
};

/** Wraps a write so every challenge screen refreshes after it. */
export function useChallengeMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => invalidateChallenge(qc) });
}

/* ------------------------------------------------------------------ */
/*  Analytics (anonymous, per browser)                                 */
/* ------------------------------------------------------------------ */

export type TrackKind =
  | "view"
  | "display_view"
  | "qr_visit"
  | "ref_visit"
  | "result_view"
  | "profile_view"
  | "share"
  | "download"
  | "copy_link"
  | "copy_caption"
  | "join_start";

const VISITOR_KEY = "jf:challenge-visitor";

function visitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v || !/^[A-Za-z0-9-]{8,64}$/.test(v)) {
      v = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return "anon-" + Math.random().toString(36).slice(2, 12);
  }
}

/** Counted once per browser per half hour (the database dedupes); never throws. */
export function track(
  kind: TrackKind,
  opts: { slug?: string | null; code?: string | null; handle?: string | null } = {},
) {
  if (typeof window === "undefined") return;
  void db
    .rpc("challenge_track", {
      p_slug: opts.slug ?? null,
      p_kind: kind,
      p_visitor: visitorId(),
      p_code: opts.code ?? null,
      p_handle: opts.handle ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/* ------------------------------------------------------------------ */
/*  Links                                                              */
/* ------------------------------------------------------------------ */

export const PUBLIC_ORIGIN = "https://jfeffect.com";

export function challengeUrl(
  slug: string,
  opts: { ref?: string; src?: "qr" | "display" } = {},
): string {
  const u = new URL(`/challenges/${slug}`, PUBLIC_ORIGIN);
  if (opts.ref) u.searchParams.set("ref", opts.ref);
  if (opts.src) u.searchParams.set("src", opts.src);
  return u.toString();
}

export function resultUrl(slug: string, code: string): string {
  return `${PUBLIC_ORIGIN}/challenges/${slug}/r/${code}`;
}

export function joinUrl(slug: string, src?: "qr" | "display"): string {
  return `${PUBLIC_ORIGIN}/challenges/${slug}/join${src ? `?src=${src}` : ""}`;
}

/** "jfeffect.com/challenges/winnipeg-225" for printing on cards. */
export function shortLink(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\?.*$/, "");
}

/* ------------------------------------------------------------------ */
/*  Remember my entries on this phone (self-registered, no account)    */
/* ------------------------------------------------------------------ */

const MINE_KEY = "jf:challenge-entries";

export function rememberEntry(slug: string, code: string) {
  try {
    const all = JSON.parse(localStorage.getItem(MINE_KEY) || "{}") as Record<string, string>;
    all[slug] = code;
    localStorage.setItem(MINE_KEY, JSON.stringify(all));
  } catch {
    /* private mode: they still have the link */
  }
}

export function rememberedEntry(slug: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(MINE_KEY) || "{}") as Record<string, string>;
    return typeof all[slug] === "string" ? all[slug] : null;
  } catch {
    return null;
  }
}
