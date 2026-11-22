/**
 * "Discard post?" (Instagram's): the one question before work in the New post
 * screen or the camera is thrown away (leaving, retaking a photo with text on
 * it, switching Post · Story with photos picked). Keep editing is the easy
 * tap; Discard says what goes.
 */
export function DiscardConfirm({
  title,
  body,
  action = "Discard",
  onConfirm,
  onCancel,
  tag,
}: {
  title: string;
  body: string;
  action?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Its data attribute (the tests and the composer's own name for it). */
  tag?: string;
}) {
  return (
    <div
      className="absolute inset-0 z-[75] grid place-items-center bg-black/60 px-8 text-white animate-in fade-in-0 duration-150"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      {...(tag ? { [`data-${tag}`]: "" } : { "data-discard-confirm": "" })}
    >
      <div className="w-full max-w-[300px] overflow-hidden rounded-2xl bg-[#262629] text-center animate-in zoom-in-95 duration-200">
        <div className="px-5 pb-4 pt-5">
          <div className="text-[17px] font-semibold">{title}</div>
          <p className="mt-1 text-[13px] text-white/65">{body}</p>
        </div>
        <button type="button" onClick={onConfirm} className="h-12 w-full border-t border-white/10 text-[15px] font-semibold text-red-400 active:bg-white/5" data-discard-yes>
          {action}
        </button>
        <button type="button" onClick={onCancel} className="h-12 w-full border-t border-white/10 text-[15px] active:bg-white/5" data-discard-no>
          Keep editing
        </button>
      </div>
    </div>
  );
}
