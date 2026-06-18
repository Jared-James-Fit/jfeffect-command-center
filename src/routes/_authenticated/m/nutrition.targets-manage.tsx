import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/app-shell";
import { ArrowLeft, Calculator, History, Pencil, Trash2, Save } from "lucide-react";
import {
  getActiveMemberTargets,
  getMemberTargetsHistory,
  saveManualTargets,
  clearActiveMemberTargets,
} from "@/lib/nutrition-targets/member-targets.functions";

export const Route = createFileRoute("/_authenticated/m/nutrition/targets-manage")({
  component: ManageTargets,
});

function sourceLabel(s: string | null | undefined) {
  if (s === "coach") return "Set by coach";
  if (s === "manual") return "Manual";
  return "Calculated";
}

function ManageTargets() {
  const navigate = useNavigate();
  const activeFn = useServerFn(getActiveMemberTargets);
  const historyFn = useServerFn(getMemberTargetsHistory);
  const saveManualFn = useServerFn(saveManualTargets);
  const clearFn = useServerFn(clearActiveMemberTargets);

  const activeQ = useQuery({ queryKey: ["nt-active"], queryFn: () => activeFn({}) });
  const histQ = useQuery({ queryKey: ["nt-history"], queryFn: () => historyFn({}) });

  const active = activeQ.data;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cal, setCal] = useState("");
  const [prot, setProt] = useState("");
  const [carb, setCarb] = useState("");
  const [fat, setFat] = useState("");
  const [water, setWater] = useState("");

  useEffect(() => {
    if (!active) return;
    setCal(String(active.calories ?? ""));
    setProt(String(active.protein_g ?? ""));
    setCarb(String(active.carbs_g ?? ""));
    setFat(String(active.fat_g ?? ""));
    setWater(active.water_ml ? (active.water_ml / 1000).toFixed(1) : "");
  }, [active]);

  async function handleSave() {
    const c = parseInt(cal, 10);
    if (!c || isNaN(c) || c <= 0) {
      toast.error("Enter a calorie target");
      return;
    }
    setSaving(true);
    try {
      await saveManualFn({
        data: {
          calories: c,
          protein_g: parseInt(prot, 10) || 0,
          carbs_g: parseInt(carb, 10) || 0,
          fat_g: parseInt(fat, 10) || 0,
          water_ml: water ? Math.round(parseFloat(water) * 1000) : undefined,
          goal: (active?.goal as any) ?? undefined,
        },
      });
      toast.success("Targets updated");
      setEditing(false);
      activeQ.refetch();
      histQ.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    try {
      await clearFn({});
      toast.success("Targets cleared");
      navigate({ to: "/m/nutrition" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not clear");
    }
  }

  if (!activeQ.isLoading && !active) {
    return (
      <>
        <PageHeader title="Manage Targets" subtitle="No active targets yet." />
        <div className="p-4 md:p-6 max-w-2xl mx-auto">
          <Card className="p-6 text-center space-y-4">
            <div className="text-sm text-muted-foreground">You haven't set up nutrition targets yet.</div>
            <Button asChild>
              <Link to="/m/nutrition/targets-setup">
                <Calculator className="mr-2 h-4 w-4" /> Calculate My Targets
              </Link>
            </Button>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Manage Targets" subtitle="Edit, recalculate, or clear your nutrition targets." />
      <div className="space-y-4 p-4 pb-28 md:p-6 md:pb-12 max-w-2xl mx-auto">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/m/nutrition">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to nutrition
          </Link>
        </Button>

        <Card className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Current targets</div>
              {active && (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="uppercase tracking-wide">
                    {sourceLabel(active.source)}
                  </Badge>
                  {active.goal && <span className="capitalize">{active.goal}</span>}
                </div>
              )}
            </div>
            {!editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
            )}
          </div>

          {!editing ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Stat label="Cal" value={active?.calories ?? "—"} />
              <Stat label="Protein" value={active?.protein_g != null ? `${active.protein_g}g` : "—"} />
              <Stat label="Carbs" value={active?.carbs_g != null ? `${active.carbs_g}g` : "—"} />
              <Stat label="Fat" value={active?.fat_g != null ? `${active.fat_g}g` : "—"} />
              <Stat label="Water" value={active?.water_ml ? `${(active.water_ml / 1000).toFixed(1)}L` : "—"} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Calories" value={cal} onChange={setCal} />
                <Field label="Water (L)" value={water} onChange={setWater} step="0.1" />
                <Field label="Protein (g)" value={prot} onChange={setProt} />
                <Field label="Carbs (g)" value={carb} onChange={setCarb} />
                <div className="col-span-2">
                  <Field label="Fat (g)" value={fat} onChange={setFat} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving} className="flex-1">
                  <Save className="mr-1.5 h-4 w-4" /> {saving ? "Saving…" : "Save changes"}
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Saving here marks your targets as Manual — they won't be auto-recalculated.
              </p>
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <div className="text-sm font-semibold">Actions</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline">
              <Link to="/m/nutrition/targets-setup">
                <Calculator className="mr-2 h-4 w-4" /> Recalculate
              </Link>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive hover:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Clear targets
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear your active targets?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your current targets will be deactivated. You can set new ones any time. History is kept.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClear}>Clear targets</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>

        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4" /> History
          </div>
          {histQ.isLoading ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : (histQ.data ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">No history yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {(histQ.data ?? []).map((row: any) => (
                <li key={row.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={row.active ? "default" : "outline"} className="uppercase text-[10px]">
                        {row.active ? "Active" : sourceLabel(row.source)}
                      </Badge>
                      {row.active && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {sourceLabel(row.source)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                      {row.goal ? ` · ${row.goal}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums">
                    <div className="font-semibold text-foreground">{row.calories} kcal</div>
                    <div className="text-muted-foreground">
                      P {row.protein_g} · C {row.carbs_g} · F {row.fat_g}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}