/**
 * Account → Team access: everyone on the team who can see (or asked to see)
 * this athlete's footage, training and performance, with Allow and Stop
 * sharing, and the notes they chose to share. Read with the athlete's own
 * login (my_team_access, my_shared_team_notes); answering is
 * specialist_access_respond, which only ever acts on their own training.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { billingDay } from "@/lib/date-range";

export type TeamAccessRow = {
  access_id: string;
  client_id: string;
  name: string;
  title: string;
  footage: boolean;
  training: boolean;
  performance: boolean;
  agreed: boolean;
  agreed_at: string | null;
  granted_at: string;
};

export type SharedTeamNote = {
  id: string;
  target_kind: "set_video" | "set" | "session";
  target_id: string;
  body: string;
  author_name: string;
  author_title: string | null;
  shared_at: string | null;
};

export function useMyTeamAccess(enabled: boolean) {
  return useQuery({
    queryKey: ["my-team-access"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<TeamAccessRow[]> => {
      const { data, error } = await (supabase as any).rpc("my_team_access");
      if (error) throw error;
      return (data ?? []) as TeamAccessRow[];
    },
  });
}

/** Notes a specialist shared with the signed-in athlete (optionally about one clip / set / session). */
export function useSharedTeamNotes(
  enabled: boolean,
  target?: { kind: SharedTeamNote["target_kind"]; id: string },
) {
  return useQuery({
    queryKey: ["my-shared-team-notes", target?.kind ?? null, target?.id ?? null],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<SharedTeamNote[]> => {
      const { data, error } = await (supabase as any).rpc("my_shared_team_notes", {
        _target_kind: target?.kind ?? null,
        _target_id: target?.id ?? null,
      });
      if (error) throw error;
      return (data ?? []) as SharedTeamNote[];
    },
  });
}

function what(r: TeamAccessRow): string {
  const on = [
    r.footage && "footage",
    r.training && "training",
    r.performance && "performance",
  ].filter(Boolean) as string[];
  if (on.length <= 1) return on[0] ?? "nothing";
  return `${on.slice(0, -1).join(", ")} and ${on[on.length - 1]}`;
}

export function TeamAccessList({ rows }: { rows: TeamAccessRow[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const notes = useSharedTeamNotes(true);
  async function answer(r: TeamAccessRow, allow: boolean) {
    setBusy(r.access_id);
    try {
      const { data, error } = await (supabase as any).rpc("specialist_access_respond", {
        _access_id: r.access_id,
        _allow: allow,
      });
      if (error || !["allowed", "stopped"].includes(data))
        throw new Error("Couldn't save that. Try again.");
      toast.success(
        allow ? `${r.name} can see your ${what(r)}` : `${r.name} can no longer see your training`,
      );
      await qc.invalidateQueries({ queryKey: ["my-team-access"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.access_id} className="rounded-xl border border-border p-3 text-sm">
            <div className="font-semibold">
              {r.name} <span className="font-normal text-muted-foreground">· {r.title}</span>
            </div>
            <p className="mt-0.5 text-muted-foreground">
              {r.agreed
                ? `Can see your ${what(r)}. View-only: they can't change anything.`
                : `Would like to see your ${what(r)}. View-only: they can't change anything.`}
            </p>
            <div className="mt-2 flex gap-2">
              {!r.agreed && (
                <Button
                  size="sm"
                  onClick={() => void answer(r, true)}
                  loading={busy === r.access_id}
                  disabled={!!busy}
                >
                  Allow
                </Button>
              )}
              <Button
                size="sm"
                variant={r.agreed ? "outline" : "ghost"}
                onClick={() => void answer(r, false)}
                disabled={!!busy}
              >
                {r.agreed ? "Stop sharing" : "Don't allow"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {(notes.data ?? []).length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Notes they shared with you
          </div>
          {(notes.data ?? []).slice(0, 10).map((n) => (
            <div key={n.id} className="rounded-xl bg-muted/50 p-3 text-sm">
              <div className="text-xs text-muted-foreground">
                {n.author_name}
                {n.shared_at ? ` · ${billingDay(n.shared_at.slice(0, 10))}` : ""}
                {n.target_kind === "set_video"
                  ? " · on a set video"
                  : n.target_kind === "session"
                    ? " · on a workout"
                    : " · on a set"}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap">{n.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One clip's shared notes, under the clip in the athlete's own set video sheet. */
export function SharedNotesForVideo({ videoId }: { videoId: string }) {
  const notes = useSharedTeamNotes(true, { kind: "set_video", id: videoId });
  if (!(notes.data ?? []).length) return null;
  return (
    <div className="space-y-2">
      {(notes.data ?? []).map((n) => (
        <div key={n.id} className="rounded-xl bg-muted/50 p-3 text-sm">
          <div className="text-xs text-muted-foreground">
            {n.author_name}
            {n.author_title ? ` · ${n.author_title}` : ""}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap">{n.body}</p>
        </div>
      ))}
    </div>
  );
}
