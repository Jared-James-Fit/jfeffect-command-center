import { Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, ClipboardCheck, Camera, Scale, Dumbbell, Ruler, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { listActionCentre, type ActionCentreItem } from "@/lib/action-centre.functions";
import { ActionTaskSheet } from "./action-task-sheet";
import { supabase } from "@/integrations/supabase/client";
import { ClientFormSheet } from "@/components/forms/client-form-sheet";
import { isExternalForm, useExternalFormOpener } from "@/lib/external-form-open";
import { CoachFeedbackCard } from "@/components/forms/coach-feedback-card";
import { listFormsForClient, pickWeeklyCheckInForm, pickNutritionUpdateForm } from "@/lib/native-forms";

export type ActionTone = "warning" | "primary" | "success";

export type ActionItem = {
  key: string;
  icon: any;
  tone: ActionTone;
  title: string;
  message?: string;
  chip?: string;
  onClick?: () => void;
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  href?: string;
  /** Present when this row is backed by a scheduled task occurrence. */
  occurrence?: ActionCentreItem;
};

const toneOrder: Record<ActionTone, number> = { warning: 0, primary: 1, success: 2 };

const SEEN_KEY = "jf:action-centre:seen-keys:v1";
const EXPAND_KEY = "jf:action-centre:expanded:v1";
const COMPACT_LIMIT = 3;

function readSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeSeen(keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(keys)));
  } catch {
    /* ignore */
  }
}

const TASK_ICONS: Record<string, any> = {
  weekly_checkin: ClipboardCheck,
  nutrition_review: FileText,
  progress_photos: Camera,
  monthly_assessment: Ruler,
  bodyweight: Scale,
  technique_review: Dumbbell,
  custom_form: FileText,
};

function toneFromChip(t: ActionCentreItem["chip"]["tone"]): ActionTone {
  if (t === "danger" || t === "warning") return "warning";
  if (t === "success") return "success";
  return "primary";
}

/**
 * Compact chip label — replaces the noisier server label with a short
 * scannable status ("Today", "Tomorrow", "3 Days", "1 Week", "Overdue").
 */
function compactChip(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("overdue")) return "Overdue";
  if (l === "due today") return "Today";
  if (l === "due tomorrow") return "Tomorrow";
  const m = l.match(/due in (\d+) days?/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 7) {
      const weeks = Math.round(n / 7);
      return weeks === 1 ? "1 Week" : `${weeks} Weeks`;
    }
    return `${n} Days`;
  }
  return label;
}

/** Direct destination for an occurrence — skip the intermediate sheet. */
function occurrenceTarget(occ: ActionCentreItem): { to: string; params?: Record<string, string>; search?: Record<string, unknown> } | null {
  const meta = (occ.metadata ?? {}) as Record<string, any>;
  switch (occ.task_type) {
    case "weekly_checkin":
    case "nutrition_review":
    case "custom_form": {
      const formId = meta.form_id as string | undefined;
      return formId
        ? { to: "/portal/check-ins/$formId", params: { formId } }
        : { to: "/portal/check-ins" };
    }
    case "progress_photos":
      return { to: "/portal/progress", search: { action: "photos" } };
    case "monthly_assessment":
      // Legacy alias still redirects to /portal/progress?action=bodyweight
      return { to: "/portal/progress-metrics" };
    case "bodyweight":
      // Stay on home; the bodyweight card opens its log sheet via event.
      return null;
    case "technique_review":
      return { to: "/portal/lift-videos" as any };
    default:
      return null;
  }
}

/** Canonical client-facing labels — used everywhere, no synonyms. */
const TASK_LABELS: Record<string, string> = {
  weekly_checkin: "Weekly Check-In",
  nutrition_review: "Nutrition Review",
};

const FORM_TASK_TYPES = new Set(["weekly_checkin", "nutrition_review", "custom_form"]);

function occurrenceToItem(
  occ: ActionCentreItem,
  onFallback: (occ: ActionCentreItem) => void,
  onOpenForm?: (occ: ActionCentreItem) => void,
): ActionItem {
  const isForm = FORM_TASK_TYPES.has(occ.task_type);
  // Forms intentionally show no status chip (no "Overdue"/"Today" labels).
  const chip = isForm ? undefined : compactChip(occ.chip.label);
  const target = occurrenceTarget(occ);
  const base: ActionItem = {
    key: `occ-${occ.id}`,
    icon: TASK_ICONS[occ.task_type] ?? ClipboardCheck,
    tone: isForm ? "primary" : toneFromChip(occ.chip.tone),
    title: TASK_LABELS[occ.task_type] ?? occ.title,
    message: occ.subtitle ?? undefined,
    chip,
    occurrence: occ,
  };
  // Forms open directly in an on-screen sheet — never route the client to a
  // generic "Check-ins & Forms" list where they'd pick the form again.
  if (isForm && onOpenForm) {
    base.onClick = () => onOpenForm(occ);
    return base;
  }
  if (occ.task_type === "bodyweight") {
    base.onClick = () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("portal:log-bodyweight"));
        // Ensure the card is in view.
        const el = document.getElementById("bodyweight-card");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    return base;
  }
  if (target) {
    base.to = target.to;
    base.params = target.params;
    base.search = target.search;
    return base;
  }
  // Unknown task type — fall back to the confirmation sheet so the client
  // always has a path forward.
  base.onClick = () => onFallback(occ);
  return base;
}

