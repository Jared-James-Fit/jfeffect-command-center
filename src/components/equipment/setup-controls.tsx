/**
 * The setup sheet's controls, built to save typing: a number is − and +
 * around a box (the number pad when typed), a choice is one row of chips (tap
 * again to clear, Other for their own words), and photos are a strip with the
 * camera and the library one tap each.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, ImageOff, Loader2, Minus, Plus, RefreshCw, X } from "lucide-react";
import { useMediaViewer } from "@/components/media-viewer";
import { feedback } from "@/lib/feedback";
import { noAutofill } from "@/lib/no-autofill";
import { cn } from "@/lib/utils";
import { SETTING_VALUE_MAX } from "@/lib/equipment/equipment";
import { useEquipmentPhotoUrl } from "@/lib/equipment/equipment-queries";
import { stepValue, type FieldDef } from "@/lib/equipment/setup-fields";

const STEP_BTN =
  "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-foreground transition-transform active:scale-95 active:bg-muted-foreground/20 disabled:opacity-40";

/** − [ 9 ] +: a tap a step (an empty box starts from what they used before, else the field's usual). */
export function NumberStepper({
  value,
  onChange,
  def,
  fallback,
  label,
  readOnly = false,
  inputRef,
  onEnter,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  def: Pick<FieldDef, "step" | "min" | "max" | "start"> | null;
  fallback?: string | null;
  label: string;
  readOnly?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
  onEnter?: () => void;
  name: string;
}) {
  if (readOnly) {
    return <span className="min-w-10 text-right text-[15px] font-semibold tabular-nums text-foreground" data-setup-value>{value || "–"}</span>;
  }
  const bump = (dir: 1 | -1) => {
    feedback("detent");
    onChange(stepValue(value, dir, def, fallback));
  };
  return (
    <div className="flex shrink-0 items-center gap-1" data-setup-stepper>
      <button type="button" className={STEP_BTN} onClick={() => bump(-1)} aria-label={`${label} down`} data-setup-step="-1">
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <input
        ref={inputRef}
        value={value}
        maxLength={SETTING_VALUE_MAX}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter?.();
          }
        }}
        placeholder="–"
        aria-label={`${label} value`}
        inputMode="decimal"
        {...noAutofill(name)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        className="h-10 w-12 rounded-lg bg-transparent text-center text-[17px] font-semibold tabular-nums text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/50 focus:bg-muted/60"
        data-setup-value
      />
      <button type="button" className={STEP_BTN} onClick={() => bump(1)} aria-label={`${label} up`} data-setup-step="1">
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

const CHIP = "inline-flex h-10 shrink-0 items-center rounded-full border px-3.5 text-[14px] font-medium transition-colors active:scale-[0.97]";

/** One row of answers: a tap picks, a tap on the one picked clears it, Other takes their own words. */
export function ChoiceChips({
  value,
  options,
  onChange,
  label,
  readOnly = false,
  name,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  label: string;
  readOnly?: boolean;
  name: string;
}) {
  const own = !!value && !options.some((o) => o.toLowerCase() === value.trim().toLowerCase());
  const [typing, setTyping] = useState(false);
  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (typing) box.current?.focus();
  }, [typing]);
  if (readOnly) return null;
  const pick = (o: string) => {
    feedback("toggle");
    setTyping(false);
    onChange(value.trim().toLowerCase() === o.toLowerCase() ? "" : o);
  };
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none]" role="group" aria-label={label} data-setup-choices>
      {options.map((o) => {
        const on = value.trim().toLowerCase() === o.toLowerCase();
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => pick(o)}
            className={cn(CHIP, on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground")}
            data-setup-choice={o}
          >
            {o}
          </button>
        );
      })}
      {typing || own ? (
        <input
          ref={box}
          value={value}
          maxLength={SETTING_VALUE_MAX}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Your own"
          aria-label={`${label}, your own`}
          {...noAutofill(name)}
          autoCapitalize="sentences"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          className={cn(CHIP, "w-32 border-foreground bg-background text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60")}
          data-setup-choice-own
        />
      ) : (
        <button type="button" onClick={() => setTyping(true)} className={cn(CHIP, "border-dashed border-border text-muted-foreground")} data-setup-choice-other>
          Other
        </button>
      )}
    </div>
  );
}

