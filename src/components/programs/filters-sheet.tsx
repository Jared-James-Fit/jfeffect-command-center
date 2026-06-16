import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Filter, X } from "lucide-react";

export interface FilterState {
  level?: string;
  daysPerWeek?: number;
  lengthMax?: number;
  location?: "gym" | "home";
  goal?: string;
  style?: string;
}

interface Props {
  value: FilterState;
  matchCount: number;
  onChange: (next: FilterState) => void;
}

const LEVELS = ["beginner", "novice", "intermediate", "advanced", "elite"];
const GOALS = [
  ["fat_loss", "Fat Loss"], ["muscle", "Muscle"], ["glutes", "Glutes"],
  ["strength", "Strength"], ["powerlifting", "Powerlifting"], ["powerbuilding", "Powerbuilding"],
] as const;
const STYLES = ["powerlifting", "bodybuilding", "powerbuilding", "hypertrophy", "strength"];

export function FiltersSheet({ value, matchCount, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterState>(value);
  const activeCount = Object.values(value).filter((v) => v !== undefined && v !== "").length;

  function apply() { onChange(draft); setOpen(false); }
  function reset() { setDraft({}); }

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(value); }}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{activeCount}</Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filter programs</SheetTitle>
        </SheetHeader>

        <Section label="Goal">
          <ChipGrid
            value={draft.goal}
            options={GOALS.map(([id, label]) => ({ id, label }))}
            onChange={(v) => setDraft({ ...draft, goal: v })}
          />
        </Section>

        <Section label="Training style">
          <ChipGrid
            value={draft.style}
            options={STYLES.map((s) => ({ id: s, label: s.replace("_", " ") }))}
            onChange={(v) => setDraft({ ...draft, style: v })}
          />
        </Section>

        <Section label="Experience level">
          <ChipGrid
            value={draft.level}
            options={LEVELS.map((l) => ({ id: l, label: l }))}
            onChange={(v) => setDraft({ ...draft, level: v })}
          />
        </Section>

        <Section label="Days per week">
          <ChipGrid
            value={draft.daysPerWeek ? String(draft.daysPerWeek) : undefined}
            options={[2, 3, 4, 5, 6].map((d) => ({ id: String(d), label: `${d} days` }))}
            onChange={(v) => setDraft({ ...draft, daysPerWeek: v ? Number(v) : undefined })}
          />
        </Section>

        <Section label="Workout length">
          <ChipGrid
            value={draft.lengthMax ? String(draft.lengthMax) : undefined}
            options={[30, 45, 60, 75, 90].map((m) => ({ id: String(m), label: `≤ ${m} min` }))}
            onChange={(v) => setDraft({ ...draft, lengthMax: v ? Number(v) : undefined })}
          />
        </Section>

        <Section label="Location">
          <ChipGrid
            value={draft.location}
            options={[
              { id: "gym", label: "Gym" },
              { id: "home", label: "Home" },
            ]}
            onChange={(v) => setDraft({ ...draft, location: v as "gym" | "home" | undefined })}
          />
        </Section>

        <SheetFooter className="mt-auto flex-row gap-2 sm:flex-row">
          <Button variant="ghost" className="flex-1" onClick={reset}>Clear all</Button>
          <Button className="flex-1" onClick={apply}>
            Apply ({matchCount})
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ChipGrid({
  value, options, onChange,
}: {
  value: string | undefined;
  options: Array<{ id: string; label: string }>;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(active ? undefined : o.id)}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs capitalize transition ${
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ActiveFilterChips({
  value, onChange,
}: { value: FilterState; onChange: (v: FilterState) => void }) {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <Badge key={k} variant="secondary" className="gap-1 pl-2 pr-1 text-xs">
          <span className="capitalize">{k}: {String(v).replace("_", " ")}</span>
          <button
            type="button"
            onClick={() => onChange({ ...value, [k]: undefined })}
            className="rounded-full p-0.5 hover:bg-foreground/10"
            aria-label={`Remove ${k} filter`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <button
        type="button"
        onClick={() => onChange({})}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