function readExpanded(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(EXPAND_KEY) === "1"; } catch { return false; }
}
function writeExpanded(v: boolean) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(EXPAND_KEY, v ? "1" : "0"); } catch { /* noop */ }
}

export function ActionCentre({ items, clientId }: { items: ActionItem[]; clientId?: string | null }) {
  const [activeOcc, setActiveOcc] = useState<ActionCentreItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [locallyCompleted, setLocallyCompleted] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<boolean>(() => readExpanded());
  const [justCompleted, setJustCompleted] = useState<string | null>(null);
  const navigate = useNavigate();

  const list = useServerFn(listActionCentre);
  const { data: occurrences = [] } = useQuery({
    queryKey: ["action-centre", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => list({ data: { clientId: clientId! } }),
  });

  const [formSheet, setFormSheet] = useState<{ id: string; title: string } | null>(null);
  const { openExternalForm, fallbackDialog } = useExternalFormOpener();

  // Identity fields needed to tag external (Fillout) form URLs.
  const { data: clientIdentity } = useQuery({
    queryKey: ["action-centre-client-identity", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, first_name, last_name, email")
        .eq("id", clientId!)
        .maybeSingle();
      return data;
    },
  });

  // Fallback form lookup when an occurrence has no metadata.form_id yet.
  const { data: clientForms = [] } = useQuery({
    queryKey: ["nf-forms-for-client", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: () => listFormsForClient(clientId!),
  });

  const openForm = (occ: ActionCentreItem) => {
    const metaId = (occ.metadata as any)?.form_id as string | undefined;
    const label = TASK_LABELS[occ.task_type] ?? occ.title;
    let id = metaId ?? null;
    if (!id) {
      const forms = clientForms as any[];
      const picked =
        occ.task_type === "nutrition_review"
          ? pickNutritionUpdateForm(forms)
          : pickWeeklyCheckInForm(forms);
      id = picked?.id ?? null;
    }
    if (!id) {
      navigate({ to: "/portal/check-ins" });
      return;
    }
    // External (Fillout) forms open directly in a real browser tab — no
    // embedded sheet, no generic Check-ins page in between.
    const record = (clientForms as any[]).find((f) => f.id === id);
    if (isExternalForm(record) && (clientIdentity ?? (clientId ? { id: clientId } : null))) {
      openExternalForm(record, (clientIdentity as any) ?? { id: clientId as string }, label);
      return;
    }
    setFormSheet({ id, title: label });
  };

  const openSheet = (occ: ActionCentreItem) => {
    setActiveOcc(occ);
    setSheetOpen(true);
  };

  const merged = useMemo<ActionItem[]>(() => {
    const occItems = (occurrences as ActionCentreItem[])
      .filter((o) => !locallyCompleted.has(o.id))
      // Home "Forms" section: only surface Weekly Check-In and Nutrition
      // form tasks. Other task types (progress photos, bodyweight, etc.)
      // live on their own dedicated home cards and would double up here.
      .filter((o) => o.task_type === "weekly_checkin" || o.task_type === "nutrition_review")
      .map((o) => occurrenceToItem(o, openSheet, openForm));
    const dedupKeys = new Set(occItems.map((i) => i.key));
    // Legacy items (billing, agreements, coach replies, etc.) are surfaced
    // elsewhere on the home screen. Keep this section strictly "Forms".
    void items;
    void dedupKeys;
    return occItems;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrences, items, locallyCompleted, clientForms]);

  const sorted = [...merged].sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);
  const visible = expanded ? sorted : sorted.slice(0, COMPACT_LIMIT);
  const hiddenCount = Math.max(0, sorted.length - visible.length);
  const [seen, setSeen] = useState<Set<string>>(() => readSeen());

  const currentKeys = sorted.map((it) => it.key);
  const unseenCount = currentKeys.filter((k) => !seen.has(k)).length;

  // Mark all currently-visible items as seen shortly after they render, so the
  // badge clears once the user has actually had a chance to see them.
  useEffect(() => {
    if (currentKeys.length === 0) return;
    const t = window.setTimeout(() => {
      setSeen((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const k of currentKeys) {
          if (!next.has(k)) {
            next.add(k);
            changed = true;
          }
        }
        // Prune keys for items that no longer exist so the store stays bounded.
        const live = new Set(currentKeys);
        for (const k of Array.from(next)) {
          if (!live.has(k)) {
            next.delete(k);
            changed = true;
          }
        }
        if (changed) writeSeen(next);
        return changed ? next : prev;
      });
    }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKeys.join("|")]);

  return (
    <section aria-label="Action Centre" className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-base font-bold">
          Forms{sorted.length > 0 ? ` (${sorted.length})` : ""}
        </h3>
        {unseenCount > 0 && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
            {unseenCount}
          </span>
        )}
      </div>
      {sorted.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">✅ You're all caught up</div>
            <div className="text-xs text-muted-foreground">No forms are due right now.</div>
          </div>
        </div>
      ) : (
        <>
          <ul className="overflow-hidden rounded-2xl border border-border bg-card">
            {visible.map((it, i) => (
              <li key={it.key} className={i > 0 ? "border-t border-border/70" : ""}>
                <Row item={it} justCompleted={justCompleted === it.key} />
              </li>
            ))}
          </ul>
          {(hiddenCount > 0 || expanded) && sorted.length > COMPACT_LIMIT && (
            <button
              type="button"
              onClick={() => {
                const next = !expanded;
                setExpanded(next);
                writeExpanded(next);
              }}
              className="mx-auto flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground transition hover:text-foreground"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" /> Show fewer
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" /> View all tasks ({hiddenCount} more)
                </>
              )}
            </button>
          )}
        </>
      )}
      {/* Coach Feedback lives on the Check-Ins / Progress surfaces — removing
          the duplicate card here keeps Home compact. */}

      {fallbackDialog}
      <ClientFormSheet
        formId={formSheet?.id ?? null}
        title={formSheet?.title}
        open={!!formSheet}
        onOpenChange={(v) => { if (!v) setFormSheet(null); }}
      />
      <ActionTaskSheet
        item={activeOcc}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCompleted={(id) => {
          setJustCompleted(`occ-${id}`);
          window.setTimeout(() => {
            setLocallyCompleted((prev) => new Set(prev).add(id));
            setJustCompleted(null);
          }, 450);
        }}
      />
    </section>
  );
}

