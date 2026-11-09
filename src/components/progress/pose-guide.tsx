import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  PHOTO_SETUP, POSE_CUES, POSE_DETAIL, POSE_ORDER, VIDEO_STEPS, type PoseAngle,
} from "@/lib/progress-pose-guide";

const POSE_NAME: Record<PoseAngle, string> = { front: "Front", left: "Left side", back: "Back", right: "Right side" };

/* The figures share one 60 × 116 canvas: head at the top, feet on y = 112. */
function FrontBody({ back = false }: { back?: boolean }) {
  return (
    <>
      <g fill="currentColor" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="30" cy="11" rx="6.5" ry="7.5" stroke="none" />
        <rect x="27" y="17" width="6" height="6" rx="2" stroke="none" />
        <path d="M17 25 Q30 21 43 25 L41 40 Q39 48 39.5 54 L41.5 64 L18.5 64 L20.5 54 Q21 48 19 40 Z" stroke="none" />
        <path d="M18 27 L13 45 L11 62" fill="none" strokeWidth="5.5" />
        <path d="M42 27 L47 45 L49 62" fill="none" strokeWidth="5.5" />
        <path d="M25.5 63 L24.5 88 L24 112" fill="none" strokeWidth="8" />
        <path d="M34.5 63 L35.5 88 L36 112" fill="none" strokeWidth="8" />
      </g>
      {back && (
        // the back: a spine and shoulder blades, drawn in the tile's own colour
        <g className="text-background" stroke="currentColor" fill="none" strokeLinecap="round" opacity={0.6}>
          <path d="M30 27 L30 56" strokeWidth="1.2" />
          <path d="M23 31 Q25 35 27 33 M37 31 Q35 35 33 33" strokeWidth="1.1" />
        </g>
      )}
    </>
  );
}

function SideBody() {
  return (
    <g fill="currentColor" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="29" cy="11" rx="6.2" ry="7.5" stroke="none" />
      <path d="M23.3 12 L21.6 14.2 L23.4 15" stroke="none" />
      <rect x="28" y="17" width="5.5" height="6" rx="2" stroke="none" />
      <path d="M25 25 Q31 22 36 25 Q37.5 33 36 40 Q35 47 35.5 53 Q37.5 58 36.5 64 L25 64 Q23.5 58 25 53 Q26 47 25 41 Q22.5 35 25 25 Z" stroke="none" />
      <path d="M30.5 27 L28 44 L24.5 60" fill="none" strokeWidth="5.2" />
      <path d="M30 63 L30.5 88 L31 111" fill="none" strokeWidth="8.5" />
      <path d="M31 112 L24.5 112" fill="none" strokeWidth="4" />
    </g>
  );
}

/**
 * How to stand for one pose, as a figure. The left side faces the camera when
 * the person faces the left of the picture; the right side is its mirror.
 */
export function PoseFigure({ angle, className }: { angle: PoseAngle; className?: string }) {
  return (
    <svg viewBox="0 0 60 116" className={cn("h-20 w-auto", className)} aria-hidden data-pose-figure={angle}>
      {angle === "front" && <FrontBody />}
      {angle === "back" && <FrontBody back />}
      {angle === "left" && <SideBody />}
      {angle === "right" && <g transform="translate(60,0) scale(-1,1)"><SideBody /></g>}
    </svg>
  );
}

