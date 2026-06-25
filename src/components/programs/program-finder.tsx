import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReactNode } from "react";

export type FinderItem = {
  id: string;
  title: string;
  trainingStyle?: string | null;
  level?: string | null; // difficulty
  weeks?: number | null;
  daysPerWeek?: number | null;
  goal?: string | null;
  tags?: string[] | null;
  raw?: any;
  // ---- Optional admin/library metadata (used when showAdminFilters is on) ----
  templateType?: string | null;        // full_prep | block | week | day | exercise_row
  archived?: boolean;
  validationOk?: boolean;              // true => "Ready", false => "Incomplete"
  assignedClientCount?: number;        // # of active prep/block assignments
  membershipPublished?: boolean;       // template is currently published to membership
  description?: string | null;
  notes?: string | null;
};

type Props = {
  items: FinderItem[];
  loadPayload: (item: FinderItem) => Promise<any>;
  renderActions?: (item: FinderItem) => ReactNode;
  loading?: boolean;
  /** When true, render the full admin chip toolbar (type / style / status / weight class / assignment). */
  showAdminFilters?: boolean;
};

type Folder = {
  id: string;
  label: string;
  match: (it: FinderItem) => boolean;
  children?: Folder[];
};

function norm(s?: string | null) { return (s ?? "").toLowerCase().trim(); }
function styleOf(it: FinderItem) { return norm(it.trainingStyle); }

