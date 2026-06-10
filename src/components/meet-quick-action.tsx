import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Video, Loader2, Link as LinkIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { createMeetLink } from "@/lib/meet.functions";

const PRESETS = [
  "Jump on this quick.",
  "Let’s do a quick call.",
  "Join when you’re ready.",
  "Quick check-in call.",
  "I’ll explain this better on a call.",
];

/**
 * Quick Google Meet composer button.
 * onInsert(text) is appended to the message draft. The Meet URL inside the
 * text is later rendered as a clean call card by chat-shared's body renderer.
 */
export function MeetQuickAction({
  onInsert,
  disabled,
  variant = "ghost",
  size = "icon",
  buttonClassName,
}: {
  onInsert: (text: string) => void;
  disabled?: boolean;
  variant?: "ghost" | "outline" | "secondary";
  size?: "icon" | "sm";
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const create = useServerFn(createMeetLink);

  const insertWithPreset = (link: string) => {
    onInsert(link);
    setOpen(false);
    setPasteUrl("");
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      const { meetUrl } = await create({ data: {} });
      insertWithPreset(meetUrl);
      toast.success("Google Meet link added");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create Meet link");
    } finally {
      setBusy(false);
    }
  };

  const handlePaste = () => {
    const url = pasteUrl.trim();
    if (!/^https?:\/\/meet\.google\.com\/[^\s]+/i.test(url)) {
      toast.error("Paste a valid https://meet.google.com link");
      return;
    }
    insertWithPreset(url);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled}
          title="Send Google Meet link"
          className={buttonClassName ?? (size === "icon" ? "h-10 w-10 shrink-0 rounded-full" : "")}
        >
          <Video className={size === "icon" ? "h-5 w-5" : "h-3.5 w-3.5"} />
          {size !== "icon" && <span>Meet</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Video className="h-4 w-4" /> Google Meet
          </div>

          <Button
            type="button"
            className="w-full justify-start gap-2"
            onClick={handleCreate}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Create Google Meet link
          </Button>

          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Paste existing link
            </div>
            <div className="flex gap-1.5">
              <Input
                value={pasteUrl}
                onChange={(e) => setPasteUrl(e.target.value)}
                placeholder="https://meet.google.com/…"
                className="h-9 text-xs"
              />
              <Button type="button" size="sm" variant="secondary" onClick={handlePaste}>
                <LinkIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Quick message
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-[11px] hover:bg-secondary"
                  onClick={() => {
                    onInsert(p);
                    setOpen(false);
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}