export type LocalPhoto = { id: string; url: string; failed?: boolean };

/** A saved photo: tap to see it big, × to take it off, ↻ to retake it. */
function PhotoTile({ path, onRemove, onReplace, readOnly }: { path: string; onRemove: () => void; onReplace: () => void; readOnly: boolean }) {
  const url = useEquipmentPhotoUrl(path);
  const viewer = useMediaViewer();
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative h-[72px] w-[72px] shrink-0" data-setup-photo={path}>
      <button
        type="button"
        onClick={(e) => url && viewer.open(url, { alt: "Setup photo", from: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
        className="block h-full w-full overflow-hidden rounded-xl bg-muted"
        aria-label="See the setup photo"
      >
        {url && !broken ? (
          <img src={url} alt="" className="h-full w-full object-cover" decoding="async" onError={() => setBroken(true)} />
        ) : broken ? (
          <span className="grid h-full w-full place-items-center text-muted-foreground"><ImageOff className="h-4 w-4" aria-hidden /></span>
        ) : null}
      </button>
      {!readOnly && (
        <>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this photo"
            className="absolute -right-1.5 -top-1.5 grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-foreground text-background active:scale-95"
            data-setup-photo-remove
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onReplace}
            aria-label="Retake this photo"
            className="absolute bottom-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white active:scale-95"
            data-setup-photo-replace
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The setup's photos: what's saved, what's uploading (shown at once from the
 * phone, with a spinner until it's in), then Camera and Library while there's
 * room for more (4 at most).
 */
export function PhotoStrip({
  paths,
  uploading,
  max,
  readOnly,
  onCamera,
  onLibrary,
  onRemove,
  onReplace,
  onRetry,
}: {
  paths: string[];
  uploading: LocalPhoto[];
  max: number;
  readOnly: boolean;
  onCamera: () => void;
  onLibrary: () => void;
  onRemove: (index: number) => void;
  onReplace: (index: number) => void;
  onRetry: (id: string) => void;
}) {
  const room = max - paths.length - uploading.length;
  if (readOnly && !paths.length) return null;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 pt-1.5 [scrollbar-width:none]" data-setup-photos>
      {paths.map((p, i) => (
        <PhotoTile key={p} path={p} readOnly={readOnly} onRemove={() => onRemove(i)} onReplace={() => onReplace(i)} />
      ))}
      {uploading.map((u) => (
        <div key={u.id} className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-muted" data-setup-photo-uploading>
          <img src={u.url} alt="" className={cn("h-full w-full object-cover", !u.failed && "opacity-70")} />
          {u.failed ? (
            <button type="button" onClick={() => onRetry(u.id)} className="absolute inset-0 grid place-items-center bg-black/45 text-[12px] font-semibold text-white" aria-label="Try the upload again">
              Retry
            </button>
          ) : (
            <span className="absolute inset-0 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-white drop-shadow" aria-hidden /></span>
          )}
        </div>
      ))}
      {!readOnly && room > 0 && (
        <>
          <button
            type="button"
            onClick={onCamera}
            className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-[12px] font-medium text-muted-foreground active:bg-muted"
            data-setup-photo-camera
          >
            <Camera className="h-5 w-5" aria-hidden /> Camera
          </button>
          <button
            type="button"
            onClick={onLibrary}
            className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-[12px] font-medium text-muted-foreground active:bg-muted"
            data-setup-photo-library
          >
            <ImageIcon className="h-5 w-5" aria-hidden /> Library
          </button>
        </>
      )}
    </div>
  );
}
