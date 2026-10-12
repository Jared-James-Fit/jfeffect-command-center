import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dumbbell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { bodyweightUnitKey } from "@/lib/use-bodyweight-unit";
import { saveWeightUnitChoice, weightUnitSetupKey } from "@/lib/weight-unit-pref";
import type { WeightUnit } from "@/lib/weight-lifted";

// Asked once per app open until answered; lb is used in the meantime.
const SESSION_KEY = (uid: string) => `jf:weight-unit-prompt-shown:${uid}`;

function uiIsClear() {
  return !document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-vaul-drawer][data-state="open"]',
  );
}

const CHOICES: { unit: WeightUnit; label: string; hint: string }[] = [
  { unit: "lb", label: "Pounds", hint: "lb" },
  { unit: "kg", label: "Kilograms", hint: "kg" },
];

/**
 * "Pounds or kilograms?" for a client who has never chosen a weight unit
 * (clients.weight_unit_confirmed_at is null). One tap saves it as their
 * default everywhere; "Later" keeps lb and the question returns next app open.
 */
export function WeightUnitPrompt() {
  const { user, role } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const qc = useQueryClient();
  const userId = user?.id ?? null;
  const enabled = !!userId && role === "client" && !isImpersonating;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<WeightUnit | null>(null);

  const { data: row, isSuccess } = useQuery({
    queryKey: weightUnitSetupKey(userId),
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, preferred_weight_unit, weight_unit_confirmed_at")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const needsAnswer = enabled && isSuccess && !!row && !row.weight_unit_confirmed_at;

  useEffect(() => {
    if (!needsAnswer || open || !userId) return;
    try { if (sessionStorage.getItem(SESSION_KEY(userId))) return; } catch { /* storage unavailable */ }
    // Let the app settle and wait for any other popup to close first.
    let stopped = false;
    let timer = 0;
    const tick = () => {
      if (stopped) return;
      if (uiIsClear()) {
        try { sessionStorage.setItem(SESSION_KEY(userId), "1"); } catch { /* storage unavailable */ }
        setOpen(true);
        return;
      }
      timer = window.setTimeout(tick, 1200);
    };
    timer = window.setTimeout(tick, 1500);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [needsAnswer, open, userId]);

  // Answered somewhere else (e.g. Account Settings) while open.
  useEffect(() => { if (open && !needsAnswer && !saving) setOpen(false); }, [open, needsAnswer, saving]);

  if (!needsAnswer && !open) return null;

  const choose = async (unit: WeightUnit) => {
    if (!row || !userId || saving) return;
    setSaving(unit);
    try {
      await saveWeightUnitChoice({ clientId: row.id }, unit);
      // Bodyweight follows the same unit unless they've already picked one for it.
      await supabase
        .from("bodyweight_unit_prefs")
        .upsert({ user_id: userId, unit, updated_at: new Date().toISOString() }, { onConflict: "user_id", ignoreDuplicates: true });
      setOpen(false);
      toast.success(unit === "kg" ? "Weights will show in kg" : "Weights will show in lb");
      if (unit !== row.preferred_weight_unit) {
        // Workouts, maxes, analytics and the Crew all read the unit.
        qc.invalidateQueries();
      } else {
        qc.invalidateQueries({ queryKey: weightUnitSetupKey(userId) });
        qc.invalidateQueries({ queryKey: bodyweightUnitKey(userId) });
        qc.invalidateQueries({ queryKey: ["my-client-account"] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your unit. Try again.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!saving) setOpen(o); }}>
      <SheetContent side="bottom" hideCloseButton className="rounded-t-2xl px-5 pt-6" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto w-full max-w-md">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Dumbbell className="h-6 w-6" />
          </div>
          <SheetTitle className="text-lg font-black">Pounds or kilograms?</SheetTitle>
          <SheetDescription className="mt-1 text-sm">
            Pick the unit you lift in. Your workouts, maxes, PRs, bodyweight and the Crew all use it. You can change it any time in Account Settings.
          </SheetDescription>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {CHOICES.map((c) => (
              <button
                key={c.unit}
                type="button"
                disabled={!!saving}
                onClick={() => void choose(c.unit)}
                className="flex h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-border bg-card text-center transition hover:border-primary focus-visible:border-primary focus-visible:outline-none disabled:opacity-60"
              >
                {saving === c.unit ? (
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                ) : (
                  <span className="text-2xl font-black">{c.hint}</span>
                )}
                <span className="text-xs font-semibold text-muted-foreground">{c.label}</span>
              </button>
            ))}
          </div>
          <Button type="button" variant="ghost" className="mt-3 h-11 w-full text-muted-foreground" disabled={!!saving} onClick={() => setOpen(false)}>
            Ask me later (using lb for now)
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
