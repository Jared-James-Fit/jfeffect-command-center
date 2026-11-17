/**
 * Compare progress photos: a quick pick (1, 2, 4, 6, 8 or 12 weeks back from
 * the latest check-in) or any two check-ins, each angle side by side, as a
 * before / after slider, or every check-in in order. Each photo carries what
 * the scale (7-day average) and the waist tape said around that date, since a
 * photo alone is mostly lighting and pose. Tap a photo to zoom. The photos are
 * the same files the progress library holds (signed links, never copied).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ANGLE_LABEL,
  PHOTO_ANGLES,
  getSignedMediaUrl,
  listBodyweight,
  listMeasurements,
  listMediaForSubmission,
  listSubmissions,
  type ProgressAngle,
  type ProgressSubmission,
} from "@/lib/progress";
import { availableWeeks, changeText, pickComparison, waistAround, weightAround } from "@/lib/progress-compare";
import { cn } from "@/lib/utils";

type Mode = "side" | "slider" | "timeline";
const fmtDate = (d: string) => format(parseISO(d), "MMM d, yyyy");
const LB = 2.2046226218;

export function PhotoCompareDialog({ userId, unit, open, onOpenChange }: { userId: string; unit: "kg" | "lb"; open: boolean; onOpenChange: (b: boolean) => void }) {
  const { data: subs = [] } = useQuery({
    queryKey: ["progress-subs-photo", userId],
    queryFn: () => listSubmissions({ userId, type: "photo" }),
    enabled: open,
    staleTime: 60_000,
  });
  const { data: bw = [] } = useQuery({ queryKey: ["progress-bodyweight", userId], queryFn: () => listBodyweight(userId), enabled: open, staleTime: 60_000 });
  const { data: tape = [] } = useQuery({ queryKey: ["progress-measurements", userId], queryFn: () => listMeasurements(userId), enabled: open, staleTime: 60_000 });

  const dated = useMemo(() => subs.map((s) => ({ ...s, date: s.submission_date })), [subs]);
  const quick = useMemo(() => availableWeeks(dated), [dated]);
  const [weeks, setWeeks] = useState<number | null>(null);
  const [aId, setA] = useState<string | null>(null);
  const [bId, setB] = useState<string | null>(null);
  const [angle, setAngle] = useState<ProgressAngle>("front");
  const [mode, setMode] = useState<Mode>("side");

  useEffect(() => {
    if (aId || !dated.length) return;
    const w = quick.includes(4) ? 4 : (quick[quick.length - 1] ?? null);
    const pick = w ? pickComparison(dated, w) : pickComparison(dated, 1000);
    if (pick) {
      setWeeks(w);
      setA(pick.before.id);
      setB(pick.after.id);
    } else {
      setA(dated[0].id);
      setB(dated[0].id);
    }
  }, [dated, quick, aId]);

  const chooseWeeks = (w: number) => {
    const pick = pickComparison(dated, w);
    if (!pick) return;
    setWeeks(w);
    setA(pick.before.id);
    setB(pick.after.id);
  };

  const weights = useMemo(() => bw.map((r) => ({ date: r.logged_date, value: r.weight_unit === unit ? Number(r.weight_value) : r.weight_unit === "kg" ? Number(r.weight_value) * LB : Number(r.weight_value) / LB })), [bw, unit]);
  const waists = useMemo(() => tape.map((m) => ({ date: m.measured_date, waist: m.fields?.waist != null ? Number(m.fields.waist) : null, unit: m.unit })), [tape]);
  const numbersFor = (s: ProgressSubmission | undefined) => {
    if (!s) return { weight: null, waist: null };
    const w = weightAround(weights, s.submission_date);
    return { weight: w?.value ?? null, waist: waistAround(waists, s.submission_date) };
  };
  const subA = subs.find((s) => s.id === aId);
  const subB = subs.find((s) => s.id === bId);
  const nA = numbersFor(subA);
  const nB = numbersFor(subB);
  const wChange = changeText(nA.weight, nB.weight, unit);
  const tChange = nA.waist && nB.waist && nA.waist.unit === nB.waist.unit ? changeText(nA.waist.value, nB.waist.value, nA.waist.unit) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" data-photo-compare>
        <DialogHeader>
          <DialogTitle>Compare progress</DialogTitle>
        </DialogHeader>
        {subs.length < 2 ? (
          <p className="text-sm text-muted-foreground">Compare shows up once there are two photo check-ins.</p>
        ) : (
          <div className="space-y-3">
            {quick.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weeks back">
                {quick.map((w) => (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={weeks === w}
                    onClick={() => chooseWeeks(w)}
                    className={cn("h-9 rounded-full border px-3 text-[13px] font-medium", weeks === w ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted")}
                  >
                    {w} {w === 1 ? "week" : "weeks"}
                  </button>
                ))}
              </div>
            )}
            {mode !== "timeline" && (
              <div className="grid grid-cols-2 gap-3">
                <Picker label="Before" value={aId} onChange={(id) => { setWeeks(null); setA(id); }} subs={subs} />
                <Picker label="After" value={bId} onChange={(id) => { setWeeks(null); setB(id); }} subs={subs} />
              </div>
            )}
            <div className="grid grid-cols-4 gap-1">
              {PHOTO_ANGLES.map((a) => (
                <Button key={a} size="sm" variant={angle === a ? "secondary" : "ghost"} className="h-9" onClick={() => setAngle(a)}>
                  {ANGLE_LABEL[a]}
                </Button>
              ))}
            </div>
            <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="View">
              {(["side", "slider", "timeline"] as Mode[]).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("h-9 flex-1 rounded-md text-[13px] font-medium", mode === m ? "bg-card text-foreground ring-1 ring-border" : "text-muted-foreground")}>
                  {m === "side" ? "Side by side" : m === "slider" ? "Slider" : "All check-ins"}
                </button>
              ))}
            </div>

            {mode === "side" && aId && bId && (
              <div className="grid grid-cols-2 gap-3">
                <Pane subId={aId} angle={angle} sub={subA} numbers={nA} unit={unit} />
                <Pane subId={bId} angle={angle} sub={subB} numbers={nB} unit={unit} />
              </div>
            )}
            {mode === "slider" && aId && bId && <Slider aId={aId} bId={bId} angle={angle} subA={subA} subB={subB} />}
            {mode === "timeline" && (
              <div className="flex snap-x gap-3 overflow-x-auto pb-2" data-photo-timeline>
                {subs
                  .slice()
                  .sort((x, y) => x.submission_date.localeCompare(y.submission_date))
                  .map((s) => (
                    <div key={s.id} className="w-40 shrink-0 snap-start">
                      <Pane subId={s.id} angle={angle} sub={s} numbers={numbersFor(s)} unit={unit} />
                    </div>
                  ))}
              </div>
            )}
            {mode !== "timeline" && (wChange || tChange) && (
              <p className="text-[13px]" data-photo-compare-change>
                Between them: {[wChange ? `bodyweight ${wChange} (7-day averages)` : null, tChange ? `waist ${tChange}` : null].filter(Boolean).join(" · ")}.
              </p>
            )}
            <p className="text-xs text-muted-foreground">Light, pose, distance and the time of day change a photo more than a week of training does. Read photos next to the scale and the tape, and take them the same way each time.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Picker({ label, value, onChange, subs }: { label: string; value: string | null; onChange: (id: string) => void; subs: ProgressSubmission[] }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger className="h-10">
          <SelectValue placeholder="Pick a check-in" />
        </SelectTrigger>
        <SelectContent>
          {subs.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {fmtDate(s.submission_date)}
              {s.check_in_label ? ` — ${s.check_in_label}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function usePhoto(subId: string, angle: ProgressAngle) {
  const { data: media = [] } = useQuery({ queryKey: ["progress-media", subId], queryFn: () => listMediaForSubmission(subId), staleTime: 60 * 60 * 1000 });
  const m = media.find((mm) => mm.angle === angle);
  const { data: url } = useQuery({ queryKey: ["sig", m?.storage_path], enabled: !!m?.storage_path, queryFn: () => getSignedMediaUrl(m!.storage_path!), staleTime: 60 * 60 * 1000 });
  return url ?? null;
}

function Zoomable({ url, alt }: { url: string; alt: string }) {
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  return (
    <button
      type="button"
      aria-label={zoom ? "Zoom out" : "Zoom in"}
      className="block h-full w-full overflow-hidden"
      onClick={(e) => {
        if (zoom) return setZoom(null);
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
      }}
    >
      <img loading="lazy" src={url} alt={alt} className="h-full w-full object-cover transition-transform duration-200" style={zoom ? { transform: "scale(2.2)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined} />
    </button>
  );
}

function Pane({ subId, angle, sub, numbers, unit }: { subId: string; angle: ProgressAngle; sub: ProgressSubmission | undefined; numbers: { weight: number | null; waist: { value: number; unit: string } | null }; unit: string }) {
  const url = usePhoto(subId, angle);
  return (
    <div>
      <div className="aspect-[3/4] overflow-hidden rounded-lg bg-muted">
        {url ? <Zoomable url={url} alt={`${ANGLE_LABEL[angle]} ${sub?.submission_date ?? ""}`} /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No {ANGLE_LABEL[angle]} photo</div>}
      </div>
      <p className="mt-1 text-xs font-medium">{sub ? fmtDate(sub.submission_date) : ""}</p>
      <p className="text-xs text-muted-foreground">
        {[numbers.weight != null ? `${numbers.weight} ${unit} avg` : sub?.bodyweight ? `${sub.bodyweight} ${sub.weight_unit}` : null, numbers.waist ? `waist ${numbers.waist.value} ${numbers.waist.unit}` : null].filter(Boolean).join(" · ") || "No weigh-in that week"}
      </p>
    </div>
  );
}

function Slider({ aId, bId, angle, subA, subB }: { aId: string; bId: string; angle: ProgressAngle; subA?: ProgressSubmission; subB?: ProgressSubmission }) {
  const a = usePhoto(aId, angle);
  const b = usePhoto(bId, angle);
  const [pos, setPos] = useState(50);
  if (!a || !b) return <p className="text-xs text-muted-foreground">Both check-ins need a {ANGLE_LABEL[angle]} photo for the slider.</p>;
  return (
    <div className="space-y-2" data-photo-slider>
      <div className="relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-lg bg-muted">
        <img src={b} alt="After" className="absolute inset-0 h-full w-full object-cover" />
        <img src={a} alt="Before" className="absolute inset-0 h-full w-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-background" style={{ left: `${pos}%` }} aria-hidden />
        <span className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[11px]">{subA ? fmtDate(subA.submission_date) : "Before"}</span>
        <span className="absolute right-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[11px]">{subB ? fmtDate(subB.submission_date) : "After"}</span>
      </div>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="w-full accent-foreground" aria-label="Before and after" />
    </div>
  );
}
