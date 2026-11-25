/**
 * Reads and writes for the filming reminders (filming-reminder.ts is the pure
 * rule). One small read on logger open; nothing here calls a model.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { FilmingStatus, ReminderState } from "@/lib/set-videos/filming-reminder";

const db = supabase as any;
export const filmingStatusKey = (clientId: string | null | undefined) => ["filming-status", clientId ?? null] as const;

/** A client's footage numbers and reminder state (the client, their coach or an admin). A failed read is null: nothing shows. */
export function useFilmingStatus(clientId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: filmingStatusKey(clientId),
    enabled: enabled && !!clientId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<FilmingStatus | null> => {
      const { data, error } = await db.rpc("filming_status", { _client: clientId });
      if (error) return null;
      return (data ?? null) as FilmingStatus | null;
    },
  });
}

/** The reminder appeared at this workout: the server records it only if its rule still allows (false: don't show). */
export async function recordReminderShown(clientId: string, dayId: string): Promise<boolean> {
  const { data, error } = await db.rpc("filming_reminder_shown", { _client: clientId, _day: dayId });
  if (error) return false;
  return data === true;
}

export async function answerReminder(clientId: string, answer: "accept" | "dismiss"): Promise<void> {
  await db.rpc("filming_reminder_answer", { _client: clientId, _answer: answer }).then(() => {}, () => {});
}

export type CoachPatch = Partial<Pick<ReminderState, "enabled" | "sensitivity" | "expectation" | "paused_until">> & {
  request?: boolean;
  resume?: boolean;
};

/** The coach's per-client controls. */
export function useFilmingCoachControls(clientId: string) {
  const qc = useQueryClient();
  return useCallback(
    async (patch: CoachPatch) => {
      const { error } = await db.rpc("filming_reminder_coach", { _client: clientId, _patch: patch });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: filmingStatusKey(clientId) });
    },
    [clientId, qc],
  );
}
