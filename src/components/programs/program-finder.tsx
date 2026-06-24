import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReactNode } from "react";

export type FinderItem = {
  id: string;
  title: string;
  trainingStyle?: string | null;
  level?: string | null; // difficulty
  weeks?: number | null;
  daysPerWeek?: number | null;
  goal?: string | null;
  raw?: any;
};

type Props = {
  items: FinderItem[];
  loadPayload: (item: FinderItem) => Promise<any>;
  renderActions?: (item: FinderItem) => ReactNode;
  loading?: boolean;
};

type Folder = {
  id: string;
  label: string;
  match: (it: FinderItem) => boolean;
  children?: Folder[];
};

function norm(s?: string | null) { return (s ?? "").toLowerCase().trim(); }
function styleOf(it: FinderItem) { return norm(it.trainingStyle); }
function levelOf(it: FinderItem) {
  const l = norm(it.level);
  const t = norm(it.title);
  if (l.includes("advanced-elite") || t.includes("[advanced-elite]")) return "advanced-elite";
  if (l.includes("advanced") || t.includes("[advanced]")) return "advanced";
  if (l.includes("intermediate") || t.includes("[intermediate]")) return "intermediate";
  if (l.includes("beginner") || t.includes("[beginner]")) return "beginner";
  return l;
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

export function ProgramFinder({ items, loadPayload, renderActions, loading }: Props) {
  const [folderId, setFolderId] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ bodybuilding: true });
  const [open, setOpen] = useState<FinderItem | null>(null);

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
  const rows = useMemo(() => items.filter((it) => current.match(it)), [items, current]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const f of FOLDERS) {
      out[f.id] = items.filter((it) => f.match(it)).length;
      if (f.children) for (const c of f.children) out[c.id] = items.filter((it) => c.match(it)).length;
    }
    return out;
  }, [items]);

  return (
    <div className="grid h-[calc(100vh-220px)] min-h-[480px] grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background/40">
      {/* Left: folder tree */}
      <aside className="flex h-full flex-col border-r border-border bg-muted/20">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Library</div>
        <ScrollArea className="flex-1 px-1.5 pb-2">
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
        </ScrollArea>
      </aside>

      {/* Right: list */}
      <section className="flex h-full min-w-0 flex-col">
        <div className="grid grid-cols-[minmax(0,2fr)_90px_70px_70px_minmax(0,1.2fr)] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div>Program</div><div>Level</div><div>Weeks</div><div>Days/wk</div><div>Goal</div>
        </div>
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No programs in this folder.</div>
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map((it) => (
                <li
                  key={it.id}
                  onClick={() => setOpen(it)}
                  className="grid cursor-pointer grid-cols-[minmax(0,2fr)_90px_70px_70px_minmax(0,1.2fr)] items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-primary/5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">{it.title}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{it.level || "—"}</div>
                  <div className="text-xs tabular-nums text-muted-foreground">{it.weeks ?? "—"}</div>
                  <div className="text-xs tabular-nums text-muted-foreground">{it.daysPerWeek ?? "—"}</div>
                  <div className="truncate text-xs text-muted-foreground">{it.goal || "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
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