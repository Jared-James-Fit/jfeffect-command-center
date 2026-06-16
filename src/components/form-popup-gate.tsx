import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ClipboardList, ExternalLink } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { buildFilloutUrl } from "@/lib/fillout";

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function inTimeWindow(start: string | null, end: string | null): boolean {
  const now = nowHHMM();
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function inDateRange(startDate: string | null, endDate: string | null): boolean {
  const today = todayISO();
  if (startDate && today < startDate) return false;
  if (endDate && today > endDate) return false;
  return true;
}

type PopupForm = {
  id: string;
  title: string;
  description: string | null;
  kind: "native" | "external";
  external_url: string | null;
  popup_enabled: boolean;
  popup_weekdays: number[] | null;
  popup_start_time: string | null;
  popup_end_time: string | null;
  popup_start_date: string | null;
  popup_end_date: string | null;
};

/**
 * Shows a per-user popup for any nf_forms with popup_enabled=true whose
 * weekday / time window / date range matches "now". Once dismissed for
 * today, it stays hidden until the next scheduled occurrence (a new row
 * in nf_form_popup_dismissals per (user, form, date)).
 */
export function FormPopupGate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? null;

  // Never interrupt a workout / message / check-in session — the popup is
  // a soft nudge only. Show it on Home and other browsing routes.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const suppressed =
    pathname.startsWith("/portal/workouts") ||
    pathname.startsWith("/portal/messages") ||
    pathname.startsWith("/portal/check-ins") ||
    pathname.startsWith("/portal/lift-videos");

  const { data: client } = useQuery({
    queryKey: ["form-popup-client", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, first_name, last_name, email")
        .eq("user_id", userId!)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const { data: forms = [] } = useQuery({
    queryKey: ["form-popup-forms", userId],
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nf_forms")
        .select(
          "id, title, description, kind, external_url, popup_enabled, popup_weekdays, popup_start_time, popup_end_time, popup_start_date, popup_end_date",
        )
        .eq("popup_enabled", true)
        .eq("active", true)
        .eq("archived", false);
      if (error) throw error;
      return (data ?? []) as PopupForm[];
    },
  });

  const today = todayISO();

  const { data: dismissedIds = new Set<string>() } = useQuery({
    queryKey: ["form-popup-dismissals", userId, today],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nf_form_popup_dismissals" as any)
        .select("form_id")
        .eq("user_id", userId!)
        .eq("occurrence_date", today);
      if (error) throw error;
      return new Set<string>(((data ?? []) as any[]).map((r) => r.form_id as string));
    },
  });

  const eligible = useMemo(() => {
    const dow = new Date().getDay(); // 0 = Sunday
    return (forms as PopupForm[]).filter((f) => {
      if (!f.popup_enabled) return false;
      if (dismissedIds.has(f.id)) return false;
      const days = f.popup_weekdays ?? [];
      if (days.length > 0 && !days.includes(dow)) return false;
      if (!inDateRange(f.popup_start_date, f.popup_end_date)) return false;
      if (!inTimeWindow(f.popup_start_time, f.popup_end_time)) return false;
      return true;
    });
  }, [forms, dismissedIds]);

  const current = eligible[0] ?? null;
  const [closing, setClosing] = useState(false);

  async function dismiss() {
    if (!current || !userId) return;
    setClosing(true);
    try {
      await supabase
        .from("nf_form_popup_dismissals" as any)
        .upsert(
          { user_id: userId, form_id: current.id, occurrence_date: today },
          { onConflict: "user_id,form_id,occurrence_date" },
        );
      await qc.invalidateQueries({ queryKey: ["form-popup-dismissals", userId, today] });
    } finally {
      setClosing(false);
    }
  }

  if (!current) return null;
  if (suppressed) return null;

  const portalHref = `/portal/check-ins/${current.id}`;
  const externalHref =
    current.kind === "external" && current.external_url
      ? buildFilloutUrl(current.external_url, client as any)
      : null;

  return (
    <Dialog open={!!current} onOpenChange={(o) => { if (!o) void dismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base">{current.title}</DialogTitle>
              <DialogDescription className="text-xs">
                Quick form from your coach
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {current.description && (
          <div className="rounded-2xl bg-muted/40 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {current.description}
          </div>
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => void dismiss()} disabled={closing}>
            Not now
          </Button>
          {externalHref ? (
            <Button asChild size="sm" className="font-semibold" onClick={() => void dismiss()}>
              <a href={externalHref} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" /> Open form
              </a>
            </Button>
          ) : (
            <Button asChild size="sm" className="font-semibold" onClick={() => void dismiss()}>
              <Link to={portalHref}>Open form</Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}