// ---------- Standardized title parsing ----------
// Format: "[Name] — [Level] • [Frequency] • [Primary Type]"
// Level slugs: beginner, beginner-intermediate, intermediate,
// intermediate-advanced, advanced, advanced-elite, elite, all-levels.
const LEVEL_LABELS: Record<string, string> = {
  "beginner": "Beginner",
  "beginner-intermediate": "Beginner–Intermediate",
  "intermediate": "Intermediate",
  "intermediate-advanced": "Intermediate–Advanced",
  "advanced": "Advanced",
  "advanced-elite": "Advanced–Elite",
  "elite": "Elite",
  "all-levels": "All Levels",
};
const LEVEL_BADGE_CLS: Record<string, string> = {
  "beginner": "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  "beginner-intermediate": "border-teal-500/40 bg-teal-500/15 text-teal-300",
  "intermediate": "border-blue-500/40 bg-blue-500/15 text-blue-300",
  "intermediate-advanced": "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
  "advanced": "border-orange-500/40 bg-orange-500/15 text-orange-300",
  "advanced-elite": "border-purple-500/40 bg-purple-500/15 text-purple-300",
  "elite": "border-purple-700/50 bg-purple-700/20 text-purple-200",
  "all-levels": "border-border bg-muted/40 text-muted-foreground",
};
function tagLookup(it: FinderItem, prefix: string): string | null {
  const t = (it.tags ?? []).find((x) => norm(x).startsWith(prefix));
  return t ? norm(t).slice(prefix.length) : null;
}
function levelOf(it: FinderItem): string {
  const tagged = tagLookup(it, "level:");
  if (tagged) return tagged;
  const hay = `${norm(it.level)} ${norm(it.title)}`;
  if (hay.includes("all levels") || hay.includes("all-levels")) return "all-levels";
  if (hay.includes("intermediate-advanced") || hay.includes("intermediate–advanced") || hay.includes("intermediate/advanced")) return "intermediate-advanced";
  if (hay.includes("beginner-intermediate") || hay.includes("beginner–intermediate") || hay.includes("beginner/intermediate")) return "beginner-intermediate";
  if (hay.includes("advanced-elite") || hay.includes("advanced–elite") || hay.includes("advanced/elite") || hay.includes("advanced elite")) return "advanced-elite";
  if (hay.includes("elite")) return "elite";
  if (hay.includes("advanced")) return "advanced";
  if (hay.includes("intermediate")) return "intermediate";
  if (hay.includes("beginner") || hay.includes("novice")) return "beginner";
  return "";
}
function freqOf(it: FinderItem): number | null {
  const tagged = tagLookup(it, "freq:");
  if (tagged) {
    const m = tagged.match(/(\d+)/);
    if (m) return Number(m[1]);
  }
  if (typeof it.daysPerWeek === "number") return it.daysPerWeek;
  return null;
}
function typeOf(it: FinderItem): string {
  const tagged = tagLookup(it, "type:");
  if (tagged) return tagged;
  return styleOf(it);
}
function typeLabel(t: string): string {
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function freqAliases(n: number | null): string[] {
  if (!n) return [];
  return [`${n}-day`, `${n} day`, `${n}d`, `${n}x`, `${n}x per week`, `${n} days/week`, `${n}/week`];
}

const FOLDERS: Folder[] = [
  { id: "all", label: "All Programs", match: () => true },
  { id: "powerlifting", label: "Powerlifting", match: (it) => styleOf(it) === "powerlifting" },
  {
    id: "bodybuilding", label: "Bodybuilding",
    match: (it) => styleOf(it) === "bodybuilding",
    children: [
      { id: "bb-beginner", label: "Beginner", match: (it) => styleOf(it) === "bodybuilding" && levelOf(it) === "beginner" },
      { id: "bb-intermediate", label: "Intermediate", match: (it) => styleOf(it) === "bodybuilding" && levelOf(it) === "intermediate" },
      { id: "bb-advanced", label: "Advanced", match: (it) => styleOf(it) === "bodybuilding" && levelOf(it) === "advanced" },
      { id: "bb-advanced-elite", label: "Advanced-Elite", match: (it) => styleOf(it) === "bodybuilding" && levelOf(it) === "advanced-elite" },
    ],
  },
  { id: "strength", label: "Strength", match: (it) => styleOf(it) === "strength" },
  {
    id: "custom", label: "Custom",
    match: (it) => {
      const s = styleOf(it);
      return !s || !["powerlifting", "bodybuilding", "strength"].includes(s);
    },
  },
];

function FolderRow({
  folder, depth, active, expanded, onSelect, onToggle, count,
}: {
  folder: Folder; depth: number; active: boolean; expanded: boolean;
  onSelect: () => void; onToggle: () => void; count: number;
}) {
  const hasChildren = !!folder.children?.length;
  return (
    <button
      type="button"
      onClick={() => { onSelect(); if (hasChildren) onToggle(); }}
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {hasChildren ? (
        expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      {expanded && hasChildren ? <FolderOpen className="h-4 w-4 shrink-0 text-primary/80" /> : <Folder className="h-4 w-4 shrink-0 text-primary/70" />}
      <span className="min-w-0 truncate">{folder.label}</span>
      <span className="ml-auto shrink-0 rounded bg-muted/60 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function flatBlocks(payload: any): Array<{ name: string; weeks: any[] }> {
  if (!payload) return [];
  if (Array.isArray(payload.blocks_data) && payload.blocks_data.length) {
    return payload.blocks_data.map((b: any, i: number) => ({
      name: b?.name || `Block ${i + 1}`,
      weeks: b?.weeks_data ?? [],
    }));
  }
  if (Array.isArray(payload.weeks_data)) {
    return [{ name: "Block 1", weeks: payload.weeks_data }];
  }
  if (Array.isArray(payload.days)) {
    return [{ name: "Block 1", weeks: [{ week_index: 1, days: payload.days }] }];
  }
  return [];
}

function rowName(r: any, i: number) {
  return (typeof r?.exercise_name_override === "string" && r.exercise_name_override.trim())
    || r?.exercise_name
    || r?.name
    || `Row ${i + 1}`;
}
function rowReps(r: any) {
  if (r?.measurement_type === "time" && r?.duration_seconds) return `${r.duration_seconds}s`;
  return r?.reps_text || r?.reps || "—";
}

function highlight(text: string, terms: string[] | string): ReactNode {
  const list = Array.isArray(terms)
    ? terms.filter(Boolean)
    : terms ? [terms] : [];
  if (!list.length || !text) return text;
  // Build a single case-insensitive regex covering all terms.
  const escaped = list
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
  if (!escaped.length) return text;
  const re = new RegExp(`(${escaped.join("|")})`, "ig");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-primary/30 px-0.5 text-foreground">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

// Standard quick-pick weight classes (matches Programs tab).
const WEIGHT_CLASS_TAGS: string[] = [
  "47kg", "52kg", "57kg", "59kg", "63kg", "66kg", "69kg", "74kg",
  "76kg", "83kg", "84kg", "84kg+", "93kg", "105kg", "120kg", "120kg+",
];

const TYPE_CHIPS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "full_prep", label: "Full Prep" },
  { value: "block", label: "Block" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "exercise_row", label: "Exercise Row" },
];
const STYLE_CHIPS: { value: string; label: string }[] = [
  { value: "powerlifting", label: "Powerlifting" },
  { value: "bodybuilding", label: "Bodybuilding" },
  { value: "strength", label: "Strength" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "hybrid", label: "Hybrid" },
  { value: "rehab_pivot", label: "Rehab / Pivot" },
  { value: "conditioning", label: "Conditioning" },
  { value: "custom", label: "Custom" },
];
const STATUS_CHIPS: { value: "ready" | "incomplete" | "archived"; label: string }[] = [
  { value: "ready", label: "Ready" },
  { value: "incomplete", label: "Incomplete" },
  { value: "archived", label: "Archived" },
];

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ProgramFinder({ items, loadPayload, renderActions, loading, showAdminFilters }: Props) {
  const [folderId, setFolderId] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ bodybuilding: true });
  const [open, setOpen] = useState<FinderItem | null>(null);
  const [query, setQuery] = useState("");
  const [fullBodyOnly, setFullBodyOnly] = useState(false);
  // Admin-only filter state
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [styleFilter, setStyleFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ready" | "incomplete" | "archived" | null>(null);
  const [weightClass, setWeightClass] = useState<string | null>(null);
  const [assignedFilter, setAssignedFilter] = useState<"any" | "clients" | "members" | "either" | "unassigned">("any");

  const allFolders = useMemo(() => {
    const flat: { folder: Folder; depth: number }[] = [];
    for (const f of FOLDERS) {
      flat.push({ folder: f, depth: 0 });
      if (f.children && expanded[f.id]) for (const c of f.children) flat.push({ folder: c, depth: 1 });
    }
    return flat;
  }, [expanded]);

  const findFolder = (id: string): Folder | null => {
    for (const f of FOLDERS) {
      if (f.id === id) return f;
      if (f.children) for (const c of f.children) if (c.id === id) return c;
    }
    return null;
  };

  const current = findFolder(folderId) ?? FOLDERS[0];
  const q = query.trim().toLowerCase();
  const qTerms = useMemo(
    () => q.split(/\s+/).filter((t) => t.length > 0),
    [q],
  );
  const hasFullBody = (it: FinderItem) =>
    (it.tags ?? []).some((t) => norm(t) === "full-body" || norm(t) === "full body");
  const haystackFor = (it: FinderItem): string => {
    const lvl = levelOf(it);
    const fr = freqOf(it);
    const ty = typeOf(it);
    return [
      it.title,
      it.level,
      it.goal,
      it.trainingStyle,
      it.description,
      it.notes,
      LEVEL_LABELS[lvl] ?? lvl,
      lvl,
      ty,
      ...freqAliases(fr),
      ...((it.tags ?? []) as string[]),
    ].filter(Boolean).join(" ").toLowerCase();
  };
  const matchesAdmin = (it: FinderItem): boolean => {
    if (!showAdminFilters) return true;
    // Type
    if (typeFilter !== "all" && (it.templateType ?? "") !== typeFilter) return false;
    // Style (chip overrides folder when set)
    if (styleFilter && norm(it.trainingStyle) !== styleFilter) return false;
    // Status
    if (statusFilter === "ready" && it.validationOk !== true) return false;
    if (statusFilter === "incomplete" && it.validationOk !== false) return false;
    if (statusFilter === "archived") {
      if (!it.archived) return false;
    } else if (it.archived) {
      // Hide archived unless explicitly requested.
      return false;
    }
    // Weight class tag
    if (weightClass) {
      const wc = weightClass.toLowerCase();
      const hit = (it.tags ?? []).some((t) => norm(t) === wc);
      if (!hit) return false;
    }
    // Assignment
    const hasClients = (it.assignedClientCount ?? 0) > 0;
    const hasMembers = !!it.membershipPublished;
    if (assignedFilter === "clients" && !hasClients) return false;
    if (assignedFilter === "members" && !hasMembers) return false;
    if (assignedFilter === "either" && !hasClients && !hasMembers) return false;
    if (assignedFilter === "unassigned" && (hasClients || hasMembers)) return false;
    return true;
  };
  const matchesQuery = (it: FinderItem): boolean => {
    if (!qTerms.length) return true;
    const h = haystackFor(it);
    return qTerms.every((t) => h.includes(t));
  };
  const rows = useMemo(() => {
    let base = items.filter((it) => current.match(it) && matchesAdmin(it));
    if (fullBodyOnly) base = base.filter(hasFullBody);
    return base.filter(matchesQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, current, qTerms.join("|"), fullBodyOnly, showAdminFilters, typeFilter, styleFilter, statusFilter, weightClass, assignedFilter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    const matchQuery = (it: FinderItem) => matchesQuery(it);
    const matchFb = (it: FinderItem) => (fullBodyOnly ? hasFullBody(it) : true);
    const matchAdmin = (it: FinderItem) => matchesAdmin(it);
    for (const f of FOLDERS) {
      out[f.id] = items.filter((it) => f.match(it) && matchQuery(it) && matchFb(it) && matchAdmin(it)).length;
      if (f.children) for (const c of f.children) out[c.id] = items.filter((it) => c.match(it) && matchQuery(it) && matchFb(it) && matchAdmin(it)).length;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, qTerms.join("|"), fullBodyOnly, showAdminFilters, typeFilter, styleFilter, statusFilter, weightClass, assignedFilter]);

  const fullBodyAvailable = useMemo(() => items.some(hasFullBody), [items]);

  return (
    <div className="grid h-[calc(100vh-220px)] min-h-[480px] max-h-[800px] grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background/40">
      {/* Left: folder tree */}
      <aside className="flex h-full min-h-0 flex-col border-r border-border bg-muted/20">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Library</div>
        <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
          <div className="space-y-0.5">
            {allFolders.map(({ folder, depth }) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                depth={depth}
                active={folder.id === folderId}
                expanded={!!expanded[folder.id]}
                count={counts[folder.id] ?? 0}
                onSelect={() => setFolderId(folder.id)}
                onToggle={() => setExpanded((p) => ({ ...p, [folder.id]: !p[folder.id] }))}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* Right: list */}
      <section className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search programs by name, level, goal…"
              className="h-8 pl-8 pr-8 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {fullBodyAvailable && (
            <Button
              type="button"
              size="sm"
              variant={fullBodyOnly ? "default" : "outline"}
              onClick={() => setFullBodyOnly((v) => !v)}
              className="h-8 shrink-0 px-2.5 text-xs"
              aria-pressed={fullBodyOnly}
            >
              Full Body
            </Button>
          )}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{rows.length} result{rows.length === 1 ? "" : "s"}</span>
        </div>
        {showAdminFilters && (
          <div className="space-y-1.5 border-b border-border bg-muted/10 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {TYPE_CHIPS.map((c) => (
                <Chip key={c.value} active={typeFilter === c.value} onClick={() => setTypeFilter(c.value)}>{c.label}</Chip>
              ))}
              <span className="px-1 text-muted-foreground/60">·</span>
              {STYLE_CHIPS.map((c) => (
                <Chip key={c.value} active={styleFilter === c.value} onClick={() => setStyleFilter(styleFilter === c.value ? null : c.value)}>{c.label}</Chip>
              ))}
              <span className="px-1 text-muted-foreground/60">·</span>
              {STATUS_CHIPS.map((c) => (
                <Chip key={c.value} active={statusFilter === c.value} onClick={() => setStatusFilter(statusFilter === c.value ? null : c.value)}>{c.label}</Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Assigned:</span>
              <Chip active={assignedFilter === "any"} onClick={() => setAssignedFilter("any")}>Any</Chip>
              <Chip active={assignedFilter === "clients"} onClick={() => setAssignedFilter("clients")}>Clients</Chip>
              <Chip active={assignedFilter === "members"} onClick={() => setAssignedFilter("members")}>Members</Chip>
              <Chip active={assignedFilter === "either"} onClick={() => setAssignedFilter("either")}>Clients or Members</Chip>
              <Chip active={assignedFilter === "unassigned"} onClick={() => setAssignedFilter("unassigned")}>Unassigned</Chip>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Weight class:</span>
              <Chip active={weightClass === null} onClick={() => setWeightClass(null)}>All</Chip>
              {WEIGHT_CLASS_TAGS.map((t) => (
                <Chip key={t} active={weightClass === t} onClick={() => setWeightClass(weightClass === t ? null : t)}>{t}</Chip>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_60px_70px_minmax(0,1fr)] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div>Program</div><div>Tags</div><div>Weeks</div><div>Days/wk</div><div>Goal</div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">{q ? `No programs match "${query}".` : "No programs in this folder."}</div>
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map((it) => {
                const lvl = levelOf(it);
                const fr = freqOf(it);
                const ty = typeOf(it);
                return (
                  <li
                    key={it.id}
                    onClick={() => setOpen(it)}
                    className="grid cursor-pointer grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_60px_70px_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-primary/5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium text-foreground">{highlight(it.title, qTerms)}</span>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {lvl && (
                        <span className={cn(
                          "rounded-full border px-1.5 py-px text-[10px] font-medium leading-4",
                          LEVEL_BADGE_CLS[lvl] ?? "border-border bg-muted/40 text-muted-foreground",
                        )}>
                          {LEVEL_LABELS[lvl] ?? lvl}
                        </span>
                      )}
                      {fr != null && (
                        <span className="rounded-full border border-border bg-muted/40 px-1.5 py-px text-[10px] font-medium leading-4 text-muted-foreground">
                          {fr}-Day
                        </span>
                      )}
                      {ty && (
                        <span className="rounded-full border border-border bg-muted/40 px-1.5 py-px text-[10px] font-medium leading-4 text-muted-foreground">
                          {typeLabel(ty)}
                        </span>
                      )}
                      {showAdminFilters && (it.assignedClientCount ?? 0) > 0 && (
                        <span className="rounded-full border border-blue-500/40 bg-blue-500/15 px-1.5 py-px text-[10px] font-medium leading-4 text-blue-300">
                          {it.assignedClientCount} client{it.assignedClientCount === 1 ? "" : "s"}
                        </span>
                      )}
                      {showAdminFilters && it.membershipPublished && (
                        <span className="rounded-full border border-rose-500/40 bg-rose-500/15 px-1.5 py-px text-[10px] font-medium leading-4 text-rose-300">
                          Membership
                        </span>
                      )}
                      {showAdminFilters && it.archived && (
                        <span className="rounded-full border border-border bg-muted/60 px-1.5 py-px text-[10px] font-medium leading-4 text-muted-foreground">
                          Archived
                        </span>
                      )}
                    </div>
                    <div className="text-xs tabular-nums text-muted-foreground">{it.weeks ?? "—"}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">{it.daysPerWeek ?? "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">{it.goal ? highlight(it.goal, qTerms) : "—"}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <ProgramDetailSheet item={open} onClose={() => setOpen(null)} loadPayload={loadPayload} renderActions={renderActions} />
    </div>
  );
}

function ProgramDetailSheet({
  item, onClose, loadPayload, renderActions,
}: {
  item: FinderItem | null;
  onClose: () => void;
  loadPayload: (item: FinderItem) => Promise<any>;
  renderActions?: (item: FinderItem) => ReactNode;
}) {
  const { data: payload, isLoading } = useQuery({
    queryKey: ["finder-payload", item?.id],
    queryFn: () => loadPayload(item!),
    enabled: !!item,
  });
  const blocks = useMemo(() => flatBlocks(payload), [payload]);

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {item && (
          <>
            <SheetHeader className="space-y-2 text-left">
              <SheetTitle className="pr-8">{item.title}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-1.5">
                {item.trainingStyle && <Badge variant="outline">{item.trainingStyle}</Badge>}
                {item.level && <Badge variant="outline">{item.level}</Badge>}
                {item.weeks != null && <Badge variant="secondary">{item.weeks} weeks</Badge>}
                {item.daysPerWeek != null && <Badge variant="secondary">{item.daysPerWeek}/wk</Badge>}
                {item.goal && <Badge variant="secondary">{item.goal}</Badge>}
              </SheetDescription>
              {renderActions && <div className="pt-1">{renderActions(item)}</div>}
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {isLoading ? (
                <div className="text-sm text-muted-foreground">Loading program…</div>
              ) : blocks.length === 0 ? (
                <div className="text-sm text-muted-foreground">No detail available for this program.</div>
              ) : (
                blocks.map((b, bi) => (
                  <div key={bi} className="rounded-md border border-border">
                    <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {b.name}
                    </div>
                    <div className="divide-y divide-border/60">
                      {b.weeks.map((w: any, wi: number) => (
                        <div key={wi} className="p-3">
                          <div className="text-xs font-semibold text-foreground">Week {w?.week_index ?? wi + 1}</div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {(w?.days ?? []).map((d: any, di: number) => (
                              <div key={di} className="rounded border border-border/60 bg-muted/20 p-2">
                                <div className="text-sm font-medium">{d?.title || `Day ${d?.day_index ?? di + 1}`}</div>
                                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                                  {(d?.rows ?? []).length === 0 ? (
                                    <li className="italic">No exercises</li>
                                  ) : (
                                    (d.rows as any[]).map((r, ri) => (
                                      <li key={ri} className="flex items-center justify-between gap-2">
                                        <span className="truncate text-foreground/90">{rowName(r, ri)}</span>
                                        <span className="shrink-0 tabular-nums">{r?.sets ?? "—"}×{rowReps(r)}</span>
                                      </li>
                                    ))
                                  )}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}