import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { logBodyweight } from "@/lib/progress";
import { combinedBodyweightQueryKey, getCombinedBodyweightSeries } from "@/lib/bodyweight";
import { todayLocalISO } from "@/lib/today";

// Session-scoped: cleared when the installed app / tab is relaunched, so the
// prompt returns every new session until a bodyweight exists.
const SESSION_KEY = (uid: string) => `jf:bw-prompt-shown:${uid}`;
// Module-level guard against duplicate instances across remounts.
let activeFor: string | null = null;

function uiIsClear() {
  return !document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-vaul-drawer][data-state="open"]',
  );
}

export function MissingBodyweightPrompt({ userId, defaultUnit = "lb" }: { userId: string; defaultUnit?: "kg" | "lb" }) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [unit, setUnit] = useState<"kg" | "lb">(defaultUnit);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const { data: rows, isSuccess } = useQuery({
    queryKey: combinedBodyweightQueryKey(userId),
    enabled: !!userId,
    queryFn: () => getCombinedBodyweightSeries(userId, 200),
    staleTime: 30_000,
  });
  const hasBodyweight = (rows ?? []).some((r) => Number.isFinite(r.value) && r.value > 0);
  const eligible = role === "client" && isSuccess && !hasBodyweight;

  useEffect(() => {
    if (!eligible || open) return;
    try { if (sessionStorage.getItem(SESSION_KEY(userId))) return; } catch { /* ignore */ }
    if (activeFor === userId) return;
    // Wait for the app to settle and any other popup to close first.
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (uiIsClear() && activeFor !== userId) {
        activeFor = userId;
        try { sessionStorage.setItem(SESSION_KEY(userId), "1"); } catch { /* ignore */ }
        setOpen(true);
        return;
      }
      timer = window.setTimeout(tick, 1200);
    };
    let timer = window.setTimeout(tick, 2500);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [eligible, open, userId]);

  // Close immediately if history appears (e.g. logged elsewhere).
  useEffect(() => { if (open && hasBodyweight) setOpen(false); }, [open, hasBodyweight]);
  useEffect(() => () => { if (activeFor === userId) activeFor = null; }, [userId]);

  async function save() {
    if (savingRef.current) return;
    const w = Number(val);
    if (!val || !Number.isFinite(w) || w <= 0) { toast.error("Enter a valid bodyweight"); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      await logBodyweight({ user_id: userId, weight_value: w, weight_unit: unit, logged_date: todayLocalISO(), note: null });
      toast.success("Bodyweight logged — you're in the Performance League");
      setOpen(false);
      window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: combinedBodyweightQueryKey(userId) });
        qc.invalidateQueries({ queryKey: ["athlete-rankings-monthly"] });
        qc.invalidateQueries({ queryKey: ["progress-bodyweight"] });
      }, 280);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save weight");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!eligible && !open) return null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!saving) setOpen(o); }}>
      <SheetContent side="bottom" className="rounded-t-2xl px-5 pt-6" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto w-full max-w-md">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Scale className="h-6 w-6" />
          </div>
          <SheetTitle className="text-lg font-black">Add your bodyweight</SheetTitle>
          <SheetDescription className="mt-1 text-sm">
            One quick entry qualifies you for the Performance League and makes your strength and progress tracking more accurate.
          </SheetDescription>
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Label htmlFor="bw-first" className="text-xs">Current bodyweight</Label>
            <div className="flex gap-2">
              <Input id="bw-first" inputMode="decimal" type="number" step="0.1" min="0" value={val}
                onChange={(e) => setVal(e.target.value)} placeholder={unit === "lb" ? "e.g. 180" : "e.g. 82"} className="h-12 text-base" />
              <div className="flex rounded-md border p-1">
                {(["lb", "kg"] as const).map((u) => (
                  <button key={u} type="button" onClick={() => setUnit(u)}
                    className={`rounded px-3 text-sm font-semibold ${unit === u ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{u}</button>
                ))}
              </div>
            </div>
            <Button type="submit" className="h-12 w-full" disabled={saving}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save bodyweight"}
            </Button>
            <Button type="button" variant="ghost" className="h-11 w-full" disabled={saving} onClick={() => setOpen(false)}>Not now</Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
