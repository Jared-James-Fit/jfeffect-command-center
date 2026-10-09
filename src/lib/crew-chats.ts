/**
 * Group chats members start themselves (20261015120000_member_group_chats.sql).
 * They ride on the group chat tables as chat_groups.kind = 'crew'.
 *
 *   - Being added is an invite: see who's in it and what's been said, then
 *     Join or Decline. Looking never shows as "Seen".
 *   - Declining is silent: you keep showing as "Invited" to the others until
 *     the invite runs out (14 days), same as someone who never opened it.
 *   - Anyone who's joined can invite people; whoever started it can remove
 *     people, and that's silent too (the chat just disappears for them).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { CommunityAuthor } from "@/lib/community";
import { directThreadsKey, friendlyError } from "@/lib/direct-chats";

const db = supabase as any;

export type CrewThread = {
  group_id: string;
  name: string;
  status: "joined" | "invited";
  /** I started it (I can rename it and remove people). */
  is_owner: boolean;
  /** Invites: who asked me. */
  invited_by: string | null;
  /** Up to 3 others who've joined. */
  faces: CommunityAuthor[];
  joined: number;
  invited: number;
  last: { body: string; created_at: string; sender_id: string | null; sender_name: string | null; card: boolean; media: boolean } | null;
  last_at: string;
  read_at: string | null;
};

export type CrewPerson = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  status: "joined" | "invited";
  is_owner: boolean;
  is_me: boolean;
  invited_by: string | null;
};

export const crewThreadsKey = ["crew-threads"] as const;
const peopleKey = (id: string) => ["crew-people", id] as const;

export async function listCrewThreads(): Promise<CrewThread[]> {
  const { data, error } = await db.rpc("chat_crew_threads");
  if (error) throw error;
  return Array.isArray(data) ? (data as CrewThread[]) : [];
}

export function useCrewThreads(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: crewThreadsKey,
    enabled: enabled && !!user,
    queryFn: listCrewThreads,
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export function useCrewPeople(groupId: string | null) {
  return useQuery({
    queryKey: peopleKey(groupId ?? ""),
    enabled: !!groupId,
    staleTime: 15_000,
    queryFn: async (): Promise<CrewPerson[]> => {
      const { data, error } = await db.rpc("crew_people", { _group_id: groupId });
      if (error) throw error;
      return Array.isArray(data) ? (data as CrewPerson[]) : [];
    },
  });
}

/** Something new since I looked (my own messages never count; invites use the private read time). */
export function isCrewUnread(t: CrewThread, me: string | null | undefined) {
  if (t.status === "invited" && !t.read_at) return true; // an invite I haven't opened, even to a quiet chat
  if (!t.last || t.last.sender_id === me) return false;
  return !t.read_at || new Date(t.last.created_at).getTime() > new Date(t.read_at).getTime();
}

/** "Dwayne: leg day thursday?" / "You: …" */
export function crewPreview(t: CrewThread, me: string | null | undefined) {
  if (t.status === "invited") return `${t.invited_by ?? "Someone"} invited you`;
  const l = t.last;
  if (!l) return "No messages yet";
  const text = l.body?.trim() || (l.card ? "Shared a post" : l.media ? "Sent an attachment" : "Message");
  if (l.sender_id === me) return `You: ${text}`;
  return l.sender_name ? `${l.sender_name}: ${text}` : text;
}

/** "Amanda, Dwayne and 3 others". */
export function crewSubtitle(t: Pick<CrewThread, "joined" | "invited">) {
  const people = t.joined === 1 ? "1 person" : `${t.joined} people`;
  return t.invited > 0 ? `${people} · ${t.invited} invited` : people;
}

function pushInvites(groupId: string) {
  void (async () => {
    try {
      const { notifyCrewInvite } = await import("@/lib/push/events.functions");
      await notifyCrewInvite({ data: { groupId } });
    } catch (e) {
      console.warn("[push] crew invite push failed", e);
    }
  })();
}

function useInvalidateCrews() {
  const qc = useQueryClient();
  return (groupId?: string) => {
    qc.invalidateQueries({ queryKey: crewThreadsKey });
    qc.invalidateQueries({ queryKey: directThreadsKey });
    qc.invalidateQueries({ queryKey: ["group-unread"] });
    if (groupId) qc.invalidateQueries({ queryKey: peopleKey(groupId) });
  };
}

export function useCreateCrew() {
  const done = useInvalidateCrews();
  return useMutation({
    mutationFn: async ({ name, userIds }: { name: string; userIds: string[] }) => {
      const { data, error } = await db.rpc("crew_create", { _name: name.trim() || null, _invite: userIds });
      if (error) throw new Error(friendlyError(error.message));
      return data as { group_id: string; invited: string[] };
    },
    onSuccess: (r) => {
      pushInvites(r.group_id);
      done(r.group_id);
    },
  });
}

export function useInviteToCrew(groupId: string) {
  const done = useInvalidateCrews();
  return useMutation({
    mutationFn: async (userIds: string[]) => {
      const { data, error } = await db.rpc("crew_invite", { _group_id: groupId, _users: userIds });
      if (error) throw new Error(friendlyError(error.message));
      return data as { invited: string[] };
    },
    onSuccess: () => {
      pushInvites(groupId);
      done(groupId);
    },
  });
}

export type CrewAction = "join" | "decline" | "leave" | "report";

export function useCrewRespond(groupId: string) {
  const done = useInvalidateCrews();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, reason }: { action: CrewAction; reason?: string }) => {
      const { data, error } = await db.rpc("crew_respond", { _group_id: groupId, _action: action, _reason: reason ?? null });
      if (error) throw new Error(friendlyError(error.message));
      if (action === "report" && data?.report_id) {
        void (async () => {
          try {
            const { notifyChatReport } = await import("@/lib/push/events.functions");
            await notifyChatReport({ data: { reportId: data.report_id } });
          } catch (e) {
            console.warn("[push] report push failed", e);
          }
        })();
      }
      return data as { ok: boolean };
    },
    onSuccess: () => {
      done(groupId);
      qc.invalidateQueries({ queryKey: ["group-memberships"] });
      qc.invalidateQueries({ queryKey: ["group-members", groupId] });
    },
  });
}

/** Whoever started it: remove someone (or take back an invite). They're not told. */
export function useRemoveFromCrew(groupId: string) {
  const done = useInvalidateCrews();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await db.rpc("crew_remove", { _group_id: groupId, _user_id: userId });
      if (error) throw new Error(friendlyError(error.message));
    },
    onSuccess: () => done(groupId),
  });
}

export function useRenameCrew(groupId: string) {
  const done = useInvalidateCrews();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await db.rpc("crew_rename", { _group_id: groupId, _name: name });
      if (error) throw new Error(friendlyError(error.message));
    },
    onSuccess: () => done(groupId),
  });
}
