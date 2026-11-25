/**
 * The smart filming reminder in the logger (filming-reminder.ts is the rule,
 * the server records it): a coaching client who has trained without logged
 * footage is asked, once a rolling week and once a workout at most, to film a
 * working set of a main lift, just before it, never over typing, a sheet, the
 * camera or a clip being sent, and never alongside the set-video tip.
 *
 * "Let's get some footage" opens that set's camera for someone who has filmed
 * before; a first-timer gets a spotlight on the set's camera icon first.
 * "Maybe later" twice without an upload pauses it and quietly flags the coach.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Video } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { feedback } from "@/lib/feedback";
import { getSetVideoJobs, isActiveJob } from "@/lib/set-videos/jobs";
import { claimSetVideoTip, releaseSetVideoTip } from "@/lib/set-videos/tip";
import {
  FILM_SET_EVENT,
  reminderCopy,
  reminderDecision,
  reminderTargets,
  screenIsBusy,
  setVideoKey,
  type ReminderRow,
  type ReminderTarget,
  type Tier,
} from "@/lib/set-videos/filming-reminder";
import { answerReminder, filmingStatusKey, recordReminderShown, useFilmingStatus } from "@/lib/set-videos/filming-status";

/** Wait this long after the logger opens, then look for a quiet moment this often, this many times. */
const FIRST_LOOK_MS = 2500;
const LOOK_EVERY_MS = 1000;
const LOOKS = 90;

