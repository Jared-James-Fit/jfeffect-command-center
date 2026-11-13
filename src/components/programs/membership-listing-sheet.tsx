import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Smartphone } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getLinkedLibraryPlan, upsertLibraryListing, publishLibraryListing, unpublishLibraryListing,
} from "@/lib/membership-library.functions";
import { isLiveListing } from "@/lib/programs/library-view";

/**
 * A program in the membership app, or not: one sheet, from the library row's
 * ⋯ and the builder's ⋯. Members see the title, description and level; the
 * workouts are the program itself (its listing pins the version it was saved
 * with, so later edits reach members when the coach taps Update).
 */
export type MembershipTemplate = {
  id: string;
  name: string;
  description?: string | null;
  training_style?: string | null;
  training_focus?: string | null;
  goal?: string | null;
  est_duration_min?: number | null;
  payload_revision?: number | null;
};

const LEVELS = ["Beginner", "Intermediate", "Advanced", "All Levels"] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_LABEL: Record<Level, string> = {
  Beginner: "Beginner", Intermediate: "Intermediate", Advanced: "Advanced", "All Levels": "All levels",
};

export const MEMBERSHIP_QUERY_KEYS = [["library-linked"], ["admin-library-membership"], ["pl-templates"]] as const;

export function MembershipListingSheet({
  template, open, onOpenChange,
}: { template: MembershipTemplate | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const fetchLinked = useServerFn(getLinkedLibraryPlan);
  const upsert = useServerFn(upsertLibraryListing);
  const publish = useServerFn(publishLibraryListing);
  const unpublish = useServerFn(unpublishLibraryListing);
  const tid = template?.id ?? null;

  const { data: linked, isLoading } = useQuery({
    queryKey: ["library-linked", tid],
    queryFn: () => fetchLinked({ data: { templateId: tid! } }),
    enabled: open && !!tid,
    staleTime: 0,
  });
  const plan = (linked as any)?.plan ?? null;
  const revision = (linked as any)?.template_revision ?? template?.payload_revision ?? null;
  const live = !!plan && isLiveListing(plan);
  const behind = live && revision != null && plan.last_published_version != null && revision > plan.last_published_version;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<Level>("All Levels");
  const [minutes, setMinutes] = useState("");
  const [featured, setFeatured] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "remove">(null);

  // fill the form once per open, from the listing when there is one, else the program
  useEffect(() => {
    if (!open || !template || isLoading) return;
    setTitle(plan?.public_title || plan?.name || template.name || "");
    setDescription(plan?.description ?? template.description ?? "");
    setLevel((LEVELS as readonly string[]).includes(plan?.difficulty) ? plan.difficulty : "All Levels");
    const mins = plan?.est_minutes_per_workout ?? template.est_duration_min ?? null;
    setMinutes(mins ? String(mins) : "");
    setFeatured(!!plan?.featured);
  }, [open, template?.id, isLoading, plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!template) return null;

  const refresh = () => {
    for (const key of MEMBERSHIP_QUERY_KEYS) qc.invalidateQueries({ queryKey: [...key] });
  };

  const metadata = () => {
    const mins = Number.parseInt(minutes, 10);
    return {
      name: title.trim() || template.name,
      public_title: title.trim() || template.name,
      description: description.trim() || null,
      cover_image_url: plan?.cover_image_url ?? null,
      difficulty: level,
      goal: plan?.goal ?? template.goal ?? template.training_focus ?? null,
      training_style: plan?.training_style ?? template.training_style ?? "custom",
      tags: plan?.tags ?? [],
      equipment_needed: plan?.equipment_needed ?? [],
      est_minutes_per_workout: Number.isFinite(mins) && mins > 0 ? mins : null,
      // every member with access sees it (free members included)
      required_access_level: plan?.required_access_level ?? "app_membership",
      audience_mode: "all_active" as const,
      eligible_plan_ids: [] as string[],
      allow_full_program: true,
      allow_partial_imports: false,
      allow_pdf_download: plan?.allow_pdf_download ?? true,
      notify_on_publish: false,
      change_notes: null,
      featured,
    };
  };

  // Add, Save and Update all publish the program as it is now with these words.
  const save = async () => {
    if (!title.trim()) { toast.error("Give it a title members will see"); return; }
    setBusy("save");
    try {
      const { planId } = await upsert({ data: { templateId: template.id, planId: plan?.id ?? null, metadata: metadata() } });
      await publish({ data: { planId, isUpdate: live } });
      toast.success(live ? "Members see the latest version" : "Added to the membership app");
      refresh();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save it");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!plan?.id) return;
    setBusy("remove");
    try {
      await unpublish({ data: { planId: plan.id, reason: null } });
      toast.success("Taken out of the membership app");
      refresh();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't take it out");
    } finally {
      setBusy(null);
    }
  };

  const started = Number(plan?.imports_count ?? 0);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg" data-membership-sheet>
        <SheetHeader className="border-b border-border px-4 py-3 pl-24">
          <SheetTitle className="text-base font-semibold">Membership app</SheetTitle>
          <SheetDescription className="line-clamp-1 text-[13px]">{template.name}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 p-4">
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3 text-[14px]",
              behind ? "border-warning/40 bg-warning/10" : "border-border bg-muted/40",
            )}
            data-membership-state={live ? (behind ? "behind" : "live") : "off"}
          >
            <Smartphone className={cn("mt-0.5 h-4 w-4 shrink-0", behind ? "text-warning" : "text-muted-foreground")} />
            <div className="min-w-0">
              {isLoading ? (
                <span className="text-muted-foreground">Checking…</span>
              ) : !live ? (
                <>
                  <div className="font-medium">Not in the membership app</div>
                  <div className="text-muted-foreground">Add it and every member can start it from their JF Effect library.</div>
                </>
              ) : behind ? (
                <>
                  <div className="font-medium">Members see an older version</div>
                  <div className="text-muted-foreground">You've changed the program since it was added. Tap Update so members get this one.</div>
                </>
              ) : (
                <>
                  <div className="font-medium">Members can start it</div>
                  <div className="text-muted-foreground">
                    {started > 0 ? `${started} member${started === 1 ? " has" : "s have"} started it. ` : ""}
                    Members who started it keep their copy and history.
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ml-title">Title members see</Label>
            <Input id="ml-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={template.name} className="h-11 text-base" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ml-desc">What it is and who it's for</Label>
            <Textarea
              id="ml-desc"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. 12 weeks of upper / lower for people who train 4 days a week at a full gym."
              className="text-base"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Level</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  aria-pressed={level === l}
                  className={cn(
                    "h-10 rounded-lg text-sm font-medium transition",
                    level === l ? "bg-foreground text-background" : "bg-secondary text-foreground hover:bg-secondary/80",
                  )}
                >
                  {LEVEL_LABEL[l]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ml-min">Minutes a workout</Label>
            <Input
              id="ml-min"
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              placeholder="60"
              className="h-11 w-28 text-base"
            />
          </div>

          <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <span className="text-sm">
              <span className="font-medium">Show it first</span>
              <span className="block text-[13px] text-muted-foreground">Pinned to the top of members' library</span>
            </span>
            <Switch checked={featured} onCheckedChange={setFeatured} />
          </label>
        </div>

        <div className="sticky bottom-0 space-y-2 border-t border-border bg-background p-4 pb-[max(env(safe-area-inset-bottom),1rem)] dark:bg-card">
          <Button className="h-11 w-full" onClick={save} disabled={!!busy || isLoading} data-membership-save>
            {busy === "save" ? "Saving…" : !live ? "Add to membership app" : behind ? "Update for members" : "Save"}
          </Button>
          {live && (
            <Button
              variant="ghost"
              className="h-11 w-full text-destructive hover:text-destructive"
              onClick={remove}
              disabled={!!busy}
              data-membership-remove
            >
              {busy === "remove" ? "Taking it out…" : "Take it out of the membership app"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
