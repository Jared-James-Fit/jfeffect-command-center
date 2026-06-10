import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowDown, ArrowUp, Plus, Trash2, X, RotateCcw, Save, Layers } from "lucide-react";
import type { NavItem } from "@/components/app-shell";
import {
  type BarScope, type BarLayout, type BarSlot,
  loadBarLayout, saveBarLayout, clearBarLayout, navItemsToLayout,
} from "@/lib/floating-bar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function defaultLayoutFromItems(items: NavItem[]): BarLayout {
  return navItemsToLayout(items);
}

function NavPicker({
  nav, exclude, onPick, label,
}: {
  nav: NavItem[];
  exclude: Set<string>;
  onPick: (item: NavItem) => void;
  label: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(
    () => nav.filter((n) => !exclude.has(n.to) && n.label.toLowerCase().includes(q.toLowerCase())),
    [nav, exclude, q],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <Plus className="mr-1 h-3 w-3" />{label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search pages…"
          className="h-8 text-xs"
        />
        <div className="mt-2 max-h-72 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">No matches.</div>
          )}
          <ul className="space-y-0.5">
            {filtered.map((n) => {
              const Icon = n.icon;
              return (
                <li key={n.to}>
                  <button
                    type="button"
                    onClick={() => { onPick(n); setOpen(false); setQ(""); }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{n.label}</span>
                    {n.group && <span className="text-[10px] text-muted-foreground">{n.group}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FloatingBarCustomizer({
  scope,
  nav,
  defaults,
}: {
  scope: BarScope;
  /** Full nav source used to pick items. */
  nav: NavItem[];
  /** Default layout to fall back to / reset to. */
  defaults: NavItem[];
}) {
  const [layout, setLayout] = useState<BarLayout>(
    () => loadBarLayout(scope) ?? defaultLayoutFromItems(defaults),
  );

  const navByTo = useMemo(() => {
    const m = new Map<string, NavItem>();
    for (const n of nav) m.set(n.to, n);
    return m;
  }, [nav]);

  const usedTopLevel = new Set(layout.slots.map((s) => s.to));

  const persist = (next: BarLayout) => {
    setLayout(next);
    saveBarLayout(scope, next);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = { slots: [...layout.slots] };
    const target = idx + dir;
    if (target < 0 || target >= next.slots.length) return;
    [next.slots[idx], next.slots[target]] = [next.slots[target], next.slots[idx]];
    persist(next);
  };

  const removeSlot = (idx: number) => {
    const next = { slots: layout.slots.filter((_, i) => i !== idx) };
    persist(next);
  };

  const addSlot = (item: NavItem) => {
    if (layout.slots.length >= 5) {
      toast.error("Max 5 main toggles");
      return;
    }
    persist({ slots: [...layout.slots, { to: item.to }] });
  };

  const addChild = (idx: number, item: NavItem) => {
    const next = { slots: layout.slots.map((s, i) => {
      if (i !== idx) return s;
      const children = [...(s.children ?? []), item.to];
      return { ...s, children };
    })};
    persist(next);
  };

  const removeChild = (idx: number, childTo: string) => {
    const next = { slots: layout.slots.map((s, i) => {
      if (i !== idx) return s;
      return { ...s, children: (s.children ?? []).filter((c) => c !== childTo) };
    })};
    persist(next);
  };

  const reset = () => {
    clearBarLayout(scope);
    setLayout(defaultLayoutFromItems(defaults));
    toast.success("Reset to default");
  };

  return (
    <Card className="border-border bg-card p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-black uppercase tracking-widest">Floating Bar</h3>
          <p className="text-xs text-muted-foreground">
            Customize what shows in your mobile bottom bar. Add children to stack
            multiple toggles above a single button — hold and drag to pick.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={reset}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />Reset
        </Button>
      </div>

      <ol className="space-y-2">
        {layout.slots.map((slot, idx) => {
          const base = navByTo.get(slot.to);
          if (!base) {
            return (
              <li key={slot.to + idx} className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                <span>Missing route: {slot.to}</span>
                <Button size="sm" variant="ghost" onClick={() => removeSlot(idx)}><X className="h-3.5 w-3.5" /></Button>
              </li>
            );
          }
          const Icon = base.icon;
          const childExclude = new Set<string>([slot.to, ...(slot.children ?? [])]);
          return (
            <li key={slot.to + idx} className="rounded-md border border-border bg-secondary/30 p-2.5">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{slot.label ?? base.label}</div>
                  <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">slot {idx + 1}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === layout.slots.length - 1} onClick={() => move(idx, 1)} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeSlot(idx)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>

              {/* children */}
              <div className="mt-2 pl-9">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Layers className="h-3 w-3" />Hold-to-open options
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(slot.children ?? []).map((cTo) => {
                    const c = navByTo.get(cTo);
                    if (!c) return null;
                    const CIcon = c.icon;
                    return (
                      <Badge key={cTo} variant="outline" className="gap-1 pr-1 text-[11px]">
                        <CIcon className="h-3 w-3" />
                        {c.label}
                        <button
                          onClick={() => removeChild(idx, cTo)}
                          className="ml-0.5 rounded p-0.5 hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Remove option"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                  <NavPicker nav={nav} exclude={childExclude} onPick={(it) => addChild(idx, it)} label="Add option" />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">{layout.slots.length} / 5 main toggles</div>
        <NavPicker
          nav={nav}
          exclude={usedTopLevel}
          onPick={addSlot}
          label="Add toggle"
        />
      </div>

      <div className="mt-3 rounded-md border border-dashed border-border bg-background/60 p-2 text-[11px] text-muted-foreground">
        <Save className="mr-1 inline h-3 w-3" />Changes save automatically and apply immediately.
      </div>
    </Card>
  );
}

export { defaultLayoutFromItems };
// suppress unused warning
void cn;