function Row({ item, justCompleted }: { item: ActionItem; justCompleted?: boolean }) {
  const Icon = item.icon;
  const toneIcon =
    item.tone === "warning" ? "text-warning"
    : item.tone === "success" ? "text-emerald-500"
    : "text-primary";
  const toneChip =
    item.tone === "warning" ? "bg-warning/15 text-warning"
    : item.tone === "success" ? "bg-emerald-500/15 text-emerald-500"
    : "bg-primary/15 text-primary";

  const body = (
    <div className={cn(
      "flex min-h-[56px] items-center gap-3 px-4 py-2.5 transition active:bg-secondary/30",
      justCompleted && "bg-emerald-500/10",
    )}>
      {justCompleted ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500 animate-in fade-in zoom-in" />
      ) : (
        <Icon className={cn("h-5 w-5 shrink-0", toneIcon)} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-semibold">{item.title}</div>
          {item.chip && (
            <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", toneChip)}>
              {item.chip}
            </span>
          )}
        </div>
        {item.message && (
          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.message}</div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );

  if (item.to) {
    // Pre-interpolate `$param` placeholders so we never hand TanStack a
    // template string with a missing/misaligned params prop. Extra params
    // become search params (safe for TanStack `search`).
    let resolved = item.to;
    const leftover: Record<string, unknown> = {};
    if (item.params) {
      for (const [k, v] of Object.entries(item.params)) {
        const tag = `$${k}`;
        if (resolved.includes(tag)) {
          resolved = resolved.split(tag).join(encodeURIComponent(String(v)));
        } else {
          leftover[k] = v;
        }
      }
    }
    const mergedSearch = { ...(item.search ?? {}), ...leftover };
    const hasSearch = Object.keys(mergedSearch).length > 0;
    return (
      <Link
        to={resolved}
        search={hasSearch ? (mergedSearch as any) : undefined}
        className="block"
      >
        {body}
      </Link>
    );
  }
  if (item.href) return (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className="block">{body}</a>
  );
  return (
    <button type="button" onClick={item.onClick} className="block w-full text-left">{body}</button>
  );
}