function targetElement(t: ReminderTarget): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-set-video-key="${CSS.escape(setVideoKey(t.rowId, t.setIndex))}"]`);
}

function filmSet(t: ReminderTarget) {
  window.dispatchEvent(new CustomEvent(FILM_SET_EVENT, { detail: { key: setVideoKey(t.rowId, t.setIndex) } }));
}

export function FilmingReminder({
  clientId,
  dayId,
  rows,
  enabled,
}: {
  clientId: string;
  dayId: string;
  rows: ReminderRow[];
  /** The client's own logger, a coaching client with set videos, workout not finished, nothing else introducing itself. */
  enabled: boolean;
}) {
  const qc = useQueryClient();
  const { data: status } = useFilmingStatus(clientId, enabled);
  const decision = useMemo(() => reminderDecision(status, dayId), [status, dayId]);
  const targets = useMemo(() => reminderTargets(rows), [rows]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [open, setOpen] = useState<{ tier: Tier; requested: boolean; target: ReminderTarget } | null>(null);
  const [spot, setSpot] = useState<ReminderTarget | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (!enabled || !decision.show || tried.current || !status) return;
    tried.current = true;
    const { tier, requested } = decision;
    let looks = 0;
    let timer = 0;
    let claimed = false;
    let cancelled = false;
    const look = async () => {
      if (cancelled || !enabledRef.current) return;
      const target = targetsRef.current.find((t) => !!targetElement(t)) ?? null;
      const busy = screenIsBusy() || getSetVideoJobs().some(isActiveJob) || !target;
      if (busy) {
        if (++looks < LOOKS) timer = window.setTimeout(() => void look(), LOOK_EVERY_MS);
        return;
      }
      // one pop-up at a time: the set-video tip and this share one slot per app open
      if (!claimSetVideoTip()) return;
      claimed = true;
      const ok = await recordReminderShown(clientId, dayId);
      if (cancelled) return;
      if (!ok) {
        releaseSetVideoTip();
        claimed = false;
        void qc.invalidateQueries({ queryKey: filmingStatusKey(clientId) });
        return;
      }
      setOpen({ tier, requested, target: target! });
    };
    timer = window.setTimeout(() => void look(), FIRST_LOOK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (claimed) releaseSetVideoTip();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, decision.show, status]);

  const copy = open && status ? reminderCopy(status, open.tier, { coachFirst: status.coach_first, requested: open.requested }) : null;
  const returning = !!status?.last_footage_at;

  const accept = () => {
    if (!open) return;
    const target = open.target;
    setOpen(null);
    feedback("tap");
    void answerReminder(clientId, "accept");
    if (returning) {
      // they know the camera: straight to it, from this tap
      filmSet(target);
      return;
    }
    targetElement(target)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setSpot(target);
  };
  const later = () => {
    if (!open) return;
    setOpen(null);
    void answerReminder(clientId, "dismiss").then(() => qc.invalidateQueries({ queryKey: filmingStatusKey(clientId) }));
  };

  return (
    <>
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) later(); }}>
        {copy && (
          <DialogContent
            showBackButton={false}
            className="w-[min(22rem,calc(100vw-2rem))] gap-0 rounded-3xl p-5 text-center"
            data-filming-reminder={open?.tier}
          >
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-foreground">
              <Video className="h-5 w-5" aria-hidden />
            </span>
            <DialogTitle className="text-[19px] font-semibold leading-snug">{copy.headline}</DialogTitle>
            <DialogDescription asChild>
              <div className="mt-2 space-y-1 text-[14px] leading-snug text-muted-foreground">
                {copy.stats.map((line) => (
                  <p key={line} className="tabular-nums" data-filming-stat>{line}</p>
                ))}
                <p className="pt-1">{copy.ask}</p>
              </div>
            </DialogDescription>
            <p className="mt-3 text-[13px] font-semibold tracking-wide">{copy.tagline}</p>
            <div className="mt-4 grid gap-2">
              <Button type="button" className="h-12 gap-2 rounded-full text-[15px]" onClick={accept} data-filming-accept>
                <Camera className="h-4 w-4" aria-hidden /> {copy.primary}
              </Button>
              <Button type="button" variant="ghost" className="h-11 rounded-full text-[14px] text-muted-foreground" onClick={later} data-filming-later>
                {copy.secondary}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
      {spot && <CameraSpotlight target={spot} onDone={() => setSpot(null)} />}
    </>
  );
}

/**
 * The first-timer's tutorial: everything dimmed but the set's camera, with
 * what it does. A tap on the camera (or Film this set) opens it; anywhere else closes.
 */
function CameraSpotlight({ target, onDone }: { target: ReminderTarget; onDone: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = targetElement(target);
      if (!el) return onDone();
      const r = el.getBoundingClientRect();
      // follows the page while it scrolls the set into view; renders only when it moved
      setRect((old) => (old && old.left === r.left && old.top === r.top && old.width === r.width ? old : r));
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.rowId, target.setIndex]);
  if (!rect) return null;
  const pad = 6;
  const size = Math.max(rect.width, rect.height) + pad * 2;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const below = cy < window.innerHeight * 0.55;
  const film = () => {
    onDone();
    filmSet(target);
  };
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Film a working set" data-filming-spotlight onClick={onDone}>
      <button
        type="button"
        aria-label={`Film ${target.name}, set ${target.setIndex}`}
        onClick={(e) => { e.stopPropagation(); film(); }}
        className="absolute rounded-full ring-2 ring-white motion-safe:animate-pulse"
        style={{ left: cx - size / 2, top: cy - size / 2, width: size, height: size, boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)" }}
      />
      <div
        className="absolute left-4 right-4 mx-auto max-w-sm rounded-2xl bg-background p-4 text-left shadow-xl dark:bg-card"
        style={below ? { top: cy + size / 2 + 12 } : { bottom: window.innerHeight - (cy - size / 2) + 12 }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[15px] font-semibold">Tap the camera on a working set</p>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          Film {target.name}, set {target.setIndex}, and log it as usual. The clip goes to your coach with the weight, reps and RPE, and its bar speed is read for you.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-10 px-3" onClick={onDone}>Got it</Button>
          <Button type="button" className="h-10 gap-1.5 px-3.5" onClick={film}>
            <Camera className="h-4 w-4" aria-hidden /> Film this set
          </Button>
        </div>
      </div>
    </div>
  );
}
