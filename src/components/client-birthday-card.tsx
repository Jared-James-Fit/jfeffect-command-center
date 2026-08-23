import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BirthdayCardView } from "@/components/birthday-card-view";
import { resolveBirthdayCard } from "@/lib/birthday-templates";

/** How many days after the birthday an unseen card still shows. */
const BIRTHDAY_GRACE_DAYS = 7;

/**
 * Resolve the birthday "window" for a client. The card shows on the actual
 * birthday and — if the client never opened the app that day — for a short
 * grace period afterwards, so a missed card is never lost.
 * Returns the birthday year to record the view against, or null.
 */
export function resolveBirthdayWindow(
  dob: string | null | undefined,
  ref = new Date(),
): { year: number; daysSince: number } | null {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  // Check this year's and last year's occurrence (handles Dec→Jan rollover).
  for (const year of [today.getFullYear(), today.getFullYear() - 1]) {
    const occurrence = new Date(year, d.getMonth(), d.getDate());
    const daysSince = Math.round((today.getTime() - occurrence.getTime()) / 86_400_000);
    if (daysSince >= 0 && daysSince <= BIRTHDAY_GRACE_DAYS) return { year, daysSince };
  }
  return null;
}

/**
 * Shown once per birthday year inside the client portal, on the client's
 * actual birthday. Mount once near the portal root.
 */
export function ClientBirthdayCard() {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { data: client } = useQuery({
    queryKey: ["my-birthday-client", user?.id],
    enabled: !!user && !isImpersonating,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, first_name, preferred_name, full_name, date_of_birth, profile_picture_url")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const birthdayToday = useMemo(
    () => isBirthdayToday(client?.date_of_birth),
    [client?.date_of_birth],
  );
  const year = new Date().getFullYear();

  const { data: card } = useQuery({
    queryKey: ["my-birthday-card", client?.id],
    enabled: !!client?.id && birthdayToday,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_birthday_cards" as any)
        .select("*")
        .eq("client_id", client!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as any) ?? null;
    },
  });

  const { data: view } = useQuery({
    queryKey: ["my-birthday-view", client?.id, year],
    enabled: !!client?.id && birthdayToday,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_birthday_card_views" as any)
        .select("*")
        .eq("client_id", client!.id)
        .eq("birthday_year", year)
        .maybeSingle();
      if (error) throw error;
      return (data as any) ?? null;
    },
  });

  const resolved = useMemo(() => resolveBirthdayCard(card ?? null), [card]);

  // Open once when conditions are met.
  useEffect(() => {
    if (!birthdayToday || !client?.id) return;
    if (!resolved.enabled) return;
    if (view?.dismissed_at) return;
    if (dismissed) return;
    setOpen(true);
  }, [birthdayToday, client?.id, resolved.enabled, view?.dismissed_at, dismissed]);

  // Record that the client has seen the card as soon as the dialog opens —
  // this is the "read confirmation" surfaced to the admin. Fires once per year.
  const markSeen = useMutation({
    mutationFn: async () => {
      if (!client?.id) return;
      const { error } = await supabase
        .from("client_birthday_card_views" as any)
        .upsert(
          { client_id: client.id, birthday_year: year, seen_at: new Date().toISOString() },
          { onConflict: "client_id,birthday_year", ignoreDuplicates: false },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-birthday-view", client?.id, year] });
      qc.invalidateQueries({ queryKey: ["birthday-card-views", year - 1, year] });
    },
  });
  useEffect(() => {
    if (!open) return;
    if (view?.seen_at) return;
    if (markSeen.isPending) return;
    markSeen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view?.seen_at]);

  const markDismissed = useMutation({
    mutationFn: async () => {
      if (!client?.id) return;
      const { error } = await supabase
        .from("client_birthday_card_views" as any)
        .upsert(
          {
            client_id: client.id,
            birthday_year: year,
            seen_at: new Date().toISOString(),
            dismissed_at: new Date().toISOString(),
          },
          { onConflict: "client_id,birthday_year" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-birthday-view", client?.id, year] });
      qc.invalidateQueries({ queryKey: ["birthday-card-views", year - 1, year] });
    },
  });

  if (!birthdayToday || !client?.id) return null;

  const firstName = client.first_name || client.preferred_name || client.full_name?.split(" ")[0];

  const handleDismiss = () => {
    setDismissed(true);
    setOpen(false);
    markDismissed.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleDismiss();
        else setOpen(true);
      }}
    >
      <DialogContent className="z-[70] max-w-md border-0 bg-transparent p-0 shadow-none">
        <BirthdayCardView
          card={resolved}
          firstName={firstName}
          fullName={client.full_name}
          avatarSrc={client.profile_picture_url}
          onDismiss={handleDismiss}
          onMessageCoach={
            resolved.show_message_coach_button
              ? () => {
                  setOpen(false);
                  navigate({ to: "/portal/messages" });
                }
              : undefined
          }
          onViewPlan={() => {
            setOpen(false);
            navigate({ to: "/portal" });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}