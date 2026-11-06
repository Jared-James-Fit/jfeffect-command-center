/**
 * The challenge builder's form pieces: labelled fields, chip choices, toggles,
 * list editors, divisions, a date + time in the event's own zone, the exercise
 * library picker and the cover upload.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { cn } from "@/lib/utils";
import { errorText, mediaUrl, MEDIA_BUCKET } from "@/lib/challenges/api";
import { localDateISO, localTimeHM, wallTimeToUtc } from "@/lib/schedule-time";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type DivisionDraft = { id?: string; name: string; load_label: string };

export function F({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  /** The id of the one input this labels (screen readers announce the label with it). */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Chips({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "min-h-10 rounded-full px-4 text-sm font-medium",
            value === v ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-border p-4">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ListEditor({
  label,
  hint,
  items,
  onChange,
  addLabel,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (v: string[]) => void;
  addLabel: string;
}) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div>
      <Label className="text-sm font-medium">{label}</Label>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      <ol className="mt-2 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-3 w-5 shrink-0 text-right text-xs text-muted-foreground">
              {i + 1}.
            </span>
            {/* grows with the line, so a long rule is read whole, not cut off */}
            <AutoGrowTextarea
              value={it}
              onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
              rows={1}
              maxHeight={240}
              className="min-h-11 flex-1 resize-none"
              aria-label={`${label} ${i + 1}`}
            />
            <div className="flex flex-col">
              <button
                type="button"
                className="h-5 px-1 text-muted-foreground"
                onClick={() => move(i, -1)}
                aria-label="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="h-5 px-1 text-muted-foreground"
                onClick={() => move(i, 1)}
                aria-label="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              className="mt-2.5 px-1 text-muted-foreground"
              onClick={() => onChange(items.filter((_, k) => k !== i))}
              aria-label="Remove"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-10"
        onClick={() => onChange([...items, ""])}
      >
        <Plus className="mr-1.5 h-4 w-4" /> {addLabel}
      </Button>
    </div>
  );
}

export function DivisionsEditor({
  divisions,
  onChange,
}: {
  divisions: DivisionDraft[];
  onChange: (v: DivisionDraft[]) => void;
}) {
  return (
    <div>
      <Label className="text-sm font-medium">Divisions (optional)</Label>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Give a division its own load (e.g. Women · 135 lb) and it gets its own board and its own
        places.
      </p>
      <div className="mt-2 space-y-2">
        {divisions.map((d, i) => (
          <div key={d.id ?? i} className="flex gap-2">
            <Input
              value={d.name}
              onChange={(e) =>
                onChange(divisions.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))
              }
              placeholder="Name"
              className="h-11 flex-1"
              maxLength={40}
            />
            <Input
              value={d.load_label}
              onChange={(e) =>
                onChange(
                  divisions.map((x, k) => (k === i ? { ...x, load_label: e.target.value } : x)),
                )
              }
              placeholder="Own load (optional)"
              className="h-11 w-40"
              maxLength={40}
            />
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-2"
              onClick={() => onChange(divisions.filter((_, k) => k !== i))}
              aria-label="Remove division"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-10"
        onClick={() => onChange([...divisions, { name: "", load_label: "" }])}
      >
        <Plus className="mr-1.5 h-4 w-4" /> Add a division
      </Button>
    </div>
  );
}

export function DateTimeField({
  label,
  value,
  tz,
  onChange,
}: {
  label: string;
  value: string | null;
  tz: string;
  onChange: (v: string | null) => void;
}) {
  const d = value ? new Date(value) : null;
  const [date, setDate] = useState(d ? localDateISO(d, tz) : "");
  const [time, setTime] = useState(d ? localTimeHM(d, tz) : "");
  // only what the person changes is reported (opening the form never counts as an edit)
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) return;
    if (date && time) onChange(wallTimeToUtc(date, time, tz).toISOString());
    else if (!date) onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, time, tz]);
  return (
    <F label={label}>
      <div className="flex gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => {
            touched.current = true;
            setDate(e.target.value);
          }}
          className="h-11 flex-1"
        />
        <Input
          type="time"
          value={time}
          onChange={(e) => {
            touched.current = true;
            setTime(e.target.value);
          }}
          className="h-11 w-32"
        />
        {date ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-2"
            onClick={() => {
              touched.current = true;
              setDate("");
              setTime("");
            }}
            aria-label="Clear"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </F>
  );
}

/** Type a name; the exercise library offers matches so the challenge links to the real exercise. */
export function ActivityPicker({
  value,
  exerciseId,
  onChange,
}: {
  value: string;
  exerciseId: string | null;
  onChange: (name: string, id: string | null) => void;
}) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  const term = text.trim();
  const matches = useQuery({
    queryKey: ["challenges", "exercise-search", term],
    queryFn: async () => {
      const { data } = await db
        .from("exercises")
        .select("id,name")
        .ilike("name", `%${term}%`)
        .eq("archived", false)
        .order("name")
        .limit(6);
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: focus && term.length >= 3,
    staleTime: 60_000,
  });
  return (
    <div className="relative">
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value, null);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        className="h-11"
        maxLength={80}
      />
      {exerciseId ? (
        <p className="mt-1 text-xs text-success">Linked to the exercise library</p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Pick from the library when it's there, or keep a custom name.
        </p>
      )}
      {focus && matches.data?.length ? (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-sm">
          {matches.data.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="block w-full px-3 py-2.5 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setText(m.name);
                  onChange(m.name, m.id);
                  setFocus(false);
                }}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CoverField({
  path,
  onChange,
}: {
  path: string | null;
  onChange: (p: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const url = useMemo(() => mediaUrl(path), [path]);
  return (
    <F
      label="Event artwork (optional)"
      hint="16:9 works best. Without one, the page uses clean type."
    >
      {url ? (
        <div className="relative overflow-hidden rounded-2xl">
          <img src={url} alt="" className="aspect-[16/9] w-full object-cover" />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute right-2 top-2"
            onClick={() => onChange(null)}
          >
            Remove
          </Button>
        </div>
      ) : (
        <label className="flex h-28 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{" "}
          Upload artwork
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 5 * 1024 * 1024) return toast.error("Keep artwork under 5 MB.");
              setBusy(true);
              try {
                const ext =
                  f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
                const p = `covers/${crypto.randomUUID()}.${ext}`;
                const { error } = await supabase.storage
                  .from(MEDIA_BUCKET)
                  .upload(p, f, { contentType: f.type, cacheControl: "31536000" });
                if (error) throw error;
                onChange(p);
              } catch (err) {
                toast.error(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
    </F>
  );
}
