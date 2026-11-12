/**
 * Add or change one thing in a client's health profile (client_health_items):
 * an injury, condition, medication, supplement they take or allergy. The coach
 * (Health card) and the client (Account → Health & injuries) use the same
 * sheet; RLS decides what each may write (a client only their own rows, never
 * coach-only).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DateField } from "@/components/ui/date-field";
import { HEALTH_KINDS, type HealthItem, type HealthKind } from "@/lib/health/health-profile";
import { cn } from "@/lib/utils";

const AREAS = ["Lower back", "Upper back", "Neck", "Shoulder", "Elbow", "Wrist", "Hip", "Knee", "Ankle", "Hamstring", "Groin", "Chest"];

export type HealthSheetTarget = { item?: HealthItem | null; kind?: HealthKind } | null;

export function HealthItemSheet({
  clientId,
  mode,
  target,
  onClose,
  onSaved,
}: {
  clientId: string;
  mode: "coach" | "client";
  target: HealthSheetTarget;
  onClose: () => void;
  /** After a save or delete, with the row's id (null when it was deleted). */
  onSaved: (id: string | null) => void;
}) {
  const item = target?.item ?? null;
  const [kind, setKind] = useState<HealthKind>(item?.kind ?? target?.kind ?? "injury");
  const [label, setLabel] = useState(item?.label ?? "");
  const [area, setArea] = useState(item?.body_area ?? "");
  const [details, setDetails] = useState(item?.details ?? "");
  const [since, setSince] = useState(item?.since ?? "");
  const [coachOnly, setCoachOnly] = useState(!!item?.coach_only);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKind(item?.kind ?? target?.kind ?? "injury");
    setLabel(item?.label ?? "");
    setArea(item?.body_area ?? "");
    setDetails(item?.details ?? "");
    setSince(item?.since ?? "");
    setCoachOnly(!!item?.coach_only);
  }, [target, item]);

  const meta = HEALTH_KINDS.find((k) => k.kind === kind)!;
  const table = () => (supabase as any).from("client_health_items");

  const save = async () => {
    const name = label.trim();
    if (!name) {
      toast.error(`Name the ${meta.label.toLowerCase()} first`);
      return;
    }
    setSaving(true);
    const row = {
      kind,
      label: name.slice(0, 120),
      details: details.trim() || null,
      body_area: kind === "injury" ? area.trim() || null : null,
      since: since || null,
      coach_only: mode === "coach" ? coachOnly : false,
    };
    try {
      if (item) {
        const { error } = await table().update(row).eq("id", item.id);
        if (error) throw error;
        onSaved(item.id);
      } else {
        const { data, error } = await table()
          .insert({ ...row, client_id: clientId, source: mode })
          .select("id")
          .single();
        if (error) throw error;
        onSaved(data?.id ?? null);
      }
      toast.success(mode === "coach" ? "Saved. Their nutrition and training AI plan around it." : "Saved. Your coach can see it.");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save it");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    setSaving(true);
    try {
      const { error } = await table().delete().eq("id", item.id);
      if (error) throw error;
      toast.success("Removed");
      onSaved(null);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't remove it");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!target} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-[24px] pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:mx-auto sm:max-w-lg">
        <SheetHeader className="mb-3 text-left">
          <SheetTitle>{item ? `Edit ${meta.label.toLowerCase()}` : "Add to health"}</SheetTitle>
          <SheetDescription>
            {mode === "coach"
              ? "Their nutrition plan, supplements and programs are planned around it."
              : "Only you and your coach see this. It keeps your plan and training safe."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          {!item && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What is it">
              {HEALTH_KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.kind}
                  onClick={() => setKind(k.kind)}
                  className={cn(
                    "h-10 rounded-full border px-4 text-[14px] font-medium transition",
                    kind === k.kind ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">{meta.label}</span>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={meta.hint} maxLength={120} className="h-12 text-[16px]" autoFocus={!item} />
          </label>

          {kind === "injury" && (
            <div className="space-y-1.5">
              <span className="text-[13px] font-medium">Where</span>
              <div className="flex flex-wrap gap-1.5">
                {AREAS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setArea(area === a ? "" : a)}
                    className={cn(
                      "h-9 rounded-full border px-3 text-[13px] transition",
                      area === a ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted",
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Or type it (e.g. Left knee)" maxLength={60} className="h-11 text-[16px]" />
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Details {kind === "medication" || kind === "supplement" ? "(dose, how often)" : "(optional)"}</span>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              maxLength={1000}
              className="text-[16px]"
              placeholder={
                kind === "injury"
                  ? "What happened, what hurts, what the physio said"
                  : kind === "medication"
                    ? "e.g. 100 mcg every morning"
                    : kind === "supplement"
                      ? "e.g. 5 g a day"
                      : kind === "allergy"
                        ? "e.g. Anaphylaxis, carries an EpiPen"
                        : "Anything that matters for training or food"
              }
            />
          </label>

          <div className="space-y-1.5">
            <span className="text-[13px] font-medium">Since (optional)</span>
            <DateField value={since || null} onChange={setSince} placeholder="When it started" aria-label="Since" />
          </div>

          {mode === "coach" && (
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border px-3">
              <span>
                <span className="block text-[14px] font-medium">Only you see it</span>
                <span className="block text-[12px] text-muted-foreground">Hidden from their app. The AI still plans around it.</span>
              </span>
              <Switch checked={coachOnly} onCheckedChange={setCoachOnly} />
            </label>
          )}

          <div className="flex items-center gap-2 pt-1">
            {item && (
              <Button variant="ghost" className="h-11 text-destructive hover:text-destructive" onClick={remove} disabled={saving}>
                Delete
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button className="h-11" onClick={save} disabled={saving || !label.trim()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
