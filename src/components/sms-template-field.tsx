import { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { SMS_TAGS, renderSmsTemplate, smsSegments, unknownSmsTags } from "@/lib/sms-identity";
import { cn } from "@/lib/utils";

type ExtraTag = { tag: string; label: string; sample: string };

/**
 * SMS template editor that can't be gotten wrong: tap a tag to drop it in at the cursor,
 * see the exact text a client gets underneath, and get warned about typo'd tags.
 */
export function SmsTemplateField({
  value, onChange, coach, brand, extraTags = [], rows = 3, maxLength = 1000, className,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Sample coach / business name for the preview. */
  coach?: string | null;
  brand?: string | null;
  extraTags?: ExtraTag[];
  rows?: number;
  maxLength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const tags = [...SMS_TAGS, ...extraTags];
  const sample: Record<string, string> = Object.fromEntries(tags.map((t) => [t.tag.slice(1, -1), t.sample]));
  const preview = renderSmsTemplate(value, { ...sample, coach: coach ?? "", brand: brand ?? "" });
  const unknown = unknownSmsTags(value, extraTags.map((t) => t.tag.slice(1, -1)));
  const segments = smsSegments(preview);

  const insert = (tag: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}${tag}${value.slice(end)}`;
    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => {
      if (!el) return;
      const at = before.length + pad.length + tag.length;
      el.focus();
      el.setSelectionRange(at, at);
    });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Textarea
        ref={ref}
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="text-[16px] md:text-sm"
      />
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <button
            key={t.tag}
            type="button"
            onClick={() => insert(t.tag)}
            className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-[11px] font-semibold transition hover:border-primary/50 hover:bg-primary/10 active:scale-95"
            title={`Insert ${t.tag}`}
          >
            + {t.label}
          </button>
        ))}
      </div>
      {unknown.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {unknown.map((u) => `{${u}}`).join(", ")} isn't a tag we know, so it'll be left blank. Use the buttons above.
          </span>
        </div>
      )}
      {value.trim() && (
        <div className="rounded-xl bg-secondary/40 p-2.5">
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <span>What they'll get</span>
            <span className={cn(segments > 2 && "text-amber-600")}>
              {preview.length} chars · {segments} text{segments === 1 ? "" : "s"}
            </span>
          </div>
          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-card px-3 py-2 text-[13px] leading-snug shadow-sm ring-1 ring-border">
            {preview}
          </div>
        </div>
      )}
    </div>
  );
}
