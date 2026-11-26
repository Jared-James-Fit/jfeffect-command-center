/**
 * Crew safety on the phone (App Review Guideline 1.2): the Crew community
 * guidelines (agreed to with the Terms when the account is made, never asked
 * mid-comment: 20270531100000_crew_guidelines_at_signup.sql), what you reported
 * leaving your screen at once, people you blocked left off Rankings, and the
 * words for the server's refusals. The server decides all of it
 * (20270527109000_crew_ugc_safety.sql); this only hides early and explains.
 */
import { useQuery, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { withoutComment, withoutPosts } from "@/lib/crew-moderation";

export { withoutBlocked } from "@/lib/crew-moderation";

const db = supabase as any;

/** Where the guidelines and the team can be reached (the guidelines page, Settings and Help). */
export const CREW_CONTACT_EMAIL = "support@jfeffect.com";
export const CREW_TERMS_SLUG = "terms-of-service";
/** The public page the guidelines live on (sign-up links to it; Settings opens the same words). */
export const CREW_GUIDELINES_PATH = "/community-guidelines";

/** The guidelines, in the words every screen shows (and Terms 8.1 repeats). Zero tolerance, said plainly. */
export const CREW_RULES: readonly { title: string; body: string }[] = [
  { title: "Zero tolerance", body: "No hate, slurs, harassment, threats, sexual content, or anything that encourages self-harm. Ever." },
  { title: "No abusive users", body: "Bullying or targeting someone gets your posting suspended or your account removed." },
  { title: "Report and block", body: "Use ⋯ on any post, story, comment or profile to report it or block the person. The JF Effect team reviews every report within 24 hours." },
  { title: "Your posts, your responsibility", body: "Only share what you have the right to share. Words that break these guidelines can't be posted." },
];

/* ---- server refusals -------------------------------------------------- */

type DbError = { hint?: string | null; message?: string | null; code?: string | null } | null | undefined;

export const isCrewSuspendedError = (e: unknown) => (e as DbError)?.hint === "crew_suspended";

/* ---- my moderation state (warnings, a pause) -------------------------- */

export type CrewModeration = {
  rules_version: number;
  rules_accepted: boolean;
  posting_paused_until: string | null;
  warning: { note: string | null; at: string } | null;
};
export const crewModerationKey = ["crew-moderation"] as const;

export function useCrewModeration(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: crewModerationKey,
    enabled: enabled && !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CrewModeration | null> => {
      const { data, error } = await db.rpc("community_my_moderation");
      if (error) return null;
      return (data ?? null) as CrewModeration | null;
    },
  });
}

/* ---- what I reported leaves my screen at once ------------------------- */

type FeedPage = { posts: { id: string }[] };

/**
 * Takes a reported post or story out of every list on this phone (feed,
 * stories, profiles, saved), or a reported comment out of its thread.
 */
export function hideReportedLocally(qc: QueryClient, kind: "post" | "comment", id: string, postId?: string | null) {
  if (kind === "post") {
    const ids = new Set([id]);
    for (const key of [["community-feed"], ["community-saved"], ["community-user-reposts"]]) {
      qc.setQueriesData<InfiniteData<FeedPage>>({ queryKey: key }, (old) => withoutPosts(old, ids));
    }
  } else if (postId) {
    qc.setQueryData<{ id: string; parent_id?: string | null }[]>(["community-comments", postId], (old) => withoutComment(old, id));
  }
}

/** After a block or unblock: who you can see, find and follow all change with it (Rankings too). */
export function refreshAfterBlock(qc: QueryClient) {
  for (const key of ["community-profile", "community-feed", "community-members", "community-suggestions", "community-people-search", "community-follows", "community-follow-list", "community-comments", "crew-blocked-client-ids"]) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

/* ---- Rankings: never someone blocked either way ----------------------- */

export function useBlockedClientIds(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["crew-blocked-client-ids", user?.id ?? null],
    enabled: enabled && !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await db.rpc("community_blocked_client_ids");
      if (error || !Array.isArray(data)) return [];
      return (data as unknown[]).map((x) => (typeof x === "string" ? x : (x as any)?.community_blocked_client_ids)).filter(Boolean);
    },
  });
}