/** Where the phone goes: belly-button height, 6 to 8 feet away. */
function SetupDiagram() {
  return (
    <svg viewBox="0 0 260 140" className="h-auto w-full text-muted-foreground" aria-hidden data-setup-diagram>
      {/* facing the phone */}
      <g transform="translate(18,8)"><g transform="translate(60,0) scale(-1,1)"><SideBody /></g></g>
      <line x1="8" y1="121" x2="252" y2="121" stroke="currentColor" strokeWidth="1.5" opacity={0.5} />
      {/* phone on a stand, upright, at belly-button height */}
      <g stroke="currentColor" strokeLinecap="round" fill="none" strokeWidth="2">
        <path d="M222 66 L222 121 M222 92 L210 121 M222 92 L234 121" />
      </g>
      <rect x="215" y="45" width="14" height="24" rx="2.5" className="fill-foreground" />
      <circle cx="222" cy="49" r="1.4" className="fill-background" />
      {/* line of sight */}
      <line x1="56" y1="57" x2="213" y2="57" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 4" />
      <text x="134" y="51" textAnchor="middle" className="fill-foreground" style={{ font: "600 10px system-ui, sans-serif" }}>belly-button height</text>
      {/* distance */}
      <g stroke="currentColor" strokeWidth="1.2" fill="none">
        <path d="M54 132 L218 132 M60 128 L54 132 L60 136 M212 128 L218 132 L212 136" />
      </g>
      <text x="136" y="129" textAnchor="middle" className="fill-foreground" style={{ font: "600 10px system-ui, sans-serif" }}>6 to 8 feet</text>
    </svg>
  );
}

/** What the picture should hold: the whole body, a little room above and below. */
function FramingDiagram() {
  return (
    <svg viewBox="0 0 90 150" className="h-auto w-24 shrink-0 text-muted-foreground" aria-hidden data-framing-diagram>
      <rect x="2" y="2" width="86" height="146" rx="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <g transform="translate(15,17)"><FrontBody /></g>
      <g stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity={0.7}>
        <line x1="8" y1="17" x2="82" y2="17" />
        <line x1="8" y1="131" x2="82" y2="131" />
      </g>
    </svg>
  );
}

/** The guide itself: the setup, the framing, the single-video turn and the four poses. */
export function PoseGuideContent({ kind }: { kind: "photo" | "video" }) {
  return (
    <>
      <div className="mt-4 rounded-2xl border border-border p-3">
        <SetupDiagram />
      </div>

      <ol className="mt-4 space-y-3">
        {PHOTO_SETUP.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{s.title}</div>
              <div className="text-sm text-muted-foreground">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border p-3">
        <FramingDiagram />
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Fill the frame head to feet.</span> Leave a little space above your
          head and below your feet, and stand in the middle.
        </p>
      </div>

      {kind === "video" && (
        <>
          <h3 className="mt-6 text-base font-semibold">Single video</h3>
          <ol className="mt-2 space-y-2">
            {VIDEO_STEPS.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground">{i + 1}</span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      <h3 className="mt-6 text-base font-semibold">{kind === "video" ? "The four angles" : "The four poses"}</h3>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {POSE_ORDER.map((a) => (
          <div key={a} className="rounded-2xl border border-border p-3" data-pose-demo={a}>
            <div className="flex justify-center py-1 text-muted-foreground">
              <PoseFigure angle={a} className="h-24" />
            </div>
            <div className="mt-1 text-sm font-semibold">{POSE_NAME[a]}</div>
            <div className="text-xs text-muted-foreground">{POSE_DETAIL[a]}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * "How to take them": the setup (time, light, phone height and distance,
 * framing, clothes, stance), each pose with its figure, and for videos the
 * single-take turn. Opens over the photo or video dialog.
 */
export function PoseGuideButton({ kind }: { kind: "photo" | "video" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="-ml-1 inline-flex h-10 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-foreground active:bg-secondary"
        data-pose-guide-open
      >
        <BookOpen className="h-4 w-4" /> How to take them
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-2xl px-4 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-3"
          data-pose-guide
        >
          <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="text-lg font-semibold">
            How to take your progress {kind === "video" ? "videos" : "photos"}
          </SheetTitle>
          <SheetDescription className="mt-1 text-sm text-muted-foreground">
            Take them the same way every time, so the only thing that changes is you.
          </SheetDescription>
          <PoseGuideContent kind={kind} />
        </SheetContent>
      </Sheet>
    </>
  );
}

export { POSE_CUES };
